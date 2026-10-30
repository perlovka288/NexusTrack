'use strict';
// NEXUS: каталог игр на IGDB (Twitch API). Модуль отдаёт данные в том же виде, в каком раньше отдавал RAWG,
// поэтому остальной интерфейс (фильтры, карточки, профиль, серии) работает без переписывания.
//
// Идентификаторы: игра IGDB получает id вида 'r' + (100 000 000 + idIGDB). Старые id RAWG (до 100 млн) остаются рабочими,
// так что игры, уже добавленные в библиотеку, не теряются, а новые не пересекаются со старыми.
//
// Приоритет Steam: если у игры в IGDB есть страница Steam (external_games), steamify() превращает запись в Steam-версию
// (id = appid, обложка Steam), а unify() убирает дубли по id и по нормализованному названию в пользу Steam.
const D = require('../public/catalog-data.js');
const S = require('../public/search.js');
let DEFAULTS = {id: '', secret: ''};
try { DEFAULTS = require('./igdb-keys.js'); } catch {}

const OFFSET = 100000000;
const API = 'https://api.igdb.com/v4';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IMG = 'https://images.igdb.com/igdb/image/upload/';
const STEAM_CDN = 'https://cdn.akamai.steamstatic.com/steam/apps/';

let creds = {id: DEFAULTS.id || '', secret: DEFAULTS.secret || ''};
function configure(c = {}) {
  const id = String(c.id || DEFAULTS.id || '').trim(), secret = String(c.secret || DEFAULTS.secret || '').trim();
  if (id !== creds.id || secret !== creds.secret) { creds = {id, secret}; token = null; }
}
const ready = () => !!(creds.id && creds.secret);
const isIgdbId = v => { const n = +String(v).replace(/^r/, ''); return Number.isFinite(n) && n >= OFFSET; };
const toIgdb = v => +String(v).replace(/^r/, '') - OFFSET;
const toLocal = n => 'r' + (OFFSET + n);

// ---------- 1. авторизация: Bearer-токен через id.twitch.tv (client_credentials), кэш до истечения срока ----------
let token = null, tokenP = null;
async function getToken(force) {
  if (!ready()) throw new Error('IGDB: не заданы Client ID и Client Secret');
  if (!force && token && Date.now() < token.exp - 60000) return token.value;
  if (tokenP) return tokenP;
  tokenP = (async () => {
    const u = `${TOKEN_URL}?client_id=${encodeURIComponent(creds.id)}&client_secret=${encodeURIComponent(creds.secret)}&grant_type=client_credentials`;
    const r = await fetch(u, {method: 'POST', signal: AbortSignal.timeout(12000)});
    if (!r.ok) throw new Error('IGDB: Twitch не выдал токен (HTTP ' + r.status + '). Проверьте Client ID и Secret');
    const j = await r.json();
    if (!j.access_token) throw new Error('IGDB: пустой ответ авторизации');
    token = {value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000};
    return token.value;
  })().finally(() => { tokenP = null; });
  return tokenP;
}

// ---------- 2. запросы: очередь (лимит IGDB 4 запроса в секунду), повтор при 401/429, кэш ----------
// Планировщик: до 5 запросов одновременно, старты не чаще раза в 260 мс (лимит IGDB: 4 в секунду).
// Запросы пользователя (поиск, фильтры) обгоняют фоновые (проверка тегов), поэтому интерфейс не ждёт в очереди.
const jobs = {hi: [], lo: []}; let active = 0, lastStart = 0, pumping = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function queued(fn, low) { return new Promise((res, rej) => { (low ? jobs.lo : jobs.hi).push({fn, res, rej}); pump(); }); }
async function pump() {
  if (pumping) return; pumping = true;
  try {
    for (;;) {
      const list = jobs.hi.length ? jobs.hi : jobs.lo; if (!list.length) break;
      if (active >= 5) { await sleep(25); continue; }
      const w = lastStart + 260 - Date.now(); if (w > 0) await sleep(w);
      const job = (jobs.hi.length ? jobs.hi : jobs.lo).shift(); if (!job) continue;
      lastStart = Date.now(); active++;
      job.fn().then(job.res, job.rej).finally(() => { active--; });
    }
  } finally { pumping = false; }
}
const memo = new Map(), inflight = new Map();
function post(endpoint, body, ttl = 5 * 60 * 1000, low = false) {
  const key = endpoint + '|' + body;
  if (ttl) { const h = memo.get(key); if (h && Date.now() - h.t < ttl) return Promise.resolve(h.j); }
  if (inflight.has(key)) return inflight.get(key);   // тот же запрос уже летит (быстрый ввод, повторное открытие): ждём его, а не шлём второй
  const p = run(endpoint, body, ttl, key, low).finally(() => inflight.delete(key));
  inflight.set(key, p); return p;
}
async function run(endpoint, body, ttl, key, low) {
  const j = await queued(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tk = await getToken(attempt === 1 && lastStatus === 401);
      const r = await fetch(`${API}/${endpoint}`, {method: 'POST', headers: {'Client-ID': creds.id, Authorization: 'Bearer ' + tk, Accept: 'application/json', 'Content-Type': 'text/plain'}, body, signal: AbortSignal.timeout(15000)});
      lastStatus = r.status;
      if (r.status === 429) { await new Promise(x => setTimeout(x, 1100)); continue; }
      if (r.status === 401) { token = null; continue; }
      if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('IGDB HTTP ' + r.status + (t ? ': ' + t.slice(0, 140) : '')); e.status = r.status; throw e; }
      return r.json();
    }
    throw new Error('IGDB: сервис недоступен (лимит запросов или авторизация)');
  }, low);
  if (ttl) { if (memo.size > 300) memo.delete(memo.keys().next().value); memo.set(key, {t: Date.now(), j}); }
  return j;
}
let lastStatus = 0;
const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n;]+/g, ' ');

// ---------- 3. маппинг платформ: id интерфейса → id IGDB (D.PLATFORMS[].igdb) и обратно (для подписей) ----------
const PLAT_IDS = id => String((D.PLATFORM_BY_ID[id] || {}).igdb || '').split(',').filter(Boolean);
const PLAT_NAME = {};   // id платформы IGDB → название в формате, который понимает D.platId()
for (const p of D.PLATFORMS) {
  const ids = String(p.igdb || '').split(',').filter(Boolean);
  ids.forEach((i, k) => { PLAT_NAME[i] = (p.names || [])[k] || (p.names || [])[0] || p.label; });
}

// ---------- 4. маппинг жанров и тегов интерфейса на genres / themes / game_modes / player_perspectives IGDB ----------
// IGDB genres: 4 Fighting, 5 Shooter, 7 Music, 8 Platform, 9 Puzzle, 10 Racing, 11 RTS, 12 RPG, 13 Simulator, 14 Sport, 15 Strategy, 16 Turn-based strategy,
//              24 Tactical, 25 Hack and slash, 26 Quiz, 30 Pinball, 31 Adventure, 32 Indie, 33 Arcade, 34 Visual Novel, 35 Card & Board Game, 36 MOBA, 2 Point-and-click
// IGDB themes: 1 Action, 17 Fantasy, 18 Sci-fi, 19 Horror, 20 Thriller, 21 Survival, 22 Historical, 23 Stealth, 27 Comedy, 28 Business, 31 Drama, 33 Sandbox,
//              34 Educational, 35 Kids, 38 Open world, 39 Warfare, 40 Party, 41 4X, 43 Mystery
// game_modes: 1 Single player, 2 Multiplayer, 3 Co-operative, 4 Split screen, 5 MMO, 6 Battle Royale
// player_perspectives: 1 First person, 2 Third person, 3 Bird view, 4 Side view, 7 Virtual Reality
const GENRE_CLAUSE = {
  'action': 'themes = (1) | genres = (25)',
  'indie': 'genres = (32)',
  'adventure': 'genres = (31, 2)',
  'role-playing-games-rpg': 'genres = (12)',
  'strategy': 'genres = (11, 15, 16, 24) | themes = (41)',
  'shooter': 'genres = (5)',
  'casual': 'themes = (40) | genres = (26, 30)',
  'simulation': 'genres = (13)',
  'puzzle': 'genres = (9)',
  'arcade': 'genres = (33, 30)',
  'platformer': 'genres = (8)',
  'racing': 'genres = (10)',
  'massively-multiplayer': 'game_modes = (5)',
  'sports': 'genres = (14)',
  'fighting': 'genres = (4)',
  'family': 'themes = (35)',
  'board-games': 'genres = (35)',
  'educational': 'themes = (34)',
  'card': 'genres = (35)'
};
const TAG_CLAUSE = {
  // группы интерфейса
  'co-op': 'game_modes = (3)', 'online-co-op': 'game_modes = (3)', 'local-co-op': 'game_modes = (3) & game_modes = (4)', 'cooperative': 'game_modes = (3)', 'co-op-campaign': 'game_modes = (3)',
  'split-screen': 'game_modes = (4)', 'shared-and-split-screen': 'game_modes = (4)', 'local-multiplayer': 'game_modes = (4)',
  'multiplayer': 'game_modes = (2, 5, 6)', 'online-multiplayer': 'game_modes = (2, 5, 6)', 'pvp': 'game_modes = (2, 6)',
  'survival': 'themes = (21)', 'open-world-survival-craft': 'themes = (21)',
  'horror': 'themes = (19)', 'survival-horror': 'themes = (19)', 'psychological-horror': 'themes = (19)',
  'open-world': 'themes = (38)', 'stealth': 'themes = (23)',
  // одиночные теги
  'singleplayer': 'game_modes = (1)', 'fantasy': 'themes = (17)', 'sci-fi': 'themes = (18)', 'space': 'themes = (18)',
  'first-person': 'player_perspectives = (1)', 'third-person': 'player_perspectives = (2)', '2d': 'player_perspectives = (4)', 'vr': 'player_perspectives = (7)',
  'sandbox': 'themes = (33)', 'war': 'themes = (39)', 'mystery': 'themes = (43)', 'detective': 'themes = (43)',
  'turn-based': 'genres = (16)', 'tactical': 'genres = (24)', 'hack-and-slash': 'genres = (25)', 'fps': 'genres = (5) & player_perspectives = (1)',
  'rpg': 'genres = (12)', 'shooter': 'genres = (5)', 'mmo': 'game_modes = (5)', 'action-adventure': 'themes = (1) & genres = (31)',
  'puzzle-platformer': 'genres = (9) & genres = (8)', 'building': 'themes = (28)', 'team-based': 'game_modes = (2, 6)'
};
// теги без прямого аналога в IGDB ищем по ключевым словам IGDB (keywords). Эти теги показываются в интерфейсе только если по ним реально есть игры.
const KEYWORD_TAGS = {
  'story-rich': ['story rich'], 'atmospheric': ['atmospheric'], 'exploration': ['exploration'], 'zombies': ['zombies', 'zombie'],
  'female-protagonist': ['female protagonist'], 'post-apocalyptic': ['post-apocalyptic', 'post apocalyptic'], 'cyberpunk': ['cyberpunk'],
  'relaxing': ['relaxing', 'cozy'], 'choices-matter': ['choices matter', 'choice matters'], 'metroidvania': ['metroidvania'], 'roguelike': ['roguelike'],
  'rogue-lite': ['roguelite', 'rogue-lite'], 'fast-paced': ['fast-paced'], 'anime': ['anime'], 'retro': ['retro'], 'crafting': ['crafting'],
  'base-building': ['base building'], 'multiple-endings': ['multiple endings'], 'nonlinear': ['nonlinear', 'non-linear'], 'physics': ['physics'],
  'minimalist': ['minimalist'], 'realistic': ['realistic'], 'character-customization': ['character customization'], 'magic': ['magic'],
  'pixel-graphics': ['pixel art', 'pixel graphics'], 'souls-like': ['souls-like', 'soulslike'], 'soulslike': ['souls-like', 'soulslike'], '3d': ['3d']
};
function tagClause(slug) {
  slug = String(slug || '').toLowerCase().trim();
  if (TAG_CLAUSE[slug]) return TAG_CLAUSE[slug];
  const kw = KEYWORD_TAGS[slug] || [slug.replace(/-/g, ' ')];
  return kw.map(k => `keywords.name = "${esc(k)}"`).join(' | ');
}
const orJoin = parts => { const u = [...new Set(parts.filter(Boolean))]; return u.length ? '(' + u.map(x => '(' + x + ')').join(' | ') + ')' : ''; };

// ---------- 5. сборка запроса ----------
const FIELDS_BASE = 'name,slug,first_release_date,total_rating,total_rating_count,aggregated_rating,follows,hypes,cover.image_id,artworks.image_id,genres,themes,game_modes,player_perspectives,platforms,parent_game,version_parent';
const FIELD_VARIANTS = [FIELDS_BASE + ',external_games.uid,external_games.url,external_games.category', FIELDS_BASE + ',external_games.uid,external_games.url', FIELDS_BASE];
let fieldVariant = 0;   // какой набор полей принял сервер (если IGDB что-то переименует, перейдём на запасной вариант сами)

const unix = d => Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000);
const QUALITY = '(total_rating_count >= 5 | follows >= 10 | hypes >= 5)', QUALITY_LOW = '(total_rating_count >= 1 | follows >= 2 | hypes >= 2)';
function buildWhere(o) {
  const c = ['parent_game = null', 'version_parent = null'];
  const plats = [...new Set(String(o.platforms || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)))];
  if (plats.length) c.push(`platforms = (${plats.join(',')})`);
  const gs = String(o.genres || '').split(',').map(x => x.trim()).filter(Boolean).map(g => GENRE_CLAUSE[g]);
  if (gs.length && gs.every(Boolean)) c.push(orJoin(gs));
  const ts = String(o.tags || '').split(',').map(x => x.trim()).filter(Boolean);
  if (ts.length) c.push(orJoin(ts.map(tagClause)));
  const comp = [...new Set(String(o.developers || o.publishers || '').split(',').filter(x => /^\d+$/.test(x)))];
  if (comp.length) c.push(`involved_companies.company = (${comp.join(',')})`);
  const m = /^(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})$/.exec(o.dates || '');
  if (m) c.push(`first_release_date >= ${unix(m[1])}`, `first_release_date <= ${unix(m[2]) + 86399}`);
  if (!o.search && o.minAdded !== 0 && !comp.length) c.push(QUALITY);
  else if (!o.search && o.minAdded === 0) c.push(QUALITY_LOW);
  const ord = o.ordering || '-added';
  if (!o.search) {
    if (ord === '-rating') c.push('total_rating != null', 'total_rating_count >= 10');
    else if (ord === '-metacritic') c.push('aggregated_rating != null');
    else if (ord === '-released' || ord === 'released') c.push('first_release_date != null');
  }
  return c.join(' & ');
}
function sortOf(o) {
  const ord = o.ordering || '-added';
  if (ord === '-rating') return 'total_rating desc';
  if (ord === '-metacritic') return 'aggregated_rating desc';
  if (ord === '-released') return 'first_release_date desc';
  if (ord === 'released') return 'first_release_date asc';
  if (ord === 'name') return 'name asc';
  const m = /^(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})$/.exec(o.dates || '');
  if (m && unix(m[2]) > Date.now() / 1000) return 'follows desc';   // будущие релизы: у них нет оценок, популярность видна по подпискам
  return 'total_rating_count desc';
}

// ---------- 6. приведение ответа IGDB к формату карточки каталога ----------
const GEN_SLUG = {4: 'fighting', 5: 'shooter', 8: 'platformer', 9: 'puzzle', 10: 'racing', 11: 'strategy', 12: 'role-playing-games-rpg', 13: 'simulation', 14: 'sports', 15: 'strategy', 16: 'strategy', 24: 'strategy', 25: 'action', 31: 'adventure', 2: 'adventure', 32: 'indie', 33: 'arcade', 30: 'arcade', 35: 'board-games', 34: 'adventure', 26: 'casual', 7: 'casual', 36: 'strategy'};
const THEME_GENRE = {1: 'action', 35: 'family', 34: 'educational', 40: 'casual', 41: 'strategy'};
const THEME_TAG = {17: 'fantasy', 18: 'sci-fi', 19: 'horror', 21: 'survival', 23: 'stealth', 33: 'sandbox', 38: 'open-world', 39: 'war', 43: 'mystery'};
const MODE_TAG = {1: ['singleplayer'], 2: ['multiplayer', 'online-multiplayer'], 3: ['co-op', 'online-co-op'], 4: ['split-screen', 'local-multiplayer'], 5: ['mmo', 'multiplayer'], 6: ['multiplayer']};
const PERSP_TAG = {1: 'first-person', 2: 'third-person', 4: '2d', 7: 'vr'};
const GENRE_EN = Object.fromEntries(D.GENRES.map(g => [g[0], g[2]]));
const idsOf = a => (a || []).map(x => (x && typeof x === 'object' ? x.id : x)).filter(x => x != null);
const imgUrl = (id, t) => id ? `${IMG}${t}/${id}.jpg` : '';
function steamOf(ext) {
  for (const e of ext || []) {
    const m = /store\.steampowered\.com\/app\/(\d+)/i.exec(e.url || '');
    if (m) return m[1];
    if (e.category === 1 && /^\d+$/.test(String(e.uid || ''))) return String(e.uid);
  }
  return '';
}
function toItem(g) {
  const gids = idsOf(g.genres), tids = idsOf(g.themes), mids = idsOf(g.game_modes), pids = idsOf(g.player_perspectives);
  const slugs = new Set();
  gids.forEach(i => GEN_SLUG[i] && slugs.add(GEN_SLUG[i])); tids.forEach(i => THEME_GENRE[i] && slugs.add(THEME_GENRE[i])); if (mids.includes(5)) slugs.add('massively-multiplayer');
  const tags = new Set();
  tids.forEach(i => THEME_TAG[i] && tags.add(THEME_TAG[i])); mids.forEach(i => (MODE_TAG[i] || []).forEach(t => tags.add(t))); pids.forEach(i => PERSP_TAG[i] && tags.add(PERSP_TAG[i]));
  if (gids.includes(16)) tags.add('turn-based'); if (gids.includes(24)) tags.add('tactical'); if (gids.includes(25)) tags.add('hack-and-slash');
  if (gids.includes(12)) tags.add('rpg'); if (gids.includes(5)) { tags.add('shooter'); if (pids.includes(1)) tags.add('fps'); }
  const plats = [...new Set(idsOf(g.platforms).map(i => PLAT_NAME[i]).filter(Boolean))];
  const art = (g.artworks && g.artworks[0] && g.artworks[0].image_id) || (g.screenshots && g.screenshots[0] && g.screenshots[0].image_id) || '';   // в списках скриншоты не запрашиваем: это самый тяжёлый массив
  const cover = g.cover && g.cover.image_id;
  const rating = g.total_rating ? Math.round(g.total_rating) / 20 : 0;
  return {
    id: toLocal(g.id), name: g.name, img: art ? imgUrl(art, 't_720p') : imgUrl(cover, 't_cover_big_2x'), src: 'rawg',
    released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : '',
    rating, metacritic: g.aggregated_rating ? Math.round(g.aggregated_rating) : null, playtime: 0,
    added: (g.total_rating_count || 0) + (g.follows || 0) + (g.hypes || 0),
    platforms: plats, parents: plats, genres: [...slugs].map(s => GENRE_EN[s]).filter(Boolean), genreSlugs: [...slugs], tags: [...tags], tagNames: {},
    igdbId: g.id, steamId: steamOf(g.external_games), cover: imgUrl(cover, 't_cover_big_2x')
  };
}
async function fetchGames(body) {
  for (let v = fieldVariant; v < FIELD_VARIANTS.length; v++) {
    try { const r = await post('games', body.replace('%FIELDS%', FIELD_VARIANTS[v])); fieldVariant = v; return r; }
    catch (e) { if (e.status !== 400 || v === FIELD_VARIANTS.length - 1) throw e; }
  }
}

// список игр: тот же набор параметров, что был у RAWG (search, platforms, genres, tags, dates, ordering, page, size, developers, publishers)
async function list(o = {}) {
  const size = Math.min(100, Math.max(1, +o.size || 40)), page = Math.max(1, +o.page || 1), where = buildWhere(o);
  let body, count = null;
  if (o.search) {
    body = `search "${esc(String(o.search).slice(0, 100))}"; fields %FIELDS%; where ${where}; limit ${size}; offset ${(page - 1) * size};`;
  } else {
    body = `fields %FIELDS%; where ${where}; sort ${sortOf(o)}; limit ${size}; offset ${(page - 1) * size};`;
  }
  const [rows, cnt] = await Promise.all([fetchGames(body), o.search ? null : post('games/count', `where ${where};`, 10 * 60 * 1000).catch(() => null)]);
  if (cnt && typeof cnt.count === 'number') count = cnt.count;
  const results = (rows || []).map(toItem);
  if (size <= 12) await fillPlaytime(results).catch(() => {});
  return {count: count == null ? results.length : count, next: count == null ? results.length === size : page * size < count, results};
}
async function search(q) { return (await list({search: q, size: 8})).results; }
async function byId(id) {
  const rows = await fetchGames(`fields %FIELDS%; where id = ${toIgdb(id)};`);
  if (!rows || !rows[0]) throw new Error('IGDB: игра не найдена');
  const it = toItem(rows[0]); await fillPlaytime([it]).catch(() => {}); return it;
}
// среднее время прохождения (часы) из game_time_to_beats: нужно для блока «Прогресс»
async function fillPlaytime(items) {
  const ids = items.map(i => i.igdbId).filter(Boolean); if (!ids.length) return;
  const rows = await post('game_time_to_beats', `fields game_id,hastily,normally,completely; where game_id = (${ids.join(',')}); limit ${ids.length};`, 60 * 60 * 1000);
  const by = new Map((rows || []).map(r => [r.game_id, r]));
  for (const it of items) { const r = by.get(it.igdbId); const s = r && (r.normally || r.hastily || r.completely); if (s) it.playtime = Math.max(1, Math.round(s / 3600)); }
}
async function game(id) {
  const gid = toIgdb(id);
  const rows = await post('games', `fields ${FIELDS_BASE.replace(',parent_game,version_parent', '')},screenshots.image_id,summary,storyline,websites.url,websites.category,involved_companies.developer,involved_companies.publisher,involved_companies.company.id,involved_companies.company.name,involved_companies.company.slug,external_games.uid,external_games.url,screenshots.image_id; where id = ${gid};`, 30 * 60 * 1000)
    .catch(() => fetchGames(`fields %FIELDS%; where id = ${gid};`));
  const g = rows && rows[0]; if (!g) throw new Error('IGDB: игра не найдена');
  const it = toItem(g); await fillPlaytime([it]).catch(() => {});
  const ic = g.involved_companies || [], comp = f => ic.filter(x => x[f] && x.company).map(x => ({id: x.company.id, name: x.company.name, slug: x.company.slug || ''}));
  const dev = comp('developer'), pub = comp('publisher');
  const site = (g.websites || []).find(w => w.category === 1) || (g.websites || [])[0];
  return {
    ...it, desc: String(g.summary || g.storyline || '').slice(0, 1500), developers: dev.map(x => x.name), publishers: pub.map(x => x.name), developersList: dev, publishersList: pub,
    image: it.img, website: site ? site.url : '', esrb: '', ratingsCount: g.total_rating_count || 0, achievements: 0,
    screenshots: (g.screenshots || []).slice(0, 12).map(s => ({path_full: imgUrl(s.image_id, 't_1080p'), path_thumbnail: imgUrl(s.image_id, 't_screenshot_med')}))
  };
}
// части серии: франшиза или коллекция игры
async function series(id) {
  const gid = toIgdb(id);
  let ids = [];
  for (const f of ['collections', 'collection']) {
    try { const r = await post('games', `fields ${f}; where id = ${gid};`, 3600 * 1000); const v = r && r[0] && r[0][f]; ids = Array.isArray(v) ? v : v ? [v] : []; if (ids.length) break; } catch {}
  }
  if (!ids.length) return [];
  for (const f of ['collections', 'collection']) {
    try { const rows = await fetchGames(`fields %FIELDS%; where ${f} = (${ids.join(',')}) & parent_game = null & version_parent = null; sort first_release_date asc; limit 40;`); return rows.map(toItem); } catch {}
  }
  return [];
}
// студии и издатели
async function studios(q) {
  const s = String(q || '').trim().slice(0, 100);
  const rows = await post('companies', `${s ? `search "${esc(s)}"; ` : ''}fields name,slug,logo.image_id,developed,published; ${s ? '' : 'sort id asc; '}limit 24;`, 6 * 3600 * 1000);
  return (rows || []).map(x => ({kind: (x.developed || []).length >= (x.published || []).length ? 'developer' : 'publisher', id: x.id, name: x.name, slug: x.slug || '', games: (x.developed || []).length + (x.published || []).length, image: x.logo ? imgUrl(x.logo.image_id, 't_720p') : ''}));
}
async function studio(kind, id, page = 1) {
  const cid = +id;
  const [c, l] = await Promise.all([
    post('companies', `fields name,slug,description,logo.image_id,developed,published; where id = ${cid};`, 3600 * 1000),
    list({developers: String(cid), size: 40, page: Math.max(1, +page || 1), ordering: '-added', minAdded: 0}).catch(() => ({count: 0, next: false, results: []}))
  ]);
  const d = (c && c[0]) || {};
  return {kind: kind === 'publisher' ? 'publisher' : 'developer', id: d.id || cid, name: d.name || '', slug: d.slug || '', description: String(d.description || '').slice(0, 2400),
    image: d.logo ? imgUrl(d.logo.image_id, 't_720p') : '', gamesCount: (d.developed || []).length + (d.published || []).length || l.count,
    games: l.results, total: l.count || l.results.length, next: !!l.next, page: Math.max(1, +page || 1)};
}
const calendar = (from, to, page = 1) => list({dates: `${from},${to}`, size: 40, page: Math.max(1, +page || 1), ordering: '-added', minAdded: 0});

// ---------- 7. список тегов интерфейса с реальным числом игр: пустые теги не показываем ----------
const tagCache = {t: 0, v: [], busy: false};
const STRUCTURED = new Set(Object.keys(TAG_CLAUSE));
function tagList() {
  const all = [...D.TAG_GROUPS.flatMap(g => g.slugs), ...D.TAG_SINGLE];
  return [...new Set(all)].filter(s => !D.TAG_NOISE.has(s) && !D.TAG_HIDE.has(s));
}
function tags() {
  const slugs = tagList();
  const known = new Map(tagCache.v.map(t => [t.slug, t.count]));
  if (Date.now() - tagCache.t > 24 * 3600 * 1000 && !tagCache.busy && ready()) probeTags(slugs);
  // структурные теги (жанры, темы, режимы) существуют в IGDB всегда; ключевые слова показываем, когда проверка нашла по ним игры
  return slugs.map(s => ({slug: s, name: s, count: known.has(s) ? known.get(s) : (STRUCTURED.has(s) ? 1 : 0)})).filter(t => t.count > 0);
}
async function probeTags(slugs) {
  tagCache.busy = true;
  try {
    const out = [];
    for (const s of slugs) {
      try { const r = await post('games/count', `where parent_game = null & version_parent = null & ${QUALITY} & ${orJoin([tagClause(s)])};`, 24 * 3600 * 1000, true); out.push({slug: s, count: (r && r.count) || 0}); }
      catch { /* временный сбой: пропускаем тег до следующей проверки */ }
    }
    if (out.length) { tagCache.v = out; tagCache.t = Date.now(); }
  } finally { tagCache.busy = false; }
}

// ---------- 8. Steam в приоритете и дедупликация ----------
// запись IGDB → Steam-версия (id = appid, обложка Steam), если у игры есть страница в Steam
function steamify(it) {
  if (!it || it.src === 'steam' || !it.steamId) return it;
  const {steamId, igdbId, cover, ...rest} = it;
  return {...rest, id: steamId, src: 'steam', img: STEAM_CDN + steamId + '/header.jpg', igdbId};
}
// единый список без дублей: Steam-записи имеют приоритет, порядок выдачи сохраняется
function unify(items) {
  const conv = (items || []).map(steamify);
  const pos = new Map(conv.map((it, i) => [it, i]));
  const ordered = [...conv.filter(i => i.src === 'steam'), ...conv.filter(i => i.src !== 'steam')];
  const kept = S.dedupe(ordered, {get: i => i.name, src: i => (i.src === 'steam' ? 'steam' : 'x'), id: i => i.id});
  return kept.sort((a, b) => pos.get(a) - pos.get(b));
}

// прогрев: токен и первая страница каталога готовы до того, как пользователь откроет «Каталог»
let warmed = false;
async function warm() {
  if (warmed || !ready()) return; warmed = true;
  try { await getToken(); await list({size: 60, page: 1, ordering: '-added'}); } catch { warmed = false; }
}
module.exports = {warm, configure, ready, getToken, isIgdbId, toIgdb, toLocal, OFFSET, list, search, byId, game, series, studios, studio, calendar, tags, steamify, unify, buildWhere, tagClause, toItem, steamOf, GENRE_CLAUSE, TAG_CLAUSE, KEYWORD_TAGS, PLAT_IDS};
