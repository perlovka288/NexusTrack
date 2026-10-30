'use strict';
// Внешние источники данных: RAWG (основная база игр), Steam, SteamGridDB
const UA = 'Mozilla/5.0 NEXUS';
const T = ms => AbortSignal.timeout(ms);
const memo = new Map();
async function getJson(url, headers = {}, ms = 12000, ttl = 0) {
  if (ttl) { const h = memo.get(url); if (h && Date.now() - h.t < ttl) return h.j; }
  const r = await fetch(url, {headers: {'user-agent': UA, ...headers}, signal: T(ms)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (ttl) { if (memo.size > 400) memo.delete(memo.keys().next().value); memo.set(url, {t: Date.now(), j}); }
  return j;
}
const TTL = 5 * 60 * 1000;
async function exists(url) {
  try {
    let r = await fetch(url, {method: 'HEAD', headers: {'user-agent': UA}, signal: T(8000)});
    if (r.status === 405 || r.status === 403) r = await fetch(url, {headers: {'user-agent': UA, range: 'bytes=0-0'}, signal: T(8000)});
    return r.ok && /image/.test(r.headers.get('content-type') || 'image');
  } catch { return false; }
}
const CDN = 'https://cdn.akamai.steamstatic.com/steam/apps/';

// --- Steam ---
async function steamSearch(q) {
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=russian&cc=US`);
  return (j.items || []).map(i => ({id: String(i.id), name: i.name, img: i.tiny_image, src: 'steam'}));
}
// Вертикальная обложка Steam. Новые игры хранят её по хэш-пути, поэтому сначала спрашиваем у Steam точный адрес.
async function steamPortrait(appid) {
  const urls = [];
  try {
    const input = encodeURIComponent(JSON.stringify({ids: [{appid: +appid}], context: {language: 'english', country_code: 'US'}, data_request: {include_assets: true}}));
    const j = await getJson('https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=' + input);
    const a = j?.response?.store_items?.[0]?.assets;
    if (a?.asset_url_format) {
      const base = 'https://shared.akamai.steamstatic.com/store_item_assets/' + a.asset_url_format;
      for (const f of [a.library_capsule_2x, a.library_capsule]) if (f) urls.push(base.replace('${FILENAME}', f));
    }
  } catch {}
  urls.push(CDN + appid + '/library_600x900_2x.jpg', CDN + appid + '/library_600x900.jpg');
  for (const u of urls) if (await exists(u)) return u;
  return null;
}
// название игры Steam по appid (для запущенных игр, которых нет в библиотеке)
async function steamName(appid) {
  const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=basic&l=english`, {}, 10000, TTL);
  const d = j && j[appid];
  return d && d.success && d.data && d.data.type !== 'dlc' && d.data.type !== 'music' ? d.data.name : null;
}
async function steamOwned(key, steamid) {
  const j = await getJson(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamid)}&include_appinfo=1&include_played_free_games=1&format=json`, {}, 30000);
  if (!j.response || !Array.isArray(j.response.games)) throw new Error('Профиль скрыт или ключ/SteamID неверны (в Steam: Профиль → Настройки приватности → «Сведения об играх» = Открытые)');
  return j.response.games.map(g => ({appid: String(g.appid), name: g.name, minutes: g.playtime_forever || 0, last: g.rtime_last_played || 0}));
}
// достижения Steam: сколько открыто из сколько всего (для реального прогресса прохождения)
async function steamAchievements(key, steamid, appid) {
  const j = await getJson(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamid)}&appid=${encodeURIComponent(appid)}&l=english&format=json`, {}, 20000, 10 * 60 * 1000);
  const ps = j && j.playerstats;
  if (!ps || !ps.success || !Array.isArray(ps.achievements) || !ps.achievements.length) return null;
  const total = ps.achievements.length, unlocked = ps.achievements.filter(a => a && a.achieved).length;
  return {total, unlocked, name: ps.gameName || ''};
}

// --- SteamGridDB (вертикальные обложки 600x900) ---
async function sgdb(key, {steamId, name}) {
  const H = {authorization: 'Bearer ' + key};
  const pick = j => (j.data || []).find(x => x.url && !x.nsfw && !x.humor) || (j.data || [])[0];
  let r;
  if (steamId) {
    try { r = pick(await getJson(`https://www.steamgriddb.com/api/v2/grids/steam/${steamId}?dimensions=600x900&types=static`, H)); } catch {}
    if (r) return r.url;
  }
  if (!name) return null;
  const s = await getJson('https://www.steamgriddb.com/api/v2/search/autocomplete/' + encodeURIComponent(name), H);
  const g = s.data?.[0]; if (!g) return null;
  r = pick(await getJson(`https://www.steamgriddb.com/api/v2/grids/game/${g.id}?dimensions=600x900&types=static`, H));
  return r?.url || null;
}

// --- SteamGridDB: широкие баннеры для шапки страницы игры (hero 1920x620) ---
async function sgdbHero(key, {steamId, name}) {
  const H = {authorization: 'Bearer ' + key};
  const dims = 'dimensions=1920x620,3840x1240,1600x650&types=static';
  const pick = j => (j.data || []).find(x => x.url && !x.nsfw && !x.humor) || (j.data || [])[0];
  let r;
  if (steamId) {
    try { r = pick(await getJson(`https://www.steamgriddb.com/api/v2/heroes/steam/${steamId}?${dims}`, H)); } catch {}
    if (r) return r.url;
  }
  if (!name) return null;
  const s = await getJson('https://www.steamgriddb.com/api/v2/search/autocomplete/' + encodeURIComponent(name), H);
  const g = s.data?.[0]; if (!g) return null;
  r = pick(await getJson(`https://www.steamgriddb.com/api/v2/heroes/game/${g.id}?${dims}`, H));
  return r?.url || null;
}

// --- RAWG: основная база игр (поиск, фильтры по платформам и жанрам, описания, время прохождения) ---
const RAWG = 'https://api.rawg.io/api';
const engTags = i => (i.tags || []).filter(t => t && t.slug && (!t.language || t.language === 'eng')).map(t => t.slug);
const rawgItem = i => ({
  id: 'r' + i.id, name: i.name, img: i.background_image, src: 'rawg', released: i.released || '', rating: i.rating || 0, metacritic: i.metacritic || null,
  playtime: i.playtime || 0, // среднее время прохождения по данным RAWG, часы
  added: i.added || i.ratings_count || 0,
  platforms: (i.platforms || []).map(x => x.platform.name), parents: (i.parent_platforms || []).map(x => x.platform.name),
  genres: (i.genres || []).map(x => x.name), genreSlugs: (i.genres || []).map(x => x.slug), tags: engTags(i), tagNames: Object.fromEntries((i.tags || []).filter(t => t && t.slug).map(t => [t.slug, t.name]))
});
// Качество выдачи: RAWG отдаёт много малоизвестного мусора. Для каталога, поиска,
// фильтров, студий и календаря оставляем игры, которые добавили больше 100 пользователей.
const RAWG_MIN_ADDED = 100;
const quality = (items, o) => (o.minAdded === 0 ? items : items.filter(it => (+it.added || 0) > RAWG_MIN_ADDED));
// список игр с фильтрами: search, platforms (конкретные консоли), parent_platforms, genres, tags,
// tags_exclude, developers, publishers, dates, ordering, page. По умолчанию — самые популярные.
async function rawgList(key, o = {}) {
  const p = new URLSearchParams({key, page_size: String(o.size || 40), page: String(o.page || 1), exclude_additions: 'true'});
  for (const k of ['search', 'platforms', 'parent_platforms', 'genres', 'tags', 'tags_exclude', 'developers', 'publishers', 'dates', 'ordering']) if (o[k]) p.set(k, String(o[k]));
  if (!p.has('ordering')) p.set('ordering', '-added');
  if (o.search) { p.set('search_precise', o.exact ? 'false' : 'true'); if (o.exact) p.set('search_exact', 'true'); }
  const j = await getJson(`${RAWG}/games?${p}`, {}, 12000, TTL);
  const results = quality((j.results || []).map(rawgItem), o);
  return {count: j.count || results.length, next: !!j.next, results};
}
async function rawgSearch(key, q) {
  return (await rawgList(key, {search: q, size: 8, ordering: '-added'})).results;
}
// части серии игры (RAWG game-series). Для серий и DLC не отсекаем малоизвестные части.
async function rawgSeries(key, id) { const j = await getJson(`${RAWG}/games/${id}/game-series?key=${encodeURIComponent(key)}&page_size=40`, {}, 12000, 3600 * 1000); return (j.results || []).map(rawgItem); }
// дополнения (DLC) игры по данным RAWG: отдельный список, не части серии
async function rawgAdditions(key, id) { const j = await getJson(`${RAWG}/games/${id}/additions?key=${encodeURIComponent(key)}&page_size=40`, {}, 12000, 3600 * 1000); return (j.results || []).map(rawgItem); }
async function rawgById(key, id) { return rawgItem(await getJson(`${RAWG}/games/${id}?key=${encodeURIComponent(key)}`, {}, 12000, TTL)); }
// студии и издатели: поиск по названию для страниц и привязки к игре
async function rawgStudios(key, q) {
  const search = String(q || '').trim().slice(0, 100);
  const one = async kind => {
    const p = new URLSearchParams({key, page_size: '12'});
    if (search) p.set('search', search);
    const j = await getJson(`${RAWG}/${kind}s?${p}`, {}, 12000, 6 * 3600 * 1000).catch(() => ({results: []}));
    return (j.results || []).map(x => ({kind, id: x.id, name: x.name, slug: x.slug, games: x.games_count || 0, image: x.image_background || ''}));
  };
  const [developers, publishers] = await Promise.all([one('developer'), one('publisher')]);
  return [...developers, ...publishers];
}
async function rawgStudio(key, kind, id, page = 1) {
  const k = kind === 'publisher' ? 'publishers' : 'developers';
  const one = kind === 'publisher' ? 'publisher' : 'developer';
  const [d, list] = await Promise.all([
    getJson(`${RAWG}/${one}s/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`, {}, 12000, 3600 * 1000),
    rawgList(key, {[k]: String(id), size: 40, page: Math.max(1, +page || 1), ordering: '-added'}).catch(() => ({count: 0, next: false, results: []}))
  ]);
  return {
    kind: one, id: d.id || +id, name: d.name || '', slug: d.slug || '', description: (d.description_raw || d.description || '').slice(0, 2400),
    image: d.image_background || '', gamesCount: d.games_count || list.count || 0,
    games: list.results, total: list.count || list.results.length, next: !!list.next, page: Math.max(1, +page || 1)
  };
}
// календарь релизов: даты берём у RAWG, но запрос всё равно сортируем по популярности,
// а по дате сортируем уже на клиенте — так в календарь не попадает малоизвестный мусор.
async function rawgCalendar(key, from, to, page = 1) {
  return rawgList(key, {dates: `${from},${to}`, size: 40, page: Math.max(1, +page || 1), ordering: '-added', minAdded: 0});
}
// список платформ RAWG: по нему названия консолей сопоставляются с id (кэш на сутки)
async function rawgPlatforms(key) {
  const out = [];
  for (const page of [1, 2]) { const j = await getJson(`${RAWG}/platforms?key=${encodeURIComponent(key)}&page_size=40&page=${page}`, {}, 12000, 24 * 3600 * 1000); out.push(...(j.results || []).map(p => ({id: p.id, name: p.name, slug: p.slug}))); if (!j.next) break; }
  return out;
}
// популярные теги RAWG (на английском): из них собирается фильтр по тегам
async function rawgTags(key) {
  const j = await getJson(`${RAWG}/tags?key=${encodeURIComponent(key)}&ordering=-games_count&page_size=80`, {}, 12000, 6 * 3600 * 1000);
  return (j.results || []).filter(t => t.slug && (!t.language || t.language === 'eng')).map(t => ({slug: t.slug, name: t.name, count: t.games_count || 0}));
}
async function rawgGame(key, id) {
  const [g, s] = await Promise.all([
    getJson(`${RAWG}/games/${id}?key=${encodeURIComponent(key)}`),
    getJson(`${RAWG}/games/${id}/screenshots?key=${encodeURIComponent(key)}`).catch(() => ({results: []}))
  ]);
  const studios = xs => (xs || []).map(x => ({id: x.id, name: x.name, slug: x.slug}));
  return {
    ...rawgItem(g), desc: (g.description_raw || '').slice(0, 1500), developers: (g.developers || []).map(x => x.name), publishers: (g.publishers || []).map(x => x.name),
    developersList: studios(g.developers), publishersList: studios(g.publishers),
    image: g.background_image, website: g.website, esrb: g.esrb_rating?.name || '', ratingsCount: g.ratings_count || 0, achievements: g.achievements_count || 0,
    screenshots: (s.results || []).slice(0, 12).map(x => ({path_full: x.image, path_thumbnail: x.image}))
  };
}
async function rawgCover(key, name) { const r = await rawgSearch(key, name); return r[0]?.img || null; }

// ---------- Маршрутизация каталога: IGDB по умолчанию, RAWG остаётся запасным вариантом ----------
const IG = require('./igdb');
const R = {rawgList, rawgSearch, rawgById, rawgSeries, rawgAdditions, rawgPlatforms, rawgTags, rawgGame, rawgCover, rawgStudios, rawgStudio, rawgCalendar};
let backend = 'igdb';
function configure(c = {}) { IG.configure({id: c.igdbId, secret: c.igdbSecret}); backend = c.backend === 'rawg' ? 'rawg' : 'igdb'; }
const useIg = () => backend === 'igdb' && IG.ready();
// если IGDB временно недоступен, каталог не остаётся пустым: запрос уходит в RAWG (id платформ IGDB для RAWG не годятся, их убираем)
const withFallback = (ig, rw, strip) => async (key, ...a) => {
  if (!useIg()) return rw(key, ...a);
  try { return await ig(...a); }
  catch (e) { if (e && e.status && e.status < 500 && e.status !== 429 && e.status !== 400) throw e; const b = a.slice(); if (strip && b[0] && typeof b[0] === 'object') { b[0] = {...b[0]}; delete b[0].platforms; } return rw(key, ...b); }
};
const byId = (ig, rw) => (key, id, ...a) => (IG.isIgdbId(id) ? ig(id, ...a) : rw(key, id, ...a));
const API_OUT = {
  rawgList: withFallback(IG.list, R.rawgList, true),
  rawgSearch: withFallback(IG.search, R.rawgSearch),
  rawgCover: withFallback(async name => { const r = await IG.search(name); return r[0] && r[0].img || null; }, R.rawgCover),
  rawgById: byId(IG.byId, R.rawgById),
  rawgGame: byId(IG.game, R.rawgGame),
  rawgSeries: byId(IG.series, R.rawgSeries),
  rawgAdditions: byId(async () => [], R.rawgAdditions),
  rawgStudios: withFallback(IG.studios, R.rawgStudios),
  rawgStudio: withFallback(IG.studio, R.rawgStudio),
  rawgCalendar: withFallback(IG.calendar, R.rawgCalendar),
  rawgTags: async key => (useIg() ? IG.tags() : R.rawgTags(key)),
  rawgPlatforms: async key => (useIg() ? [] : R.rawgPlatforms(key))
};

module.exports = {steamSearch, steamPortrait, steamName, steamOwned, steamAchievements, sgdb, sgdbHero, ...API_OUT, warm: () => (useIg() ? IG.warm() : Promise.resolve()), configure, backend: () => (useIg() ? 'igdb' : 'rawg'), igdb: IG, direct: R, unifyCatalog: IG.unify, steamify: IG.steamify, RAWG_MIN_ADDED, exists, CDN};
