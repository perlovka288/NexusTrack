'use strict';
// NEXUS: локальный сервер (сайт + API + детектор игр). Нужен Node.js 18+.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), EventEmitter = require('events');
const S = require('./public/search.js'), D = require('./public/catalog-data.js'), Emu = require('./lib/emulators.js'), Launch = require('./lib/launch.js'), Backup = require('./lib/backup.js'), SF = require('./lib/savefinder.js'), Prog = require('./lib/progress.js'), Tr = require('./lib/translate.js');
const {createStore} = require('./lib/store'), {Tracker, ymd, HARD_IGNORE_APPIDS, HARD_IGNORE_NAME} = require('./lib/tracker'), P = require('./lib/providers'), {DEFAULT_RAWG_KEY} = require('./lib/defaults');
const SWITCH = require('./lib/switch.js');
const BG = require('./lib/backloggd');

const PUB = path.join(__dirname, 'public');
const ALLOW = ['store.steampowered.com', 'cdn.akamai.steamstatic.com', 'shared.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'shared.cloudflare.steamstatic.com', 'shared.fastly.steamstatic.com', 'cdn.fastly.steamstatic.com', 'steamcdn-a.akamaihd.net', 'media.rawg.io', 'cdn2.steamgriddb.com', 'cdn.steamgriddb.com', 'images.igdb.com'];
const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'};
const FIELDS = {name: 'str', status: 'str', hours: 'num', rating: 'num', note: 'str', cover: 'str', coverFit: 'str', desc: 'str', released: 'str', dir: 'str', src: 'str', exe: 'arr', dirs: 'arr', genres: 'arr', tags: 'arr', playedOn: 'arr', folders: 'arr', fav: 'bool', started: 'str', finished: 'str', progress: 'num', launch: 'str', savePath: 'str', emu: 'str', titleId: 'str', shots: 'json'};
const SHOT_RE = /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATALOG_PAGE = 60;        // игр на страницу каталога (RAWG отдаёт максимум 40 за запрос — добираем несколькими)
const RAWG_MAX = 40;            // максимум RAWG за один запрос
const RAWG_MAX_PAGE = 250;      // дальше RAWG отдаёт 404, поэтому каталог ограничен ~10 000 играми
const progCache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// секунды по дням из списка сессий (для игр, записанных до появления учёта по дням)
function daysFromSessions(ss) {
  const d = {};
  for (const x of ss || []) {
    const s = new Date(x.s), e = new Date(x.e); if (isNaN(s) || isNaN(e)) continue;
    if (e <= s) { const k = ymd(s); d[k] = (d[k] || 0) + (x.sec || 0); continue; }
    const span = (e - s) / 1000; let cur = s;
    while (cur < e) { const nx = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1), end = nx < e ? nx : e, k = ymd(cur); d[k] = (d[k] || 0) + (x.sec || 0) * ((end - cur) / 1000) / span; cur = end; }
  }
  for (const k of Object.keys(d)) d[k] = Math.round(d[k] * 10) / 10;
  return d;
}
const ID_RE = /^[\w-]{1,40}$/;
const iso = () => new Date().toISOString();
const normName = s => S.key(s);
const cleanName = s => S.cleanName(s);
// лучший кандидат для названия. Точное совпадение (с учётом регистра, цифр, римских цифр, изданий) принимается всегда;
// «содержится в названии» — только если он единственный и разница не в номере части (чтобы Half-Life не склеился с Half-Life 2)
function pickBest(q, items, get = i => i.name, pop = () => 0) {
  if (!items.length) return null;
  const vs = S.variants(q), qw = new Set(S.words(q));
  const sc = items.map(it => ({it, s: S.score(q, get(it), {variants: vs}), p: +pop(it) || 0})).sort((a, b) => (b.s - a.s) || (b.p - a.p));
  const a = sc[0], b = sc[1];
  if (a.s >= 975) return a.it;
  if (a.s >= 800 && (!b || b.s <= a.s - 60)) {
    const extra = S.words(get(a.it)).filter(w => !qw.has(w));
    if (!extra.some(w => /^\d{1,2}$/.test(w))) return a.it;
  }
  return null;
}
const bestMatch = (q, items) => pickBest(q, items);
const readBody = (req, max) => new Promise((ok, no) => {
  const c = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > max) { no(new Error('too big')); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', no);
});
function imgExt(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function start({dataDir = path.join(__dirname, 'data'), port = 8000, host = '127.0.0.1', hooks = {}, trackerOpts = {}} = {}) {
  const store = createStore(dataDir), events = new EventEmitter(), lib = () => store.data.library, cfg = () => store.data.config, meta = () => store.data.meta;
  const rawgKey = () => cfg().keys.rawg || DEFAULT_RAWG_KEY;
  // доступ с телефона по Wi-Fi: включается в Настройках, нужен перезапуск (сервер слушает все интерфейсы на постоянном порту)
  const mob = () => cfg().mobile || (cfg().mobile = {enabled: false, port: 8787, token: ''});
  if (mob().enabled && host === '127.0.0.1') { host = '0.0.0.0'; port = +mob().port || 8787; }
  const coverMiss = new Map(), cache = new Map(), clients = new Set();
  const emit = e => { for (const r of clients) r.write('data: ' + JSON.stringify(e) + '\n\n'); events.emit('event', e); };
  // --- уведомления внутри приложения: игра добавлена, сессия окончена, вышла игра из «желаемого» ---
  const notifs = () => Array.isArray(store.data.notifs) ? store.data.notifs : (store.data.notifs = []);
  const wishes = () => (store.data.wishlist && typeof store.data.wishlist === 'object' && !Array.isArray(store.data.wishlist)) ? store.data.wishlist : (store.data.wishlist = {});
  function pushNotif(n) {
    const list = notifs(), item = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: String(n.type || 'info').slice(0, 20), title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 300), gid: n.gid ? String(n.gid).slice(0, 40) : '', img: /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i.test(n.img || '') ? String(n.img).slice(0, 600) : '', t: new Date().toISOString(), read: false};
    list.unshift(item); if (list.length > 120) list.length = 120;
    store.save('notifs'); emit({type: 'notif', n: item}); return item;
  }
  events.on('event', e => {
    if (e.type === 'end' && e.seconds >= 60) { const m = Math.floor(e.seconds / 60), t = m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; pushNotif({type: 'session', title: 'Сессия окончена', body: `${e.name}: ${t}`, gid: e.id}); }
    else if (e.type === 'added') pushNotif({type: 'added', title: 'Новая игра в библиотеке', body: e.name, gid: e.id});
  });
  // игра из «желаемого» вышла: уведомление в приложении и системное окошко (его показывает main.js по событию wish-release)
  async function checkWishlist() {
    const w = wishes(), today = ymd(); let changed = false, refreshed = 0;
    for (const [id, it] of Object.entries(w)) {
      if (it.notified) continue;
      const mm = /^r(\d+)$/.exec(id);
      if (mm && refreshed < 25) { refreshed++; try { const g = await P.rawgGame(rawgKey(), mm[1]); if (g && DATE_RE.test(g.released || '') && g.released !== it.released) { it.released = g.released; changed = true; } } catch {} }
      if (DATE_RE.test(it.released || '') && it.released <= today) {
        it.notified = true; changed = true;
        pushNotif({type: 'release', title: 'Игра вышла', body: `${it.name} уже доступна`, gid: id, img: it.img});
        emit({type: 'wish-release', id, name: it.name});
      }
    }
    if (changed) store.save('wishlist');
  }

  // --- опознавание запущенной игры (в том числе пиратской/крякнутой версии) ---
  // Идея: запущенный процесс не создаёт «неизвестную игру», а сопоставляется с игрой, которая уже есть в библиотеке или в общем каталоге
  // (Steam + RAWG). Для этого берём несколько подсказок названия: папки по пути, имя exe, ProductName из свойств файла.
  const popOf = it => it.added ? Math.min(1, Math.log10(1 + it.added) / 5) : (it.src === 'steam' ? .5 : 0);
  const findInLib = (name, exceptId) => {
    const items = Object.entries(lib()).filter(([id]) => id !== exceptId).map(([id, g]) => ({id, name: g.name || '', g}));
    return pickBest(name, items, i => i.name, i => i.g.auto ? 0 : 1);
  };
  function bindDir(id, dir) {
    const g = lib()[id]; if (!g || !dir) return;
    const n = normName(dir), all = [g.dir, ...(g.dirs || [])].filter(Boolean).map(x => String(x).replace(/\\/g, '/').toLowerCase());
    if (all.includes(String(dir).replace(/\\/g, '/').toLowerCase())) return;
    if (!g.dir) g.dir = dir; else { g.dirs = [...(g.dirs || []), dir].slice(0, 20); }
    store.save('library');
  }
  const BAD_PRODUCT = /^(unity|unreal ?engine|ue[45]|microsoft|windows|directx|nvidia|electron|chrome|chromium|steam|launcher|game|app|application|setup|crack|loader)/i;
  // игра, запущенная в эмуляторе: образ → название → каталог (с учётом консоли). Нет в каталоге: создаём карточку «Создано вручную»
  async function resolveEmuGame(m) {
    const L = lib(), plat = m.platform && m.platform !== 'other' ? m.platform : '', hints = [];
    const add = n => { const c = cleanName(n || ''); if (c.length > 1 && !hints.some(h => normName(h) === normName(c))) hints.push(c); };
    add(m.name); for (const h of m.hints || []) add(h.name);
    const finish = id => {
      const g = L[id]; if (!g) return id;
      if (plat) g.playedOn = [...new Set([...(g.playedOn || []), plat])];
      if (m.rom && !g.launch && fs.existsSync(m.rom)) g.launch = m.rom;
      if (m.emu) g.emu = m.emu;
      store.save('library'); emit({type: 'lib'}); return id;
    };
    for (const n of hints.slice(0, 3)) { const t = findInLib(n); if (t) return finish(t.id); }
    let netErr = false;
    for (const n of hints.slice(0, 2)) {
      for (const withPlat of plat ? [true, false] : [false]) {
        let cand = [];
        try { cand = (await P.rawgList(rawgKey(), {search: n, size: 12, minAdded: 0, ...(withPlat ? {platforms: platRawg(plat)} : {})})).results; } catch { netErr = true; }
        const best = pickBest(n, cand, i => i.name, popOf); if (!best) continue;
        const again = L[best.id] ? best.id : (findInLib(best.name) || {}).id; if (again) return finish(again);
        L[best.id] = {name: best.name, status: 'playing', hours: 0, rating: '', note: '', src: 'rawg', added: iso(), auto: true, dir: '', fav: false, folders: [],
          ...(best.img ? {cover: best.img} : {}), ...(best.released ? {released: best.released} : {}), ...(best.genres && best.genres.length ? {genres: best.genres} : {})};
        store.save('library'); emit({type: 'added', id: best.id, name: best.name}); queueMeta(best.id); return finish(best.id);
      }
    }
    // в каталоге игры нет (или нет интернета): карточка «Создано вручную», название и обложку можно поправить на странице игры
    const name = hints[0] || cleanName(m.name || ''); if (!name) return null;
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    L[id] = {name, status: 'playing', hours: 0, rating: '', note: '', src: 'custom', manual: true, added: iso(), auto: true, dir: '', fav: false, folders: [], ...(netErr ? {offlineCreated: true} : {})};
    store.save('library'); emit({type: 'added', id, name}); queueMeta(id);
    return finish(id);
  }
  async function resolveGame(m) {
    const L = lib();
    if (m.id && L[m.id]) return m.id;
    if (m.fromEmu) return resolveEmuGame(m);
    const hints = [];
    const addHint = (name, dir) => { const n = cleanName(name || ''); if (n.length > 1 && !hints.some(h => normName(h.name) === normName(n))) hints.push({name: n, dir}); };
    if (m.id) {                                                    // игра Steam, которой нет в библиотеке
      let name = m.name; if (!name) { try { name = await P.steamName(m.id); } catch {} }
      if (!name) return null;                                      // Steam не назвал игру: не создаём «Steam 12345», попробуем позже
      const twin = findInLib(name, m.id); if (twin) return twin.id;   // та же игра уже добавлена из каталога под другим id (RAWG или вручную)
      L[m.id] = {name, status: 'playing', hours: 0, rating: '', note: '', src: 'steam', added: iso(), auto: true, dir: m.dir || '', fav: false, folders: []};
      store.save('library'); emit({type: 'added', id: m.id, name}); emit({type: 'lib'}); queueMeta(m.id); return m.id;
    }
    for (const h of m.hints || []) addHint(h.name, h.dir);
    if (!hints.length) addHint(m.name, m.dir);
    // 1) свойства exe: у репаков и кряков там часто лежит настоящее название игры
    if (m.exePath && tracker.exeInfo) {
      const ei = await tracker.exeInfo(m.exePath).catch(() => null);
      for (const v of [ei && ei.product, ei && ei.description]) if (v && !BAD_PRODUCT.test(v) && v.length < 80) { const c = cleanName(v); if (c) hints.unshift({name: c, dir: m.dir}); }
    }
    const dir = m.dir || '';
    // 2) уже есть в библиотеке (под любым id): привязываем папку, дубль не создаём
    for (const h of hints.slice(0, 5)) { const t = findInLib(h.name); if (t) { bindDir(t.id, dir || h.dir); emit({type: 'lib'}); return t.id; } }
    // 3) ищем в общем каталоге: Steam + RAWG по каждой подсказке
    for (const h of hints.slice(0, 4)) {
      let cand = [];
      try {
        const [a, b] = await Promise.all([P.steamSearch(h.name).catch(() => []), P.rawgList(rawgKey(), {search: h.name, size: 12, minAdded: 0}).then(r => r.results).catch(() => [])]);
        cand = S.dedupe([...a, ...b], {get: i => i.name});
      } catch {}
      const best = pickBest(h.name, cand, i => i.name, popOf);
      if (!best) continue;
      const again = L[best.id] ? best.id : (findInLib(best.name) || {}).id;     // за время запроса игру могли добавить
      if (again) { bindDir(again, dir || h.dir); emit({type: 'lib'}); return again; }
      L[best.id] = {name: best.name, status: 'playing', hours: 0, rating: '', note: '', src: best.src, added: iso(), auto: true, dir: dir || h.dir || '', fav: false, folders: [],
        ...(best.src === 'rawg' && best.img ? {cover: best.img} : {}), ...(best.released ? {released: best.released} : {}), ...(best.genres && best.genres.length ? {genres: best.genres} : {})};
      store.save('library'); emit({type: 'added', id: best.id, name: best.name}); emit({type: 'lib'}); queueMeta(best.id);
      return best.id;
    }
    // 4) в каталоге такой игры нет (редкая или самодельная): создаём одну запись с очищенным названием
    const name = hints[0] && hints[0].name; if (!name) return null;
    const dup = findInLib(name); if (dup) { bindDir(dup.id, dir); return dup.id; }
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    L[id] = {name, status: 'playing', hours: 0, rating: '', note: '', src: 'custom', added: iso(), auto: true, dir, fav: false, folders: []};
    store.save('library'); emit({type: 'added', id, name}); emit({type: 'lib'}); queueMeta(id);
    return id;
  }
  // слияние дублей: всё накопленное (часы, дни, сессии, папки, избранное) переносится в игру «to»
  function mergeGames(from, to) {
    const L = lib(), a = L[from], b = L[to]; if (!a || !b || from === to) return false;
    b.hours = Math.round(((+b.hours || 0) + (+a.hours || 0)) * 1e6) / 1e6;
    const days = {...(b.days || {})}; for (const [k, v] of Object.entries(a.days || {})) days[k] = Math.round(((days[k] || 0) + v) * 10) / 10; if (Object.keys(days).length) b.days = days;
    const dp = {...(b.dp || {})}; for (const [k, v] of Object.entries(a.dp || {})) { const t = dp[k] = dp[k] || {p: {}}; for (const [pk, pv] of Object.entries(v.p || {})) t.p[pk] = (t.p[pk] || 0) + pv; for (const [ek, ev] of Object.entries(v.e || {})) { t.e = t.e || {}; t.e[ek] = (t.e[ek] || 0) + ev; } } if (Object.keys(dp).length) b.dp = dp;
    const ss = [...(b.sessions || []), ...(a.sessions || [])].sort((x, y) => String(x.s).localeCompare(String(y.s))); if (ss.length) b.sessions = ss.slice(-500);
    const dirs = new Set([b.dir, ...(b.dirs || []), a.dir, ...(a.dirs || [])].filter(Boolean)); const [d0, ...rest] = [...dirs]; b.dir = d0 || ''; b.dirs = rest.slice(0, 20);
    b.playedOn = [...new Set([...(b.playedOn || []), ...(a.playedOn || [])])]; b.folders = [...new Set([...(b.folders || []), ...(a.folders || [])])]; b.fav = !!(b.fav || a.fav);
    for (const k of ['started', 'firstPlayed']) if (a[k] && (!b[k] || a[k] < b[k])) b[k] = a[k];
    if (a.last && (!b.last || a.last > b.last)) b.last = a.last;
    if (!b.finished && a.finished) b.finished = a.finished;
    if (b.status !== 'done' && a.status === 'done') b.status = 'done';
    for (const k of ['rating', 'note', 'cover']) if ((b[k] === '' || b[k] == null) && a[k]) b[k] = a[k];
    delete L[from]; delete store.data.covers[from]; delete meta()[from];
    for (const [k, v] of tracker.alias) if (v === from) tracker.alias.set(k, to);
    store.save('library'); store.save('covers'); store.save('meta');
    return true;
  }
  // данные RAWG для игр библиотеки: среднее время прохождения (для прогресса), платформы, жанры, теги, Metascore
  const metaQ = new Set(); let metaRun = false;
  async function fetchMeta(id) {
    const g = lib()[id]; if (!g) return null;
    try {
      let it = null;
      if (/^r\d+$/.test(id)) it = await P.rawgById(rawgKey(), id.slice(1));
      else { const q = cleanName(g.name), r = await P.rawgList(rawgKey(), {search: q, size: 10, minAdded: 0}); it = pickBest(q, r.results, i => i.name, popOf); }
      const tagNames = {}; for (const t of (it?.tags || []).slice(0, 20)) if (it.tagNames?.[t]) tagNames[t] = it.tagNames[t];
      meta()[id] = it ? {rawgId: +String(it.id).slice(1), name: it.name, avg: it.playtime || 0, v: 2, platforms: it.platforms.length ? it.platforms : it.parents, genres: it.genres, genreSlugs: it.genreSlugs || [], tags: (it.tags || []).slice(0, 20), tagNames, released: it.released, metacritic: it.metacritic, rating: it.rating, at: Date.now()} : {miss: Date.now()};
      store.save('meta'); return meta()[id];
    } catch (e) { return null; } // сеть/лимит: повторим позже
  }
  async function runMeta() {
    if (metaRun) return; metaRun = true;
    try { for (let id; (id = metaQ.values().next().value) !== undefined;) { metaQ.delete(id); if (lib()[id]) { await fetchMeta(id); emit({type: 'meta'}); await sleep(300); } } } finally { metaRun = false; }
  }
  function queueMeta(id) { const m = meta()[id]; if (!m || (m.miss && Date.now() - m.miss > 7 * 864e5) || (m.at && (Date.now() - m.at > 30 * 864e5 || !m.tags || m.v !== 2))) { metaQ.add(id); setTimeout(runMeta, 500); } }
  const wantMeta = () => { for (const id of Object.keys(lib())) queueMeta(id); };

  // служебное: убираем Wallpaper Engine (работает сутками), переносим старые сессии в учёт по дням
  (function cleanup() {
    for (const [id, g] of Object.entries(lib())) {
      if (HARD_IGNORE_APPIDS.has(id) || (g.auto && HARD_IGNORE_NAME.test(String(g.name).trim()))) { delete lib()[id]; delete store.data.covers[id]; delete meta()[id]; continue; }
      if (!g.days && g.sessions?.length) g.days = daysFromSessions(g.sessions);
    }
    store.save('library'); store.save('covers'); store.save('meta');
  })();
  // Дубли из старых версий: пиратская игра раньше создавала отдельную «неизвестную» запись. Склеиваем её с настоящей игрой.
  function mergeAutoDuplicates() {
    let n = 0;
    for (const [id, g] of Object.entries({...lib()})) {
      if (!lib()[id] || !g.auto || g.src !== 'custom') continue;
      const twin = findInLib(g.name, id);
      if (twin && lib()[twin.id] && mergeGames(id, twin.id)) n++;
    }
    return n;
  }
  // записи «Steam 12345» (имя не удалось получить) получают настоящее название
  async function fixSteamNames() {
    for (const [id, g] of Object.entries(lib())) {
      if (!(g.auto && /^Steam \d+$/.test(String(g.name)) && /^\d+$/.test(id))) continue;
      try { const n = await P.steamName(id); if (n && lib()[id]) { lib()[id].name = n; store.save('library'); } } catch {}
    }
  }

  const tracker = new Tracker(store, {resolve: resolveGame, ...trackerOpts});
  tracker.on('event', e => { for (const r of clients) r.write('data: ' + JSON.stringify(e) + '\n\n'); events.emit('event', e); });
  const SW = SWITCH.create({store, dataDir, emit});

  // --- NEXUS Switch (homebrew на консоли): отдельный LAN-порт для данных о времени игры ---
  // Консоль не подключается по USB: приложение на Switch открывается, читает системный журнал
  // и отправляет JSON на этот порт. Код сопряжения — 6 цифр, только из домашней сети.
  const comp = () => { const s = cfg().switch || (cfg().switch = {}); return s.companion || (s.companion = {enabled: true, port: 8788, code: '', lastAt: ''}); };
  const compState = {srv: null, port: 0, error: '', lastFrom: '', lastAt: ''};
  const compCode = () => { const c = comp(); if (!/^\d{6}$/.test(String(c.code || ''))) { c.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); store.save('config'); } return String(c.code); };
  const lanIp = a => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|::1$)/.test(a);
  const lanIps = () => Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && lanIp(n.address)).map(n => n.address);
  const codeOk = t => { const k = compCode(); try { return String(t || '').length === k.length && crypto.timingSafeEqual(Buffer.from(String(t)), Buffer.from(k)); } catch { return false; } };
  const companionInfo = () => {
    const c = comp(), port = +c.port || 8788;
    return {enabled: c.enabled !== false, running: !!(compState.srv && compState.srv.listening), port,
      code: compCode(), urls: lanIps().map(ip => `http://${ip}:${port}`), host: os.hostname(),
      lastAt: c.lastAt || compState.lastAt || '', lastFrom: compState.lastFrom || '', error: compState.error || ''};
  };
  async function companionHandle(req, res) {
    const J = (o, c = 200) => { try { res.writeHead(c, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*'}); res.end(JSON.stringify(o)); } catch {} };
    try {
      const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!lanIp(peer)) return J({ok: false, error: 'Только домашняя сеть'}, 403);
      const u = new URL(req.url, 'http://localhost'), p = u.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') { res.writeHead(204, {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-nexus-code', 'access-control-allow-methods': 'GET, POST, OPTIONS'}); return res.end(); }
      let b = {};
      if (req.method === 'POST') { try { b = JSON.parse((await readBody(req, 4e6)).toString() || '{}') || {}; } catch { b = {}; } }
      const code = b.code || req.headers['x-nexus-code'] || u.searchParams.get('code') || '';
      if (p === '/' || p === '/api/switch/ping' || p === '/ping') {
        if (req.method === 'GET') return J({ok: true, app: 'NEXUS', host: os.hostname(), codeRequired: true});
        if (!codeOk(code)) return J({ok: false, error: 'Неверный код сопряжения'}, 401);
        return J({ok: true, app: 'NEXUS', host: os.hostname(), port: +comp().port || 8788, time: iso(), games: Object.keys(lib()).length});
      }
      if (p === '/api/switch/companion' || p === '/companion' || p === '/api/switch/data') {
        if (req.method !== 'POST') return J({ok: false, error: 'method'}, 405);
        if (!codeOk(code)) return J({ok: false, error: 'Неверный код сопряжения'}, 401);
        const r = SW.applyCompanion(b);
        const c = comp(); c.lastAt = compState.lastAt = r.at || iso(); compState.lastFrom = peer;
        store.save('config');
        if (r.updated || r.added) emit({type: 'lib'});
        return J({ok: true, at: c.lastAt, matched: r.matched, updated: r.updated, added: r.added, games: r.games.slice(0, 40), unmatched: r.unmatched.slice(0, 40)});
      }
      return J({ok: false, error: 'not found'}, 404);
    } catch (e) { return J({ok: false, error: String(e.message || e)}, 500); }
  }
  function companionStop() {
    const s = compState.srv; compState.srv = null; compState.port = 0;
    if (s) { try { s.close(); } catch {} }
  }
  function companionStart() {
    const c = comp();
    if (c.enabled === false) { companionStop(); compState.error = ''; return; }
    const port = Math.max(1024, Math.min(65535, Math.round(+c.port) || 8788));
    if (compState.srv && compState.port === port) return;
    companionStop();
    const srv = http.createServer((req, res) => { companionHandle(req, res); });
    srv.on('error', e => {
      compState.error = e.code === 'EADDRINUSE' ? `Порт ${port} занят другой программой` : String(e.message || e);
      if (compState.srv === srv) { compState.srv = null; compState.port = 0; }
    });
    srv.on('listening', () => { compState.port = port; compState.error = ''; });
    try { srv.listen(port, '0.0.0.0'); srv.unref?.(); compState.srv = srv; }
    catch (e) { compState.error = String(e.message || e); }
  }

  // не больше 3 одновременных поисков обложек, повторный запрос той же игры ждёт первый
  const coverFlight = new Map(); let coverActive = 0; const coverWait = [];
  const coverSlot = () => new Promise(res => { const go = () => { coverActive++; res(); }; if (coverActive < 3) go(); else coverWait.push(go); });
  const coverFree = () => { coverActive--; const n = coverWait.shift(); if (n) n(); };
  function resolveCover(id, name, force) {
    const cv = store.data.covers;
    if (!force && cv[id]) return Promise.resolve(cv[id]);
    const miss = coverMiss.get(id); if (!force && miss && Date.now() - miss < 6 * 3600000) return Promise.resolve(null);
    if (!force && coverFlight.has(id)) return coverFlight.get(id);
    const pr = (async () => { await coverSlot(); try { return await resolveCoverNow(id, name, force); } finally { coverFree(); } })();
    if (!force) { coverFlight.set(id, pr); { const clr = () => coverFlight.delete(id); pr.then(clr, clr); } }
    return pr;
  }
  async function resolveCoverNow(id, name, force) {
    const cv = store.data.covers;
    const k = cfg().keys, isSteam = /^\d+$/.test(id); let r = null;
    try {
      const viaSgdb = async () => { if (!r && k.steamgriddb) { const u = await P.sgdb(k.steamgriddb, {steamId: isSteam ? id : null, name}).catch(() => null); if (u) r = {url: u, banner: false}; } };
      if (force) await viaSgdb(); // «подобрать заново» — сначала SteamGridDB, там обычно больше вариантов
      if (!r && isSteam) { const u = await P.steamPortrait(id); if (u) r = {url: u, banner: false}; }
      await viaSgdb();
      if (!r && rawgKey() && name) { const u = await P.rawgCover(rawgKey(), name).catch(() => null); if (u) r = {url: u, banner: true}; }
    } catch {}
    if (r) { cv[id] = r; store.save('covers'); } else coverMiss.set(id, Date.now());
    return r;
  }
  // Шапка страницы игры: широкий баннер. SteamGridDB (hero) → RAWG → найденная обложка. Результат кэшируется.
  const heroMiss = new Map();
  async function resolveHero(id, name, force) {
    const cv = store.data.covers, ck = 'hero:' + id;
    if (!force && cv[ck] && cv[ck].url) return cv[ck];
    const miss = heroMiss.get(id); if (!force && miss && Date.now() - miss < 6 * 3600000) return null;
    await coverSlot();
    let r = null;
    try {
      const k = cfg().keys, isSteam = /^\d+$/.test(id);
      if (k.steamgriddb) { const u = await P.sgdbHero(k.steamgriddb, {steamId: isSteam ? id : null, name}).catch(() => null); if (u) r = {url: u, src: 'sgdb'}; }
      if (!r && rawgKey() && name) { const u = await P.rawgCover(rawgKey(), name).catch(() => null); if (u) r = {url: u, src: 'rawg'}; }
      if (!r) { const c = cv[id]; if (c && c.url) r = {url: c.url, src: 'cover'}; }
    } catch {} finally { coverFree(); }
    if (r) { cv[ck] = r; store.save('covers'); } else heroMiss.set(id, Date.now());
    return r;
  }
  const masked = () => { const k = cfg().keys, m = v => v ? {set: true, tail: v.slice(-4)} : {set: false}; const sw = cfg().switch || {}, sf = sw.ftp || {}, ui = cfg().ui || {};
    return {keys: {steamgriddb: m(k.steamgriddb), rawg: {set: true, tail: rawgKey().slice(-4), builtin: !k.rawg}, steamKey: m(k.steamKey), steamId: k.steamId, deepl: m(k.deepl)}, launch: cfg().launch || {fullscreen: true}, tracker: cfg().tracker, emulators: cfg().emulators || {}, ui: {accent: ui.accent || '', libraryTab: ['all', 'playing', 'done', 'planned', 'dropped', 'dev', 'manual'].includes(ui.libraryTab) ? ui.libraryTab : 'all', gridFill: ui.gridFill !== false, gridStyle: ['compact', 'wide', 'classic'].includes(ui.gridStyle) ? ui.gridStyle : 'wide', gameScroll: ui.gameScroll === 'classic' ? 'classic' : 'independent'}, switch: {enabled: sw.enabled !== false, autoScan: sw.autoScan !== false, emulatorDirs: sw.emulatorDirs || [], lastScan: sw.lastScan || '', ftp: {host: sf.host || '', port: +sf.port || 21, user: sf.user || '', path: sf.path || 'nand/user/save', passSet: !!sf.pass}, companion: companionInfo()}, desktop: !!hooks.getAutostart, autostart: hooks.getAutostart ? !!hooks.getAutostart() : false}; };
  function patchGame(id, b, imported) {
    const isNew = !lib()[id], g = lib()[id] || (lib()[id] = {name: 'Игра', status: 'planned', hours: '', rating: '', note: '', added: iso()}), prev = isNew ? null : g.status;
    for (const [k, t] of Object.entries(FIELDS)) {
      if (!(k in b)) continue; const v = b[k];
      if (t === 'bool') g[k] = !!v;
      else if (t === 'str') g[k] = String(v ?? '').slice(0, k === 'note' || k === 'desc' ? 5000 : 500);
      else if (t === 'num') g[k] = v === '' || v == null ? '' : Math.max(0, +v || 0);
      else if (t === 'json') {                                    // галерея моментов: [{u: ссылка, t: дата добавления}]
        const now = iso();
        g[k] = Array.isArray(v) ? v.slice(0, 80).map(x => typeof x === 'string' ? {u: x, t: now} : (x || {}))
          .map(x => ({u: String(x.u || x.url || '').slice(0, 600), t: (() => { const d = new Date(x.t || ''); return isNaN(d) ? now : d.toISOString(); })()}))
          .filter(x => SHOT_RE.test(x.u)) : [];
      }
      else g[k] = Array.isArray(v) ? v.map(x => String(x).slice(0, 200)).slice(0, 30) : [];
    }
    if (!['playing', 'done', 'planned', 'dropped'].includes(g.status)) g.status = 'planned';
    if ('folders' in b) g.folders = (g.folders || []).filter(f => store.data.folders[f]);
    if ('playedOn' in b) g.playedOn = [...new Set((g.playedOn || []).map(D.migratePlat).filter(p => D.PLATFORM_BY_ID[p]))];
    if ('coverFit' in b && !['fill', 'banner', ''].includes(g.coverFit)) g.coverFit = '';
    if ('cover' in b && g.cover && !/^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i.test(g.cover)) g.cover = '';
    if (g.rating !== '' && g.rating > 10) g.rating = 10;
    for (const k of ['started', 'finished']) if (g[k] && !DATE_RE.test(g[k])) g[k] = '';
    if (g.progress !== undefined && g.progress !== '') g.progress = Math.min(100, g.progress);
    // даты ставятся сами: «Играю» → дата начала, «Прошёл» → дата окончания (если вы не указали их вручную)
    if (!imported && 'status' in b && g.status !== prev) {
      if (g.status === 'done' && !('finished' in b) && !g.finished) g.finished = ymd();
      if (g.status !== 'done' && prev === 'done' && !('finished' in b)) g.finished = '';
      if (g.status === 'playing' && !('started' in b) && !g.started && !g.firstPlayed) g.started = ymd();
    }
    if (isNew && g.src === 'custom' && !imported) g.manual = true;
    if ('emu' in b && g.emu && !Emu.byId[g.emu]) g.emu = '';
    if ('progress' in b || 'status' in b || 'savePath' in b) progCache.delete(id);
    store.save('library'); if (isNew) queueMeta(id); if ('launch' in b || isNew) scheduleInstalled();
    return g;
  }

  // --- единый каталог: параметры фильтров → запрос к RAWG ---
  // конкретные консоли → id платформ RAWG: сначала по названиям из списка RAWG, запасной вариант D.PLATFORMS[].fb
  const platIds = {};
  async function loadPlatformIds() {
    try {
      const byName = new Map((await P.rawgPlatforms(rawgKey())).map(p => [p.name.toLowerCase(), p.id]));
      for (const pl of D.PLATFORMS) { const ids = pl.names.map(n => byName.get(n.toLowerCase())).filter(Boolean); if (ids.length) platIds[pl.id] = [...new Set(ids)].join(','); }
    } catch {}
  }
  const platRawg = id => platIds[id] || D.PLATFORM_BY_ID[id].fb;
  const SORT_RAWG = {popular: '-added', rating: '-rating', new: '-released', old: 'released', metacritic: '-metacritic', name: 'name', '-added': '-added', '-rating': '-rating', '-released': '-released', '-metacritic': '-metacritic'};
  function catalogParams(q) {
    const list = (v, re) => String(v || '').split(',').map(x => x.trim()).filter(x => re.test(x));
    const platforms = list(q.get('platform'), /^[a-z0-9]{2,10}$/).filter(p => D.PLATFORM_BY_ID[p]);
    const genres = list(q.get('genre'), /^[a-z0-9-]{1,40}$/), tags = list(q.get('tag'), /^[a-z0-9-]{1,50}$/).slice(0, 10);
    // UI присылает ключ группы (coop, horror…) или старый slug. В RAWG уходит массив служебных тегов.
    const tagSlugs = D.tagSlugs(tags);
    const onlyCoop = tags.length === 1 && D.tagKeyOf(tags[0]) === 'coop';
    const from = /^\d{4}$/.test(q.get('from') || '') ? +q.get('from') : 0, to = /^\d{4}$/.test(q.get('to') || '') ? +q.get('to') : 0;
    const rawgPlat = [...new Set(platforms.flatMap(p => String(platRawg(p) || '').split(',')).filter(Boolean))].join(',');
    const rawg = {search: (q.get('q') || '').trim().slice(0, 100), page: Math.max(1, Math.min(500, +q.get('page') || 1)), size: RAWG_MAX, ordering: SORT_RAWG[q.get('ordering') || q.get('sort')] || '-added'};
    if (rawgPlat) rawg.platforms = rawgPlat;
    if (genres.length) rawg.genres = genres.join(',');
    if (tagSlugs.length === 1) rawg.tags = tagSlugs[0];
    if (onlyCoop) rawg.tags_exclude = 'competitive,esports,pvp-only';
    if (from || to) rawg.dates = `${from || 1970}-01-01,${to || new Date().getFullYear() + 1}-12-31`;
    // Switch 2: если RAWG ещё не знает такую платформу, берём игры Switch, вышедшие после запуска консоли
    if (platforms.length && platforms.every(p => p === 'switch2') && !platIds.switch2 && !rawg.dates) rawg.dates = `${D.PLATFORM_BY_ID.switch2.since},${new Date().getFullYear() + 1}-12-31`;
    return {q: rawg.search, platforms, genres, tags, tagSlugs, onlyCoop, from, to, rawg, filtered: !!(rawgPlat || genres.length || tags.length || from || to)};
  }
  // RAWG плохо понимает OR внутри одной группы тегов, поэтому для группы делаем несколько
  // запросов и объединяем выдачу. Для одного тега — обычный запрос.
  async function rawgFiltered(key, o, page, size) {
    const base = {...(o.rawg || {}), page: Math.max(1, +page || 1), size: size || RAWG_MAX, ordering: (o.rawg && o.rawg.ordering) || '-added'};
    const slugs = (o.tagSlugs || []).filter(Boolean);
    if (slugs.length <= 1) return P.rawgList(key, {...base, ...(slugs.length ? {tags: slugs[0]} : {})});
    const chunks = await Promise.all(slugs.map(tag => P.rawgList(key, {...base, tags: tag}).catch(() => ({count: 0, next: false, results: []}))));
    const seen = new Set(), results = [];
    for (const c of chunks) for (const it of c.results || []) if (!seen.has(it.id)) { seen.add(it.id); results.push(it); }
    results.sort((a, b) => (+b.added || 0) - (+a.added || 0));
    return {count: Math.max(0, ...chunks.map(c => +c.count || 0)), next: chunks.some(c => c.next), results};
  }
  // поиск: библиотека + встроенная подборка + Steam + RAWG → один список, дубли склеены, ранжирование модулем search.js.
  // Точное название всегда первое, мусор (саундтреки, DLC, слабые совпадения) отсеян.
  async function catalogSearch(q, o) {
    const items = [];
    if (!o.filtered) {
      for (const [id, g] of Object.entries(lib())) items.push({id, name: g.name, img: g.cover || '', src: g.src === 'rawg' ? 'rawg' : g.src === 'steam' ? 'steam' : 'custom', released: g.released || '', inLib: true});
      for (const [id, name] of D.FEATURED) items.push({id, name, img: '', src: 'steam'});
    }
    const [a, b] = await Promise.all([
      o.filtered ? [] : P.steamSearch(q).catch(() => []),
      rawgFiltered(rawgKey(), {...o, rawg: {...(o.rawg || {}), search: q, ordering: '-added'}}, 1, 40).then(r => r.results).catch(() => [])
    ]);
    items.push(...a, ...b);
    const unique = S.dedupe(items, {get: i => i.name, src: i => i.src === 'rawg' ? 'rawg' : 'x', id: i => i.id});
    const ranked = S.rank(q, unique, {get: i => i.name, pop: popOf});
    // Короткий запрос или транслит: сначала самые известные игры, название которых начинается
    // с раскрытого названия («gta» → Grand Theft Auto, «vedmak» → Witcher, «bog voyny» → God of War).
    // Точное совпадение остаётся первым, поэтому обычный поиск не меняется.
    const pref = S.prefix(q, unique, {get: i => i.name, pop: popOf});
    const exp = S.variants(q).filter(v => v.w < 1 && v.w >= 0.9).map(v => v.Q.raw).filter(Boolean).slice(0, 2);
    const expPref = exp.flatMap(x => S.prefix(x, unique, {get: i => i.name, pop: popOf}));
    const seen = new Set(), ordered = [];
    for (const i of [...expPref, ...pref, ...ranked]) if (!seen.has(i.id)) { seen.add(i.id); ordered.push(i); }
    return ordered.map(i => ({...i, img: i.img || (/^\d+$/.test(i.id) ? CDN_STEAM + i.id + '/header.jpg' : '')}));
  }
  const CDN_STEAM = 'https://cdn.akamai.steamstatic.com/steam/apps/';

  // --- витрина каталога: «Популярное» и «Новинки» ---
  // Порядок и обложки берём с Backloggd (публичные страницы каталога), детали — из RAWG.
  // Если Backloggd недоступен, списки целиком собираются из RAWG. Источники в ответе не раскрываются.
  const BG_EDITION = /\s*[:\-–—]?\s*\b(game of the year|goty|deluxe|definitive|ultimate|complete|special|gold|premium|collector'?s|legendary|anniversary|director'?s cut)\b(?:\s+edition)?\b.*$/i;
  const bgBase = s => String(s || '').replace(BG_EDITION, '').replace(/\s+/g, ' ').trim();
  const showCache = {day: '', t: 0, data: null}, calCache = new Map();
  const mapLimit = async (arr, n, fn) => { const out = new Array(arr.length); let i = 0; await Promise.all(Array.from({length: Math.min(n, arr.length)}, async () => { while (i < arr.length) { const j = i++; out[j] = await fn(arr[j], j); } })); return out; };

  function showcaseIndex() {
    const byRawg = new Map(), byName = new Map(), featByName = new Map();
    for (const [id, name] of D.FEATURED) featByName.set(S.key(name), String(id));
    for (const [id, g] of Object.entries(lib())) {
      byName.set(S.key(g.name), {id, g});
      const rid = /^r\d+$/.test(id) ? id : (meta()[id] && meta()[id].rawgId ? 'r' + meta()[id].rawgId : '');
      if (rid && !byRawg.has(rid)) byRawg.set(rid, {id, g});
    }
    return {byRawg, byName, featByName};
  }
  function showcaseItem(it, cover, bgRating, idx) {
    const year = +(String(it.released || '').slice(0, 4)) || 0;
    const hit = idx.byRawg.get(it.id) || idx.byName.get(S.key(it.name));
    const feat = !hit && idx.featByName.get(S.key(it.name));
    const id = hit ? hit.id : (feat || it.id);
    const img = (hit && hit.g.cover) || cover || it.img || '';
    const rating = Math.round(((+it.rating || 0) || (+bgRating || 0)) * 10) / 10;
    const genres = (it.genres || []).map(x => D.GENRE_RU[x] || x).filter(Boolean).slice(0, 2);
    return {id, name: it.name, img, year, genres, rating: rating || 0, status: hit ? hit.g.status : '', inLib: !!hit};
  }
  function showcaseDedupe(arr) {
    const seen = new Set(), out = [];
    for (const x of arr) {
      const k = S.key(bgBase(x.name)) + '|' + (x.year || 0);
      if (seen.has(k)) continue;
      seen.add(k); out.push(x);
    }
    return out;
  }
  function showcaseMatch(pool, title, year) {
    const b = S.key(bgBase(title)); let best = null, bs = 0;
    for (const it of pool) {
      const k = S.key(bgBase(it.name));
      let sc = k === b ? 1000 : S.score(bgBase(title), it.name);
      if (sc < 780) continue;
      const y = +(String(it.released || '').slice(0, 4)) || 0;
      if (year && y) sc += y === year ? 90 : Math.abs(y - year) <= 1 ? 20 : -120;
      if (sc > bs) { bs = sc; best = it; }
    }
    return bs >= 780 ? best : null;
  }
  async function showcasePool(key) {
    const rs = await Promise.all([
      P.rawgList(key, {ordering: '-added', size: 40}).catch(() => ({results: []})),
      P.rawgList(key, {ordering: '-rating', size: 40}).catch(() => ({results: []})),
      P.rawgList(key, {ordering: '-metacritic', size: 40}).catch(() => ({results: []}))
    ]);
    const m = new Map(); for (const r of rs) for (const it of r.results) if (!m.has(it.id)) m.set(it.id, it);
    return [...m.values()];
  }
  async function showcasePopular(key, idx) {
    const [pop, rating, pool] = await Promise.all([
      BG.list('popular').catch(() => []),
      BG.list('rating').catch(() => []),
      showcasePool(key)
    ]);
    const cand = [], seen = new Set();
    const push = c => { if (!c || seen.has(c.id)) return; seen.add(c.id); cand.push(c); };
    const n = Math.min(14, Math.max(pop.length, rating.length));
    for (let i = 0; i < n; i++) { if (pop[i]) push(pop[i]); if (rating[i]) push(rating[i]); }
    const out = [];
    for (const c of cand) {
      const it = showcaseMatch(pool, c.name, 0);
      if (!it) continue;
      out.push(showcaseItem(it, c.cover, c.rating, idx));
      if (out.length >= 14) break;
    }
    for (const it of pool) { if (out.length >= 14) break; out.push(showcaseItem(it, '', 0, idx)); }
    return showcaseDedupe(out).slice(0, 14);
  }
  async function showcaseFresh(key, idx) {
    const today = ymd(), y0 = new Date().getFullYear();
    let list = [];
    // окно «новинок»: сначала год, затем шире, если заметных релизов мало.
    // Сортировка -added даёт известные игры, а не случайные релизы с нулём оценок.
    for (const years of [1, 2, 3]) {
      const r = await P.rawgList(key, {ordering: '-added', size: 40, dates: `${y0 - years}-01-01,${today}`}).catch(() => ({results: []}));
      const seen = new Set();
      list = [];
      for (const it of r.results) {
        if (!it.released || it.released > today) continue;
        if (!(+it.rating > 0 || +it.added >= 100 || it.metacritic)) continue;
        const k = S.key(bgBase(it.name)) + '|' + it.released.slice(0, 4);
        if (seen.has(k)) continue;
        seen.add(k); list.push(it);
      }
      list.sort((a, b) => String(b.released).localeCompare(String(a.released)));
      if (list.length >= 14) break;
    }
    const top = list.slice(0, 14);
    // вертикальные обложки: подсказки Backloggd по точному названию и году
    const covers = await mapLimit(top, 4, async it => {
      try {
        const a = await BG.autocomplete(it.name), y = +it.released.slice(0, 4);
        const hit = a.find(x => x.year === y) || a.find(x => S.key(bgBase(x.name)) === S.key(bgBase(it.name))) || a[0];
        return hit ? hit.cover : '';
      } catch { return ''; }
    });
    return showcaseDedupe(top.map((it, i) => showcaseItem(it, covers[i], 0, idx))).slice(0, 14);
  }
  async function showcaseData(force) {
    const day = ymd() + '-w' + Math.floor(new Date().getHours() / 6);   // окно в 6 часов: 00, 06, 12, 18
    if (!force && showCache.data && showCache.day === day && Date.now() - showCache.t < 6 * 3600e3) return showCache.data;
    const key = rawgKey(), idx = showcaseIndex();
    const [popular, fresh] = await Promise.all([
      showcasePopular(key, idx).catch(() => []),
      showcaseFresh(key, idx).catch(() => [])
    ]);
    const data = {day, popular, fresh};
    showCache.day = day; showCache.t = Date.now(); showCache.data = data;
    return data;
  }


  // --- «Похожие игры»: по жанрам и тегам ---
  const simCache = new Map();
  async function profileOf(id, name) {
    const m = meta()[id];
    if (m && m.tags) return {name: m.name || name, genres: m.genreSlugs || [], tags: m.tags, year: S ? +(String(m.released || '').slice(0, 4)) || 0 : 0};
    let it = null;
    if (/^r\d+$/.test(id)) it = await P.rawgById(rawgKey(), id.slice(1)).catch(() => null);
    if (!it && name) { const q = cleanName(name), r = await P.rawgList(rawgKey(), {search: q, size: 10, minAdded: 0}).catch(() => ({results: []})); it = pickBest(q, r.results, i => i.name, popOf); }
    if (!it) return null;
    return {name: it.name, genres: it.genreSlugs || [], tags: it.tags || [], year: +String(it.released || '').slice(0, 4) || 0, rawgId: it.id};
  }
  const jacc = (a, b) => { if (!a.length || !b.length) return 0; const B = new Set(b), i = a.filter(x => B.has(x)).length; return i / (a.length + b.length - i); };
  async function similarTo(id, nameHint) {
    const hit = simCache.get(id); if (hit && Date.now() - hit.t < 10 * 60000) return hit.v;
    const g = lib()[id], name = (g && g.name) || nameHint || '';
    const prof = await profileOf(id, name);
    if (!prof || (!prof.genres.length && !prof.tags.length)) return {basis: [], results: []};
    const tags = prof.tags.filter(t => !D.TAG_NOISE.has(t)), self = S.key(prof.name || name);
    const qs = [];
    if (prof.genres.length) qs.push(P.rawgList(rawgKey(), {genres: prof.genres.slice(0, 2).join(','), ordering: '-rating', size: 40}).catch(() => ({results: []})));
    if (tags.length) qs.push(P.rawgList(rawgKey(), {tags: tags.slice(0, 3).join(','), ordering: '-added', size: 40}).catch(() => ({results: []})));
    if (tags.length > 3) qs.push(P.rawgList(rawgKey(), {tags: tags.slice(3, 6).join(','), genres: prof.genres.slice(0, 1).join(','), ordering: '-added', size: 40}).catch(() => ({results: []})));
    const pool = new Map();
    for (const r of await Promise.all(qs)) for (const it of r.results) if (!pool.has(it.id)) pool.set(it.id, it);
    // игры из своей библиотеки тоже участвуют: у них уже сохранены теги
    for (const [lid, lg] of Object.entries(lib())) { const lm = meta()[lid]; if (lid !== id && lm && lm.tags && !pool.has('r' + lm.rawgId)) pool.set('l' + lid, {id: lid, name: lg.name, img: lg.cover || '', src: lg.src, released: lm.released || '', genres: lm.genres || [], genreSlugs: lm.genreSlugs || [], tags: lm.tags, rating: lm.rating || 0, added: 0, inLib: true}); }
    const out = [];
    for (const it of pool.values()) {
      if (S.key(it.name) === self || (id === it.id)) continue;
      const jt = jacc(tags, (it.tags || []).filter(t => !D.TAG_NOISE.has(t))), jg = jacc(prof.genres, it.genreSlugs || []);
      const shared = (it.tags || []).filter(t => tags.includes(t)).length;
      if (!jg && !jt) continue;
      let sc = 3 * jt + 2 * jg + Math.min(shared, 6) * .08 + Math.min(1, (it.rating || 0) / 5) * .35 + popOf(it) * .25;
      if (prof.year && it.released) sc += Math.max(0, .2 - Math.abs(prof.year - (+String(it.released).slice(0, 4) || prof.year)) * .01);
      if (S.score(prof.name, it.name) > 700) sc -= .6;                  // другие части той же серии не засоряют блок
      out.push({it, sc, shared});
    }
    out.sort((a, b) => b.sc - a.sc);
    const seenKey = new Set(); for (let i = 0; i < out.length; i++) { const k = S.key(out[i].it.name); if (seenKey.has(k)) out.splice(i--, 1); else seenKey.add(k); }   // одна игра из библиотеки и из RAWG — одна карточка
    const results = out.slice(0, 14).map(({it, sc, shared}) => ({id: it.id, name: it.name, img: it.img || (/^\d+$/.test(it.id) ? CDN_STEAM + it.id + '/header.jpg' : ''), src: it.src, released: it.released || '', genres: it.genres || [], tags: (it.tags || []).filter(t => tags.includes(t)).slice(0, 3), score: Math.round(sc * 100) / 100, shared}));
    const v = {basis: {genres: prof.genres, tags: tags.slice(0, 6)}, results};
    if (simCache.size > 100) simCache.delete(simCache.keys().next().value); simCache.set(id, {t: Date.now(), v});
    return v;
  }

  // --- серия игр (RAWG game-series; если у RAWG серии нет, ищем части по общему началу названия) ---
  const serCache = new Map();
  const stemOf = n => String(n).split(/[:–—]| - /)[0].replace(/\s+\b(\d+|[ivxlc]{1,5})\b.*$/i, '').replace(/\s+/g, ' ').trim();
  function commonPrefix(names) {
    const split = names.map(n => String(n).split(/\s+/)); let out = [];
    for (let i = 0; i < split[0].length; i++) { const w = split[0][i]; if (split.every(a => a[i] && a[i].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) out.push(w); else break; }
    return out.join(' ').replace(/[:\-–—,]+$/, '').trim();
  }
  async function seriesOf(id, nameHint) {
    const hit = serCache.get(id); if (hit && Date.now() - hit.t < 3600e3) return hit.v;
    const g = lib()[id], name = (g && g.name) || nameHint || '', k = rawgKey();
    let rid = /^r\d+$/.test(id) ? id.slice(1) : (meta()[id] && meta()[id].rawgId) || '', self = null;
    if (!rid && name) { const q = cleanName(name), r = await P.rawgList(k, {search: q, size: 10, minAdded: 0}).catch(() => ({results: []})); self = pickBest(q, r.results, i => i.name, popOf); if (self) rid = String(self.id).replace(/^r/, ''); }
    if (!rid) return {name: '', total: 0, parts: [], dlcs: [], dlcTotal: 0};
    const [series, additions] = await Promise.all([
      P.rawgSeries(k, rid).catch(() => []),
      P.rawgAdditions(k, rid).catch(() => [])
    ]);
    let parts = series;
    if (!self) self = await P.rawgById(k, rid).catch(() => null);
    if (self) parts = [self, ...parts];
    const stem = stemOf(cleanName(name || (self && self.name) || ''));
    if (parts.length < 2 && stem.length >= 3) { const r = await P.rawgList(k, {search: stem, size: 30, minAdded: 0}).catch(() => ({results: []})); parts.push(...r.results.filter(i => S.score(stem, i.name) >= 800)); }
    parts = S.dedupe(parts.filter(p => p && !S.prep(p.name).junk), {get: i => i.name, src: () => 'x', id: i => i.id});
    parts.sort((a, b) => (a.released || '9999').localeCompare(b.released || '9999'));
    const mine = Object.entries(lib());
    const ownOf = n => mine.find(([, lg]) => S.score(n, lg.name) >= 990);
    const out = parts.map(p => { const own = ownOf(p.name); return {id: own ? own[0] : p.id, name: p.name, img: (own && own[1].cover) || p.img || '', released: p.released || '', inLib: !!own, current: String(p.id) === 'r' + rid || (own && own[0] === id) || p.id === id}; });
    // DLC — отдельно от частей серии: издания, наборы и саундтреки в дополнения не попадают
    const DLC_EDITION = /\b(complete|definitive|ultimate|deluxe|gold|premium|collector'?s?|goty|game of the year|edition|bundle|season pass|expansion pass|expansion pack|upgrade|soundtrack|artbook|art book|cosmetic pack)\b/i;
    const seen = new Set(out.map(p => S.prep(p.name).core || S.prep(p.name).compact));
    const dlcs = [];
    for (const a of additions) {
      if (!a || !a.name || S.prep(a.name).junk || DLC_EDITION.test(a.name)) continue;
      const key = S.prep(a.name).core || S.prep(a.name).compact;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const own = ownOf(a.name);
      dlcs.push({id: own ? own[0] : a.id, name: a.name, img: (own && own[1].cover) || a.img || '', released: a.released || '', inLib: !!own, current: false, isDlc: true});
    }
    dlcs.sort((a, b) => (a.released || '9999').localeCompare(b.released || '9999'));
    const sname = (parts.length > 1 && commonPrefix(parts.map(p => p.name))) || stem || name;
    const v = {name: sname, total: out.length, parts: out, dlcs, dlcTotal: dlcs.length};
    if (serCache.size > 100) serCache.delete(serCache.keys().next().value); serCache.set(id, {t: Date.now(), v}); return v;
  }

  // --- «На устройстве»: только реальный файл запуска (exe/образ) или Steam. Пустая папка/каталог сами по себе не считаются установкой ---
  function computeInstalled(id, g) {
    if (g.launch) {
      const c = Launch.checkPath(g.launch);
      if (c.exists && (c.type === 'exe' || c.type === 'image' || (c.type === 'folder' && g.emu))) return 'path';
    }
    if (/^\d+$/.test(id) && tracker.steamGames.some(s => s.appid === id)) return 'steam';
    return '';
  }
  function refreshInstalled() {
    let changed = false;
    for (const [id, g] of Object.entries(lib())) { const via = computeInstalled(id, g); if (!!g.installed !== !!via || (g.installedVia || '') !== via) { g.installed = !!via; g.installedVia = via; changed = true; } }
    if (changed) { store.save('library'); emit({type: 'lib'}); }
    return changed;
  }
  let instT = null; const scheduleInstalled = () => { clearTimeout(instT); instT = setTimeout(() => { try { refreshInstalled(); } catch {} }, 400); if (instT.unref) instT.unref(); };
  const steamRoots = () => [...new Set(tracker.steamCommons.map(c => path.dirname(path.dirname(c))))];
  const findCtx = id => ({appid: id, steamRoots: steamRoots(), emulators: cfg().emulators || {}});
  const dirOf = g => [g.dir, ...(Array.isArray(g.dirs) ? g.dirs : [])].filter(Boolean).find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) || '';

  // --- реальный прогресс: вручную → «Пройдено» → достижения Steam → сохранения ---
  const progressOf = async (id, force) => {
    const g = lib()[id]; if (!g) return {pct: null, source: 'none'};
    if (g.progress !== '' && g.progress != null && !isNaN(+g.progress)) return {pct: Math.min(100, Math.max(0, Math.round(+g.progress))), source: 'manual'};
    if (g.status === 'done') return {pct: 100, source: 'done'};
    const hit = progCache.get(id); if (!force && hit && Date.now() - hit.t < 600e3) return hit.v;
    let v = {pct: null, source: 'none'};
    const k = cfg().keys;
    if (/^\d+$/.test(id) && k.steamKey && k.steamId) {
      try { const a = await P.steamAchievements(k.steamKey, k.steamId, id); if (a && a.total) v = {pct: Math.round(a.unlocked / a.total * 100), source: 'achievements', unlocked: a.unlocked, total: a.total}; } catch {}
    }
    if (v.pct == null && g.savePath) {
      try { const r = Prog.scan(g.savePath); if (r) v = {pct: r.pct, source: 'save', file: r.file, key: r.key}; } catch {}
    }
    if (progCache.size > 200) progCache.delete(progCache.keys().next().value);
    progCache.set(id, {t: Date.now(), v});
    return v;
  };

  // --- часы Steam: обновляем только вверх (локальный учёт может быть точнее), новые игры не добавляем ---
  async function syncSteamHours() {
    const k = cfg().keys; if (!k.steamKey || !k.steamId) return {ok: false, error: 'Укажите Steam Web API Key и SteamID64'};
    const owned = await P.steamOwned(k.steamKey, k.steamId);
    let updated = 0, checked = 0, changed = false;
    const active = new Set(((tracker.status() || {}).now || []).map(x => x.id));
    for (const s of owned) {
      const g = lib()[s.appid]; if (!g) continue; checked++;
      if (active.has(s.appid)) continue;                 // игру сейчас считает локальный трекер: не задваиваем сессию
      const h = Math.round(s.minutes / 60 * 100) / 100;
      if (h > (+g.hours || 0) + 0.0001) { g.hours = h; updated++; changed = true; }
      if (s.last) { const last = new Date(s.last * 1000).toISOString(); if (!g.last || last > g.last) { g.last = last; changed = true; } }
    }
    if (changed) { store.save('library'); emit({type: 'lib'}); }
    return {ok: true, updated, checked, total: owned.length, at: iso()};
  }

  async function api(req, res, u) {
    const p = u.pathname, m = req.method, J = (o, c = 200) => { res.writeHead(c, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(o)); };
    const body = async () => { try { return JSON.parse((await readBody(req, 5e6)).toString() || '{}'); } catch { return {}; } };
    let x;
    if (p === '/api/events') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'}); res.write('retry: 3000\n\n');
      clients.add(res); const ka = setInterval(() => res.write(': ka\n\n'), 25000); req.on('close', () => { clearInterval(ka); clients.delete(res); }); return;
    }
    if (p === '/api/mobile') {                                    // ссылка для телефона (только на самом компьютере)
      const info = () => { const mm = mob(), port2 = server.address() ? server.address().port : mm.port, ips = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && privIp(n.address)).map(n => n.address);
        return {enabled: !!mm.enabled, active: !!server.address() && server.address().address !== '127.0.0.1', port: mm.port, token: mm.token, urls: mm.enabled && mm.token ? ips.map(ip => `http://${ip}:${mm.port || port2}/?t=${mm.token}`) : []}; };
      if (m === 'GET') return J(info());
      if (m === 'PUT') { const b = await body(), mm = mob(); if ('enabled' in b) { mm.enabled = !!b.enabled; if (mm.enabled && !mm.token) mm.token = crypto.randomBytes(16).toString('hex'); } if (b.port) mm.port = Math.max(1024, Math.min(65535, Math.round(+b.port) || 8787)); store.save('config'); return J({...info(), restart: true}); }
    }
    if (p === '/api/mobile/token' && m === 'POST') { mob().token = crypto.randomBytes(16).toString('hex'); store.save('config'); return J({ok: true}); }
    if (p === '/api/desktop/quit' && m === 'POST') { if (!hooks.quit) return J({ok: false}); setTimeout(hooks.quit, 200); return J({ok: true}); }
    if (p === '/api/desktop/restart' && m === 'POST') { if (!hooks.restart) return J({ok: false}); setTimeout(hooks.restart, 300); return J({ok: true}); }
    if (p === '/api/lib' && m === 'GET') return J(lib());
    if ((x = p.match(/^\/api\/lib\/([\w-]+)$/))) {
      if (!ID_RE.test(x[1])) return J({error: 'bad id'}, 400);
      if (m === 'PUT') { const g = patchGame(x[1], await body()); return J(g); }
      if (m === 'DELETE') { delete lib()[x[1]]; delete store.data.covers[x[1]]; delete store.data.covers['hero:' + x[1]]; store.save('library'); store.save('covers'); return J({ok: true}); }
    }
    if (p === '/api/lib/import' && m === 'POST') {
      const b = await body(), src = b.lib && typeof b.lib === 'object' ? b.lib : null; if (!src) return J({error: 'Неверный файл'}, 400);
      let n = 0; if (b.mode === 'replace') store.data.library = {};
      if (b.folders && typeof b.folders === 'object') { for (const [fid, f] of Object.entries(b.folders)) if (/^f\w+$/.test(fid) && f && typeof f.name === 'string' && !store.data.folders[fid]) store.data.folders[fid] = {name: f.name.slice(0, 40), created: f.created || iso()}; store.save('folders'); }
      if (b.profile && typeof b.profile === 'object' && !store.data.profile.name && !store.data.profile.bio) { Object.assign(store.data.profile, {name: String(b.profile.name || '').slice(0, 60), bio: String(b.profile.bio || '').slice(0, 600)}); store.save('profile'); }
      for (const [id, g] of Object.entries(src)) if (ID_RE.test(id) && g && typeof g === 'object' && (b.mode === 'replace' || !lib()[id])) { patchGame(id, g, true); for (const k of ['sessions', 'days', 'dp', 'added', 'firstPlayed', 'last', 'manual']) if (g[k]) lib()[id][k] = g[k]; n++; }
      store.save('library');
      emit({type: 'lib'}); return J({ok: true, n});
    }
    if (p === '/api/export') { res.writeHead(200, {'content-type': 'application/json', 'content-disposition': 'attachment; filename="nexus-library.json"'}); return res.end(JSON.stringify({version: 3, lib: lib(), profile: store.data.profile, folders: store.data.folders}, null, 2)); }
    if (p === '/api/config') {
      if (m === 'GET') return J(masked());
      if (m === 'PUT') {
        const b = await body();
        for (const [k, v] of Object.entries(b.keys || {})) if (k in cfg().keys) cfg().keys[k] = v == null ? '' : String(v).trim().slice(0, 200);
        if (b.tracker) { const t = cfg().tracker, n = b.tracker;
          for (const k of ['enabled', 'autoAdd', 'autoStatus']) if (k in n) t[k] = !!n[k];
          for (const k of ['folders', 'ignore']) if (Array.isArray(n[k])) t[k] = n[k].map(s => String(s).trim()).filter(Boolean).slice(0, 100); }
        if (b.launch && typeof b.launch === 'object') cfg().launch = {...(cfg().launch || {}), fullscreen: b.launch.fullscreen !== false};
        if (b.ui && typeof b.ui === 'object') {
          const ui = cfg().ui = cfg().ui || {};
          if ('accent' in b.ui) { const a = String(b.ui.accent || '').trim(); ui.accent = /^#[0-9a-f]{6}$/i.test(a) ? a : ''; }
          if ('libraryTab' in b.ui) ui.libraryTab = ['all', 'playing', 'done', 'planned', 'dropped', 'dev', 'manual'].includes(b.ui.libraryTab) ? b.ui.libraryTab : 'all';
          if ('gridFill' in b.ui) ui.gridFill = b.ui.gridFill !== false;
          if ('gridStyle' in b.ui) ui.gridStyle = ['compact', 'wide', 'classic'].includes(b.ui.gridStyle) ? b.ui.gridStyle : 'wide';
          if ('gameScroll' in b.ui) ui.gameScroll = b.ui.gameScroll === 'classic' ? 'classic' : 'independent';
        }
        if (b.emulators && typeof b.emulators === 'object') for (const [k, v] of Object.entries(b.emulators)) if (Emu.byId[k]) { if (!v) delete cfg().emulators[k]; else cfg().emulators[k] = String(v).slice(0, 500); }
        if (b.switch && typeof b.switch === 'object') {
          const s = cfg().switch = cfg().switch || {}, n = b.switch;
          for (const k of ['enabled', 'autoScan']) if (k in n) s[k] = !!n[k];
          if (Array.isArray(n.emulatorDirs)) s.emulatorDirs = n.emulatorDirs.map(x => String(x).trim()).filter(Boolean).slice(0, 10);
          if (n.ftp && typeof n.ftp === 'object') {
            const f = s.ftp = s.ftp || {};
            if ('host' in n.ftp) f.host = String(n.ftp.host || '').trim().slice(0, 200);
            if ('port' in n.ftp) f.port = Math.min(65535, Math.max(1, +n.ftp.port || 21));
            if ('user' in n.ftp) f.user = String(n.ftp.user || '').trim().slice(0, 100);
            if ('pass' in n.ftp) f.pass = String(n.ftp.pass || '').slice(0, 200);
            if ('path' in n.ftp) f.path = String(n.ftp.path || 'nand/user/save').trim().slice(0, 300) || 'nand/user/save';
          }
          if (n.companion && typeof n.companion === 'object') {
            const c = s.companion = s.companion || {};
            if ('enabled' in n.companion) c.enabled = !!n.companion.enabled;
            if ('port' in n.companion) c.port = Math.min(65535, Math.max(1024, Math.round(+n.companion.port) || 8788));
            if (n.companion.regenerate || n.companion.code === 'new') c.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
          }
        }
        coverMiss.clear(); heroMiss.clear(); store.save('config'); tracker.buildRoots(); companionStart(); return J(masked());
      }
    }
    if (p === '/api/config/test' && m === 'POST') {
      const b = await body(), k = cfg().keys;
      try {
        if (b.provider === 'steamgriddb') { if (!k.steamgriddb) throw new Error('Ключ не задан'); if (!(await P.sgdb(k.steamgriddb, {name: 'Half-Life'}))) throw new Error('Ответ пустой'); }
        else if (b.provider === 'rawg') { if (!(await P.rawgSearch(rawgKey(), 'Half-Life')).length) throw new Error('Ответ пустой'); }
        else if (b.provider === 'deepl') { if (!k.deepl) throw new Error('Ключ не задан'); const r = await Tr.translate('Open world action adventure game.', {cfg: {deepl: k.deepl}, cache: {}, fetch: hooks.fetch}); if (!r.translated || r.via !== 'deepl') throw new Error('Перевод не получен'); }
        else if (b.provider === 'steam') { if (!k.steamKey || !k.steamId) throw new Error('Нужны ключ и SteamID64'); const g = await P.steamOwned(k.steamKey, k.steamId); return J({ok: true, msg: `Работает, игр в профиле: ${g.length}`}); }
        else throw new Error('Неизвестный источник');
        return J({ok: true, msg: 'Работает'});
      } catch (e) { return J({ok: false, msg: String(e.message || e).replace(/(key=)[^&\s]+/g, '$1***')}); }
    }
    if (p === '/api/search') {   // подсказки при вводе: библиотека + Steam + RAWG + встроенный каталог, лучшее совпадение всегда первое
      const q = (u.searchParams.get('q') || '').trim().slice(0, 100); if (!q) return J([]);
      return J((await catalogSearch(q, {})).slice(0, 10));
    }
    if (p === '/api/cover') {
      const id = u.searchParams.get('id') || ''; if (!ID_RE.test(id)) return J({error: 'bad id'}, 400);
      const r = await resolveCover(id, u.searchParams.get('name') || lib()[id]?.name || '', u.searchParams.get('force') === '1'); return J(r || {});
    }
    if (p === '/api/hero') {   // баннер для шапки страницы игры (подтягивается сразу, если своей картинки нет)
      const id = u.searchParams.get('id') || ''; if (!ID_RE.test(id)) return J({error: 'bad id'}, 400);
      const r = await resolveHero(id, u.searchParams.get('name') || lib()[id]?.name || '', u.searchParams.get('force') === '1'); return J(r || {});
    }
    if (p === '/api/showcase') {   // витрина каталога: «Популярное» и «Новинки» (кэш 6 часов, обновление раз в сутки)
      try { return J(await showcaseData(u.searchParams.get('force') === '1')); }
      catch (e) { return J({day: '', popular: [], fresh: [], error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}); }
    }
    if (p === '/api/random') {   // рулетка «Что поиграть?»: случайная выборка из популярной части каталога без слабых игр
      try {
        const key = rawgKey();
        const genre = (u.searchParams.get('genre') || '').slice(0, 40), tag = (u.searchParams.get('tag') || '').slice(0, 50);
        const platform = (u.searchParams.get('platform') || '').slice(0, 10), time = (u.searchParams.get('time') || '').slice(0, 2);
        const base = {ordering: '-added', size: RAWG_MAX};
        if (genre) base.genres = genre;
        if (tag) base.tags = tag;
        if (platform && D.PLATFORM_BY_ID[platform]) base.platforms = platRawg(platform);
        const bucket = h => h <= 10 ? 's' : h <= 25 ? 'm' : h <= 50 ? 'l' : 'xl';
        const good = it => {
          const r = +it.rating || 0, added = +it.added || 0, mc = +it.metacritic || 0;
          if (r < 3.0) return false;                              // совсем слабые оценки не показываем
          if (!(r >= 3.5 || mc >= 70)) return false;              // нужна нормальная оценка или сильный Metascore
          if (added < 50 && mc < 70) return false;                // и совсем неизвестные/непопулярные тоже
          if (time) { const h = +it.playtime || 0; if (h && bucket(h) !== time) return false; }
          return true;
        };
        const pages = [1, 2, 3].map(() => 1 + Math.floor(Math.random() * RAWG_MAX_PAGE));
        const chunks = await Promise.all(pages.map(page => P.rawgList(key, {...base, page}).catch(() => ({results: []}))));
        const seen = new Set(), out = [];
        for (const c of chunks) for (const it of c.results || []) {
          if (seen.has(it.id) || !good(it)) continue;
          seen.add(it.id); out.push(it);
        }
        for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
        if (!out.length) {                                          // редкие фильтры: добираем из самых популярных
          const c = await P.rawgList(key, {...base, page: 1}).catch(() => ({results: []}));
          for (const it of c.results || []) if (good(it) && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
        }
        return J({results: out.slice(0, 24)});
      } catch (e) { return J({results: [], error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if (p === '/api/catalog' || p === '/api/rawg/browse') {   // единый каталог: поиск, платформы, жанры, теги, дата выхода
      const o = catalogParams(u.searchParams), size = CATALOG_PAGE;
      try {
        if (o.q) {
          const items = await catalogSearch(o.q, o), pages = Math.max(1, Math.ceil(items.length / size)), page = Math.min(Math.max(1, o.rawg.page || 1), pages);
          return J({count: items.length, page, pages, page_size: size, next: page < pages, results: items.slice((page - 1) * size, page * size)});
        }
        // Клиентская страница по 60 игр. RAWG отдаёт максимум 40 за запрос и не пускает дальше 250-й страницы,
        // поэтому собираем страницу из нескольких запросов и честно ограничиваем число страниц.
        const maxPages = Math.ceil((RAWG_MAX_PAGE * RAWG_MAX) / size);
        const wanted = Math.min(Math.max(1, o.rawg.page || 1), maxPages), start = (wanted - 1) * size;
        const first = Math.floor(start / RAWG_MAX) + 1, last = Math.floor((start + size - 1) / RAWG_MAX) + 1;
        const reqs = [];
        for (let rp = first; rp <= last && rp <= RAWG_MAX_PAGE; rp++) reqs.push(rawgFiltered(rawgKey(), o, rp, RAWG_MAX).catch(() => ({count: 0, results: []})));
        const chunks = await Promise.all(reqs);
        const total = chunks.reduce((m, c) => Math.max(m, c.count || 0), 0);
        const count = Math.min(total, RAWG_MAX_PAGE * RAWG_MAX);
        const pages = Math.max(1, Math.ceil(count / size)), page = Math.min(wanted, pages);
        const all = chunks.flatMap(c => c.results || []), off = start - (first - 1) * RAWG_MAX;
        const results = page === wanted ? all.slice(off, off + size) : [];
        return J({count, page, pages, page_size: size, next: page < pages, results});
      } catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if (p === '/api/tags') {
      let raw = []; try { raw = await P.rawgTags(rawgKey()); } catch {}
      const counts = new Map(raw.filter(t => !D.TAG_NOISE.has(t.slug) && !D.TAG_HIDE.has(t.slug)).map(t => [t.slug, +t.count || 0]));
      // В интерфейс отдаём только канонические группы и полезные одиночные теги.
      // Никаких «Кооператив» + «cooperative» двумя кнопками и субъективных ярлыков.
      const groups = D.TAG_GROUPS.map(g => ({
        slug: g.key, name: g.label, label: g.label, key: g.key, group: true, tags: g.slugs,
        count: g.slugs.reduce((n, s) => n + (counts.get(s) || 0), 0)
      }));
      const singles = D.TAG_SINGLE.filter(s => !D.TAG_NOISE.has(s) && !D.TAG_HIDE.has(s)).map(s => ({
        slug: s, name: D.TAG_RU[s] || s.replace(/-/g, ' '), label: D.TAG_RU[s] || s.replace(/-/g, ' '), key: s, group: false, tags: [s], count: counts.get(s) || 0
      })).filter(t => !raw.length || t.count > 0);
      return J([...groups, ...singles]);
    }
    if (p === '/api/studios') {                                   // поиск студий и издателей для страниц
      try { return J(await P.rawgStudios(rawgKey(), (u.searchParams.get('q') || '').slice(0, 100))); }
      catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if ((x = p.match(/^\/api\/studio\/(developer|publisher)\/(\d+)$/))) {
      try { return J(await P.rawgStudio(rawgKey(), x[1], x[2], u.searchParams.get('page') || 1)); }
      catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if (p === '/api/calendar') {                                  // календарь релизов: ближайшие месяцы
      try {
        const today = ymd(), months = Math.max(1, Math.min(12, +u.searchParams.get('months') || 6));
        const fromQ = u.searchParams.get('from') || '', toQ = u.searchParams.get('to') || '';
        const ckey = ['v6', today, months, fromQ, toQ].join('|'), hit = calCache.get(ckey);
        if (hit && Date.now() - hit.t < 30 * 60e3) return J(hit.v);
        const iso = d => d.toISOString().slice(0, 10);
        // Окна запросов. Раньше брался один общий диапазон и 120 самых популярных игр на все месяцы сразу:
        // ближайший месяц забивал выдачу, дальние месяцы оставались пустыми (а setMonth() ещё и «перепрыгивал» месяц 31-го числа).
        // Теперь у каждого месяца свой запрос, поэтому календарь заполнен равномерно.
        const wins = [];
        if (DATE_RE.test(fromQ) && DATE_RE.test(toQ)) wins.push([fromQ, toQ]);
        else {
          const t0 = new Date(today + 'T12:00:00'), y = t0.getFullYear(), m0 = t0.getMonth();
          for (let i = 0; i < months; i++) wins.push([i === 0 ? today : iso(new Date(Date.UTC(y, m0 + i, 1))), iso(new Date(Date.UTC(y, m0 + i + 1, 0)))]);
        }
        const errs = []; let okCount = 0;
        const jobs = wins.flatMap(([a, b], wi) => (wi < 2 ? [1, 2] : [1]).map(page => ({a, b, wi, page})));
        const got = await mapLimit(jobs, 4, async j => { try { const r = await P.rawgCalendar(rawgKey(), j.a, j.b, j.page); okCount++; return {wi: j.wi, results: r.results || []}; } catch (e) { errs.push(e); return {wi: j.wi, results: []}; } });
        if (!okCount && errs.length) throw errs[0];
        const seen = new Set(), perWin = wins.map(() => []);
        for (const g of got) for (const it of g.results) { if (!it.released || seen.has(it.id)) continue; seen.add(it.id); perWin[g.wi].push(it); }
        const results = [];
        for (const arr of perWin) {
          arr.sort((a, b) => (+b.added || 0) - (+a.added || 0));
          // только по-настоящему ожидаемые: ещё не вышли, есть точная дата и много людей уже добавили игру к себе
          const keep = arr.filter(it => String(it.released) >= today && (+it.added || 0) >= 250).slice(0, 14);
          results.push(...keep);
        }
        results.sort((a, b) => String(a.released).localeCompare(String(b.released)) || (+b.added || 0) - (+a.added || 0));
        const mm = new Map();
        for (const it of results) { const key = String(it.released).slice(0, 7); if (!mm.has(key)) mm.set(key, []); mm.get(key).push(it); }
        const out = {from: wins[0][0], to: wins[wins.length - 1][1], total: results.length, months: [...mm.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({key, items}))};
        calCache.set(ckey, {t: Date.now(), v: out}); if (calCache.size > 12) calCache.delete(calCache.keys().next().value);
        return J(out);
      } catch (e) { return J({from: '', to: '', total: 0, months: [], error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if ((x = p.match(/^\/api\/series\/([\w-]+)$/))) {            // «Серия игр»: все части франшизы по порядку + отдельно DLC
      try { return J(await seriesOf(x[1], (u.searchParams.get('name') || '').slice(0, 200))); } catch (e) { return J({name: '', total: 0, parts: [], dlcs: [], dlcTotal: 0, error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}); }
    }
    if ((x = p.match(/^\/api\/progress\/([\w-]+)$/)) && m === 'GET') {   // реальный прогресс: ручной, достижения Steam или сохранения
      if (!lib()[x[1]]) return J({error: 'not found'}, 404);
      try { return J(await progressOf(x[1], u.searchParams.get('force') === '1')); } catch (e) { return J({pct: null, source: 'none', error: String(e.message)}); }
    }
    if (p === '/api/translate' && m === 'POST') {            // перевод описания на русский (кэшируется)
      const t = String((await body()).text || '').slice(0, 4000), r = await Tr.translate(t, {cfg: {deepl: cfg().keys.deepl}, cache: store.data.translations, onSave: () => store.save('translations'), fetch: hooks.fetch});
      return J({text: r.text, translated: r.translated});
    }
    if (p === '/api/installed') { const ids = {}; for (const [id, g] of Object.entries(lib())) if (g.installed) ids[id] = g.installedVia || 'path'; for (const s of tracker.steamGames) ids[s.appid] = ids[s.appid] || 'steam'; return J(ids); }
    if ((x = p.match(/^\/api\/find\/([\w-]+)$/)) && m === 'GET') {   // автопоиск файла запуска и сохранений
      const g = lib()[x[1]]; if (!g) return J({error: 'not found'}, 404); const d = dirOf(g);
      return J({dir: d, exes: d ? SF.findExes(d, g.name) : [], saves: SF.findSaves(g, findCtx(x[1]))});
    }
    if ((x = p.match(/^\/api\/find\/([\w-]+)\/auto$/)) && m === 'POST') {   // заполняет пустые поля, если уверенность высокая
      const g = lib()[x[1]]; if (!g) return J({error: 'not found'}, 404); const set = {}, d = dirOf(g);
      if (!g.launch && d) { const e = SF.findExes(d, g.name)[0]; if (e && e.score >= 120) { g.launch = e.path; set.launch = e.path; } }
      if (!g.savePath) { const s = SF.findSaves(g, findCtx(x[1])).filter(c => c.score >= 76 && c.kind !== 'emulator')[0]; if (s) { g.savePath = s.path; set.savePath = s.path; } }
      if (Object.keys(set).length) { store.save('library'); scheduleInstalled(); emit({type: 'lib'}); }
      return J({ok: true, set});
    }
    if ((x = p.match(/^\/api\/similar\/([\w-]+)$/))) {
      if (!ID_RE.test(x[1])) return J({error: 'bad id'}, 400);
      try { return J(await similarTo(x[1], (u.searchParams.get('name') || '').slice(0, 200))); } catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***'), results: []}, 502); }
    }
    if (p === '/api/wishlist' && m === 'GET') return J(wishes());
    if (p === '/api/wishlist' && m === 'POST') {            // добавить или обновить игру в «желаемом»
      const b = await body(), id = String(b.id || ''); if (!ID_RE.test(id)) return J({error: 'bad id'}, 400);
      const w = wishes(), img = v => { v = String(v || '').trim(); return /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i.test(v) ? v.slice(0, 600) : ''; };
      if (!w[id] && Object.keys(w).length >= 300) return J({error: 'Слишком много игр в желаемом'}, 400);
      const prev = w[id] || {};
      w[id] = {name: String(b.name || prev.name || '').trim().slice(0, 200), img: img(b.img) || prev.img || '', released: DATE_RE.test(b.released || '') ? b.released : (prev.released || ''), added: prev.added || new Date().toISOString(), notified: !!prev.notified && (prev.released || '') === (DATE_RE.test(b.released || '') ? b.released : (prev.released || ''))};
      store.save('wishlist'); return J(w);
    }
    if ((x = p.match(/^\/api\/wishlist\/([\w-]+)$/)) && m === 'DELETE') { delete wishes()[x[1]]; store.save('wishlist'); return J(wishes()); }
    if (p === '/api/notifs' && m === 'GET') return J({items: notifs(), unread: notifs().filter(n => !n.read).length});
    if (p === '/api/notifs' && m === 'DELETE') { store.data.notifs = []; store.save('notifs'); return J({items: [], unread: 0}); }
    if (p === '/api/notifs/read' && m === 'POST') { for (const n of notifs()) n.read = true; store.save('notifs'); return J({items: notifs(), unread: 0}); }
    if (p === '/api/profile') {
      if (m === 'GET') return J(store.data.profile);
      if (m === 'PUT') {
        const b = await body(), pr = store.data.profile, img = v => { v = String(v || '').trim(); return /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i.test(v) ? v.slice(0, 600) : ''; };
        if ('name' in b) pr.name = String(b.name || '').trim().slice(0, 60);
        if ('bio' in b) pr.bio = String(b.bio || '').trim().slice(0, 600);
        if ('avatar' in b) pr.avatar = img(b.avatar);
        if ('cover' in b) pr.cover = img(b.cover);
        if ('coverY' in b) pr.coverY = Math.max(0, Math.min(100, Math.round(+b.coverY || 0)));
        store.save('profile'); return J(pr);
      }
    }
    if (p === '/api/folders' && m === 'GET') return J(store.data.folders);
    if (p === '/api/folders' && m === 'POST') {
      const name = String((await body()).name || '').trim().slice(0, 40); if (!name) return J({error: 'Введите название папки'}, 400);
      if (Object.keys(store.data.folders).length >= 60) return J({error: 'Слишком много папок'}, 400);
      if (Object.values(store.data.folders).some(f => f.name.toLowerCase() === name.toLowerCase())) return J({error: 'Папка с таким названием уже есть'}, 409);
      const id = 'f' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'); store.data.folders[id] = {name, created: iso()}; store.save('folders'); emit({type: 'folders'});
      return J({id, ...store.data.folders[id]});
    }
    if ((x = p.match(/^\/api\/folders\/(f[\w]+)$/))) {
      const f = store.data.folders[x[1]]; if (!f) return J({error: 'not found'}, 404);
      if (m === 'PUT') { const name = String((await body()).name || '').trim().slice(0, 40); if (!name) return J({error: 'Введите название папки'}, 400); f.name = name; store.save('folders'); emit({type: 'folders'}); return J({id: x[1], ...f}); }
      if (m === 'DELETE') { delete store.data.folders[x[1]]; for (const g of Object.values(lib())) if (g.folders) g.folders = g.folders.filter(i => i !== x[1]); store.save('folders'); store.save('library'); emit({type: 'folders'}); emit({type: 'lib'}); return J({ok: true}); }
    }
    if (p === '/api/lib/merge' && m === 'POST') { const b = await body(); const ok = mergeGames(String(b.from), String(b.to)); emit({type: 'lib'}); return J({ok}); }
    if (p === '/api/lib/dedupe' && m === 'POST') { const n = mergeAutoDuplicates(); emit({type: 'lib'}); return J({ok: true, merged: n}); }
    if ((x = p.match(/^\/api\/rawg\/(\d+)$/))) {
      try { const r = await P.rawgGame(rawgKey(), x[1]); if (r.desc) { const t = await Tr.translate(r.desc, {cfg: {deepl: cfg().keys.deepl}, cache: store.data.translations, onSave: () => store.save('translations'), fetch: hooks.fetch}); r.desc = t.text; r.descTranslated = t.translated; } return J(r); } catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if (p === '/api/meta' && m === 'GET') return J(meta());
    if ((x = p.match(/^\/api\/meta\/([\w-]+)\/refresh$/)) && m === 'POST') { if (!lib()[x[1]]) return J({error: 'not found'}, 404); const r = await fetchMeta(x[1]); emit({type: 'meta'}); return J(r || {}); }
    if (p === '/api/upload' && m === 'POST') {
      let buf; try { buf = await readBody(req, 16e6); } catch { return J({error: 'Файл больше 16 МБ'}, 413); }
      const ext = imgExt(buf); if (!ext) return J({error: 'Нужна картинка PNG, JPG, WEBP или GIF'}, 400);
      const name = crypto.randomBytes(8).toString('hex') + '.' + ext; fs.writeFileSync(path.join(store.uploads, name), buf); return J({url: '/uploads/' + name});
    }
    if (p === '/api/steam/sync' && m === 'POST') {                 // обновить только часы (и дату последнего запуска), без импорта новых игр
      try { return J(await syncSteamHours()); } catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    if (p === '/api/steam/import' && m === 'POST') {      const b = await body(), k = cfg().keys; if (!k.steamKey || !k.steamId) return J({error: 'Укажите Steam Web API Key и SteamID64'}, 400);
      try {
        const owned = await P.steamOwned(k.steamKey, k.steamId); let added = 0, updated = 0;
        for (const g of owned) {
          const h = Math.round(g.minutes / 60 * 100) / 100, ex = lib()[g.appid];
          if (ex) { if (h > (+ex.hours || 0)) { ex.hours = h; updated++; } continue; }
          if (b.onlyPlayed !== false && !g.minutes) continue;
          lib()[g.appid] = {name: g.name, status: g.minutes ? 'playing' : 'planned', hours: g.minutes ? h : '', rating: '', note: '', src: 'steam', added: iso(), last: g.last ? new Date(g.last * 1000).toISOString() : undefined}; added++;
        }
        store.save('library'); emit({type: 'lib'}); wantMeta(); return J({ok: true, added, updated, total: owned.length});
      } catch (e) { return J({error: String(e.message).replace(/(key=)[^&\s]+/g, '$1***')}, 502); }
    }
    // --- прямой запуск и локальные пути ---
    if (p === '/api/path/check' && m === 'POST') { const r = Launch.checkPath((await body()).path); return J({exists: r.exists, kind: r.kind, type: r.type, error: r.error || ''}); }
    if (p === '/api/pick' && m === 'POST') {          // системное окно выбора файла или папки (только в приложении)
      if (!hooks.pickPath) return J({error: 'unavailable'}); const b = await body();
      return J({path: (await hooks.pickPath({kind: b.kind === 'folder' ? 'folder' : 'file', title: String(b.title || '').slice(0, 80), exe: !!b.exe})) || ''});
    }
    if ((x = p.match(/^\/api\/launch\/([\w-]+)$/)) && m === 'POST') {   // запускается только сохранённый в карточке путь, из запроса путь не берётся
      const g = lib()[x[1]]; if (!g) return J({error: 'not found'}, 404);
      const steamId = /^\d+$/.test(x[1]) && tracker.steamGames.some(s => s.appid === x[1]) ? x[1] : '';
      const r = Launch.launchGame(g, {emulators: cfg().emulators || {}, spawn: hooks.spawn, steamAppId: steamId, fullscreen: (cfg().launch || {}).fullscreen !== false, locate: e => Emu.locate(e), onEmulator: (id, p) => { cfg().emulators[id] = p; store.save('config'); }});
      if (r.ok) { g.lastLaunch = iso(); store.save('library'); emit({type: 'lib'}); }
      return J(r);
    }
    // --- бэкап сохранений ---
    if ((x = p.match(/^\/api\/backup\/([\w-]+)$/))) {
      const g = lib()[x[1]]; if (!g) return J({error: 'not found'}, 404);
      if (m === 'GET') return J(Backup.listBackups(store.backups, g.name));
      if (m === 'POST') {
        try { const r = await Backup.backupSaves({game: g.name, srcDir: g.savePath, outDir: store.backups}); g.lastBackup = {name: r.name, at: r.at, files: r.files, size: r.size}; store.save('library'); emit({type: 'lib'}); return J({ok: true, ...g.lastBackup}); }
        catch (e) { return J({ok: false, error: String(e.message || e)}); }
      }
    }
    if (p === '/api/desktop/open-backups' && m === 'POST') { fs.mkdirSync(store.backups, {recursive: true}); if (hooks.openPath) hooks.openPath(store.backups); return J({ok: true, dir: store.backups}); }
    if (p === '/api/tracker/status') return J(tracker.status());
    if (p === '/api/tracker/processes') return J(tracker.processes());
    if (p === '/api/tracker/rescan' && m === 'POST') { await tracker.rescan(); return J(tracker.status()); }
    if (p === '/api/desktop/autostart' && hooks.getAutostart) { if (m === 'PUT') hooks.setAutostart(!!(await body()).on); return J({on: !!hooks.getAutostart()}); }
    if (p === '/api/desktop/open-data' && m === 'POST' && hooks.openData) { hooks.openData(); return J({ok: true}); }
    // --- Nintendo Switch: сейвы эмуляторов, бэкапы JKSV/Checkpoint, консоль по USB (MTP) и FTP ---
    if (p === '/api/switch/status' && m === 'GET') {
      try { return J({...(await SW.status()), companion: companionInfo()}); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/scan' && m === 'POST') {
      try { const r = SW.scanNow(true); emit({type: 'lib'}); return J({ok: true, ...r}); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/import' && m === 'POST') {
      const b = await body();
      try { const r = SW.importBackups(String(b.dir || '').trim()); emit({type: 'lib'}); return J({ok: true, ...r}); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/mtp' && m === 'POST') {
      try { const r = await SW.mtpSync(); if (r.updated) emit({type: 'lib'}); return J(r); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/ftp' && m === 'POST') {
      const b = await body(), f = cfg().switch.ftp || {};
      try {
        const r = await SW.ftpSyncNow({...f, host: String(b.host ?? f.host ?? '').trim(), port: +b.port || f.port || 21,
          user: String(b.user ?? f.user ?? '').trim(), pass: b.pass != null ? String(b.pass) : f.pass,
          path: String(b.path || f.path || 'nand/user/save')});
        if (r.updated) emit({type: 'lib'}); return J(r);
      } catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/sync' && m === 'POST') {
      try { const r = await SW.sync(); if (r.updated) emit({type: 'lib'}); return J(r); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    if (p === '/api/switch/link' && m === 'POST') {
      const b = await body(), id = String(b.id || ''), g = lib()[id];
      if (!g) return J({ok: false, error: 'Игра не найдена'}, 404);
      const tid = String(b.titleId || '').trim().toUpperCase();
      if (tid && !/^0100[0-9a-f]{12}$/.test(tid)) return J({ok: false, error: 'Title ID должен быть 16 hex-символов и начинаться с 0100'}, 400);
      if (tid) g.titleId = tid; else delete g.titleId;
      g.playedOn = [...new Set([...(g.playedOn || []), 'switch'])];
      store.save('library'); progCache.delete(id); emit({type: 'lib'});
      return J({ok: true, id, titleId: tid});
    }
    // --- приложение NEXUS Switch: настройки приёма по Wi-Fi и ручная загрузка данных ---
    if (p === '/api/switch/companion') {
      if (m === 'GET') return J(companionInfo());
      if (m === 'PUT') {
        const b = await body(), c = comp();
        if ('enabled' in b) c.enabled = !!b.enabled;
        if ('port' in b) c.port = Math.min(65535, Math.max(1024, Math.round(+b.port) || 8788));
        if (b.regenerate) c.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        store.save('config'); companionStart();
        return J(companionInfo());
      }
    }
    if (p === '/api/switch/companion/apply' && m === 'POST') {
      const b = await body();
      try { const r = SW.applyCompanion(b); if (r.updated) emit({type: 'lib'}); return J({ok: true, ...r}); }
      catch (e) { return J({ok: false, error: String(e.message || e)}); }
    }
    return J({error: 'not found'}, 404);
  }

  // --- доступ с телефона: токен в ссылке, только домашняя сеть, только чтение и правка библиотеки (без запуска программ, путей и ключей) ---
  const privIp = a => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|fe80:|f[cd][0-9a-f]{2}:)/i.test(a);
  const REMOTE_API = /^\/api\/(lib|meta|profile|folders|catalog|tags|similar|series|progress|rawg|events|cover|hero|installed|upload|translate|tracker\/status)(\/|$)/;
  const tokOk = t => { const k = mob().token || ''; try { return !!t && t.length === k.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(k)); } catch { return false; } };
  function remoteGate(req, res, u, hn, peer) {
    const deny = (c, t) => { res.writeHead(c, {'content-type': 'text/plain; charset=utf-8'}); res.end(t); return true; };
    if (!mob().enabled || !mob().token) return deny(403, 'Доступ с телефона выключен в NEXUS');
    if (!privIp(peer)) return deny(403, 'forbidden');
    if (!(privIp(hn) || /\.local$/i.test(hn) || /^[a-z0-9-]+$/i.test(hn))) return deny(403, 'forbidden');
    const ck = (String(req.headers.cookie || '').match(/(?:^|;\s*)nx_t=([0-9a-f]+)/) || [])[1];
    if (tokOk(u.searchParams.get('t'))) { u.searchParams.delete('t'); res.writeHead(302, {location: u.pathname + (u.search || ''), 'set-cookie': `nx_t=${mob().token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`}); res.end(); return true; }
    if (!tokOk(ck)) return deny(401, 'Откройте ссылку из NEXUS на компьютере: Настройки → Мобильная версия');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) { let oh = ''; try { oh = new URL(req.headers.origin).host; } catch {} if (oh !== req.headers.host) return deny(403, 'forbidden'); }
    if (u.pathname.startsWith('/api/') && !REMOTE_API.test(u.pathname)) return deny(403, 'Это действие доступно только на компьютере');
    return false;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      const hn = (req.headers.host || '').replace(/:\d+$/, ''), peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!/^(127\.|::1$)/.test(peer)) { if (remoteGate(req, res, u, hn, peer)) return; }          // телефон в домашней сети: только по токену и только безопасные запросы
      else if (!['localhost', '127.0.0.1', '[::1]'].includes(hn)) { res.writeHead(403); return res.end('forbidden'); }
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) { let oh = ''; try { oh = new URL(req.headers.origin).host; } catch {} if (oh !== req.headers.host) { res.writeHead(403); return res.end('forbidden'); } }
      if (u.pathname.startsWith('/api/')) return await api(req, res, u);
      if (u.pathname === '/proxy') {
        const t = u.searchParams.get('url'); let h = ''; try { h = new URL(t).hostname; } catch {}
        if (!ALLOW.includes(h)) { res.writeHead(400); return res.end('bad url'); }
        const hit = cache.get(t);
        if (hit && Date.now() - hit.t < 600000) { res.writeHead(200, {'content-type': hit.ct}); return res.end(hit.b); }
        try {
          const r = await fetch(t, {headers: {'user-agent': 'Mozilla/5.0', 'accept-language': 'ru-RU,ru;q=0.9', cookie: 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1'}, signal: AbortSignal.timeout(15000)});
          const b = Buffer.from(await r.arrayBuffer()), ct = r.headers.get('content-type') || 'application/json';
          if (r.ok) { if (cache.size > 300) cache.delete(cache.keys().next().value); cache.set(t, {t: Date.now(), ct, b}); }
          res.writeHead(r.status, {'content-type': ct}); return res.end(b);
        } catch { res.writeHead(502); return res.end('upstream error'); }
      }
      let root = PUB, rel = decodeURIComponent(u.pathname);
      if (rel.startsWith('/uploads/')) { root = store.uploads; rel = rel.slice(8); }
      const f = path.normalize(path.join(root, rel === '/' ? 'index.html' : rel));
      if (!f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(f, (e, d) => {
        if (e) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, {'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': root === PUB ? 'no-cache' : 'public, max-age=86400'}); res.end(d);
      });
    } catch (e) { try { res.writeHead(500); res.end('error'); } catch {} console.error(e); }
  });
  return new Promise((ok, no) => {
    const ready = () => { setTimeout(() => { checkWishlist().catch(() => {}); }, 15000).unref?.(); setInterval(() => { checkWishlist().catch(() => {}); }, 3 * 3600 * 1000).unref?.(); setTimeout(scheduleInstalled, 3000).unref?.(); setInterval(scheduleInstalled, 60000).unref?.(); for (const g of Object.values(lib())) if (g.playedOn) g.playedOn = [...new Set(g.playedOn.map(D.migratePlat))]; if (!trackerOpts.noMeta) loadPlatformIds(); tracker.start(); setTimeout(() => { try { if (mergeAutoDuplicates()) emit({type: 'lib'}); } catch (e) { console.error('dedupe', e.message); } fixSteamNames(); }, 1500).unref?.(); if (!trackerOpts.noMeta) { setTimeout(wantMeta, 4000); setInterval(wantMeta, 30 * 60 * 1000).unref?.(); setTimeout(() => { syncSteamHours().catch(() => {}); }, 9000).unref?.(); setInterval(() => { syncSteamHours().catch(() => {}); }, 6 * 3600 * 1000).unref?.(); } const swScan = () => { try { const r = SW.scanNow(true); if (r.updated) emit({type: 'lib'}); } catch (e) { console.error('switch scan', e.message); } };
      try { const sc = cfg().switch || {}; if (sc.enabled !== false && sc.autoScan !== false) { setTimeout(swScan, 8000).unref?.(); setInterval(swScan, 5 * 60 * 1000).unref?.(); } } catch {}
      try { companionStart(); } catch (e) { compState.error = String(e.message || e); }
      ok({server, port: server.address().port, store, tracker, switch: SW, events, refreshInstalled, companion: companionInfo, _remoteGate: remoteGate, close() { tracker.stop(); companionStop(); store.flush(); server.close(); }}); };
    // порт мобильного режима мог быть занят другой программой: не оставляем приложение без окна, а откатываемся на локальный порт
    let fallback = mob().enabled && host === '0.0.0.0', settled = false;
    const done = () => { if (settled) return; settled = true; server.removeListener('error', fail); ready(); };
    const fail = e => {
      if (settled) return;
      if (fallback && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
        fallback = false; host = '127.0.0.1'; port = 0;
        try { server.listen(0, '127.0.0.1', done); return; } catch (e2) { settled = true; no(e2); return; }
      }
      settled = true; no(e);
    };
    server.on('error', fail);
    tracker.on('emulator', e => { const c = cfg(); c.emulators = c.emulators || {}; if (c.emulators[e.id] !== e.path) { c.emulators[e.id] = e.path; store.save('config'); } });
    server.listen(port, host, done);
  });
}
module.exports = {start, bestMatch, pickBest, cleanName};
if (require.main === module) {
  const dataDir = process.env.GT_DATA || path.join(__dirname, 'data');
  start({dataDir, port: +process.env.PORT || 8000}).then(s => { console.log('NEXUS: http://localhost:' + s.port + '\nДанные: ' + dataDir); process.on('SIGINT', () => { s.close(); process.exit(0); }); }).catch(e => { console.error('Не удалось запустить:', e.message); process.exit(1); });
}
