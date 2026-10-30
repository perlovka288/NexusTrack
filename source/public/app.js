'use strict';
// NEXUS: основной интерфейс. Каталог, библиотека, страница игры. Профиль, папки и редактор обложек лежат в profile.js, настройки в extra.js.
const D = NexusData, S = NexusSearch, F = NexusFilters;
const FEATURED = D.FEATURED, CATS = D.CATS;
const NAME = new Map(FEATURED);
const ROWS = (() => {
  const used = new Set(), rows = CATS.map(([t, ids]) => [t, ids.map(String).filter(id => NAME.has(id) && !used.has(id) && used.add(id))]);
  const rest = FEATURED.map(f => f[0]).filter(id => !used.has(id));
  if (rest.length) rows.push(['Ещё', rest]);
  return rows.filter(r => r[1].length);
})();
const CAT_OF = new Map(ROWS.flatMap(([t, ids]) => ids.map(id => [id, t])));

// ===== ротация каталога каждые 6 часов =====
// Порядок подборок и игр внутри них меняется 4 раза в сутки: в 00:00, 06:00, 12:00 и 18:00 по системному времени.
// Готовая ротация лежит в localStorage до конца текущего окна, поэтому при перезапуске ничего не «прыгает».
const ROT_KEY = 'nx.rot.v2', ROT_HOURS = 6;
const daySig = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-w${Math.floor(d.getHours() / ROT_HOURS)}`; };
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function rotateRows() {
  const sig = daySig();
  try { const c = JSON.parse(localStorage.getItem(ROT_KEY) || 'null'); if (c && c.sig === sig && Date.now() - c.t < ROT_HOURS * 36e5 && Array.isArray(c.rows)) return c.rows; } catch {}
  const r = rng(hash32(sig));
  const rows = ROWS.map(([t, ids]) => { const off = ids.length ? Math.floor(r() * ids.length) : 0; return [t, ids.slice(off).concat(ids.slice(0, off))]; });
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  try { localStorage.setItem(ROT_KEY, JSON.stringify({sig, t: Date.now(), rows})); } catch {}
  return rows;
}
const DAILY_ROWS = rotateRows();
// Если окно открыто долго и началось новое 6-часовое окно, подборки пересобираются без перезапуска приложения.
let rotSig = daySig();
setInterval(() => {
  const s = daySig(); if (s === rotSig) return; rotSig = s;
  DAILY_ROWS.splice(0, DAILY_ROWS.length, ...rotateRows());
  try { if (state.view === 'catalog' && catHome()) render(); } catch {}
}, 60 * 1000);


const STATUS = {playing:'Играю',done:'Прошёл',planned:'Буду играть',dropped:'Брошено'};
const KEY = 'nexus.v1', OLDKEY = 'gameTracker.v1', CDN = 'https://cdn.akamai.steamstatic.com/steam/apps/', PX = 'https://api.allorigins.win/raw?url=';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dec = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
// векторные иконки (Lucide). Эмодзи в интерфейсе не используются
const IC = {
  pad:'<path d="M6 12h4M8 10v4"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.3 5H6.7a4 4 0 0 0-3.9 3.2l-1.6 7.5A3 3 0 0 0 4 19c1 0 1.9-.5 2.4-1.3L8 15h8l1.6 2.7c.5.8 1.4 1.3 2.4 1.3a3 3 0 0 0 2.8-3.3l-1.6-7.5A4 4 0 0 0 17.3 5z"/>',
  back:'<path d="m12 19-7-7 7-7M19 12H5"/>', chevL:'<path d="m15 18-6-6 6-6"/>', chevR:'<path d="m9 18 6-6-6-6"/>', chevD:'<path d="m6 9 6 6 6-6"/>',
  upr:'<path d="M7 17 17 7M7 7h10v10"/>', plus:'<path d="M12 5v14M5 12h14"/>', x:'<path d="M6 6l12 12M18 6 6 18"/>', minus:'<path d="M5 12h14"/>',
  max:'<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  up:'<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  gear:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  wand:'<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>', play:'<polygon points="6 3 20 12 6 21 6 3"/>',
  folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderPlus:'<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  down:'<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  calendar:'<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  monitor:'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  handheld:'<rect width="20" height="12" x="2" y="6" rx="3"/><path d="M7 10v4M5 12h4"/><path d="M16 11h.01M18 13h.01"/>',
  laptop:'<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  terminal:'<path d="m4 17 6-6-6-6M12 19h8"/>',
  phone:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  pencil:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  heart:'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  filter:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  trophy:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  image:'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  layers:'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>'};
const ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
const icf = (n, s = 18) => ic(n, s).replace('fill="none"', 'fill="currentColor"');   // закрашенная иконка (избранное, оценка)
const platIcon = id => ic((D.PLATFORM_BY_ID[id] || {}).icon || 'pad', 15);
// значки платформ: PC, PlayStation и т. д. Подпись — во всплывающей подсказке
const platIcons = ids => (ids || []).filter(p => D.PLATFORM_BY_ID[p]).map(p => `<span class="pi" title="${esc(D.PLATFORM_BY_ID[p].label)}">${platIcon(p)}</span>`).join('');
const fmtHM = F.fmtHM;

let lib = {}, online = false;
const isSteam = id => /^\d+$/.test(String(id));
const jf = (p, m = 'GET', b) => fetch(p, {method: m, headers: b ? {'content-type': 'application/json'} : undefined, body: b ? JSON.stringify(b) : undefined}).then(r => r.json());
const fmtH = h => fmtHM(h, '0 мин');
const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : m ? `${m} мин` : `${s} с`; };
const backup = () => { try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch {} };
const fresh = () => ({platforms: [], genres: [], tags: [], from: '', to: '', manual: false});
const fActive = f => !!(f.platforms.length || f.genres.length || f.tags.length || f.from || f.to || f.manual);
const state = {view:'catalog', q:'', remote:[], pid:0, tab:'ov', shot:0, panel:false,
  lq: '',                                                       // поиск в библиотеке: отдельный, не связан с поиском в шапке
  collection: '', localIds: null,                               // открытая подборка «Показать все» и её локальный список
  studio: null,                                                  // открытая страница разработчика/издателя
  cf: {...fresh(), sort: 'popular'}, lf: {...fresh(), sort: 'name', status: 'all', folder: ''}};
const cat = {items: [], page: 0, total: 0, pages: 1, size: 60, next: false, busy: false, tok: 0, key: '', want: 0};   // единый каталог (RAWG + Steam)
const rgInfo = {};                                                                      // сведения о карточках каталога: год, жанры, теги
let rmeta = {}, folders = {}, profile = {}, tagList = []; const metaAsked = new Set();  // meta: данные RAWG по играм библиотеки
async function loadRmeta(){ try { rmeta = await jf('/api/meta'); } catch {} }
const info = {}, pend = {}, names = {};
// Библиотека хранится на сервере (data/library.json); в браузере остаётся резервная копия.
// push(id, поля) отправляет на сервер только изменённые поля (часы может обновлять и трекер), push(id, null, true) удаляет игру.
const pending = {}, pushT = {};
function push(id, fields, del) {
  backup(); if (!online) return;
  clearTimeout(pushT[id]);
  if (del) { delete pending[id]; return void jf('/api/lib/' + encodeURIComponent(id), 'DELETE'); }
  pending[id] = Object.assign(pending[id] || {}, fields || lib[id]);
  pushT[id] = setTimeout(() => { const b = pending[id]; delete pending[id]; if (b && lib[id]) jf('/api/lib/' + encodeURIComponent(id), 'PUT', b).catch(() => toast('Не удалось сохранить на сервере')); }, 350);
}
async function loadLib() {
  try {
    lib = await jf('/api/lib'); online = true;
    if (!Object.keys(lib).length) { const old = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLDKEY) || '{}'); if (Object.keys(old).length) { await jf('/api/lib/import', 'POST', {lib: old, mode: 'merge'}); lib = await jf('/api/lib'); } }
  } catch { try { lib = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(OLDKEY)) || {}; } catch { lib = {}; } }
}
let tt;
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }
// Сначала свой сервер (/proxy из server.js), затем публичные прокси
const PROXIES = [u => '/proxy?url=' + encodeURIComponent(u), u => PX + encodeURIComponent(u), u => 'https://corsproxy.io/?url=' + encodeURIComponent(u), u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)];
let pi = 0;
async function proxy(u){
  for (let k = 0; k < PROXIES.length; k++) {
    const i = (pi + k) % PROXIES.length;
    try { const r = await fetch(PROXIES[i](u)); if (!r.ok) continue; const j = JSON.parse(await r.text()); pi = i; return j; } catch {}
  }
  throw new Error('proxy');
}

// Подробности игры из Steam: разработчик, дата, жанры, скриншоты
function details(id){
  return pend[id] || (pend[id] = proxy(`https://store.steampowered.com/api/appdetails?appids=${id}&l=russian&cc=US`)
    .then(j => info[id] = j[id]?.success ? j[id].data : null).catch(() => { delete pend[id]; return null; }));
}

// ===== карточки =====
// Добавляет игру в библиотеку и возвращает её запись. Если игра уже есть,
// просто возвращает существующую запись.
function addToLib(id, name, cover){
  if (lib[id]) return lib[id];
  const r = rgInfo[id] || {};
  lib[id] = {name, status:'planned', hours:'', rating:'', note:'', src: isSteam(id) ? 'steam' : /^r\d+$/.test(id) ? 'rawg' : 'custom', fav: false, folders: [], added: new Date().toISOString(), ...(r.released ? {released: r.released} : {}), ...(r.genres?.length ? {genres: r.genres} : {})};
  if (!isSteam(id)) { const c = cover; if (c && !c.includes('/uploads/none')) lib[id].cover = c; }
  return lib[id];
}
const actInner = id => lib[id]
  ? `<span class="gc-st s-${lib[id].status}">${STATUS[lib[id].status]}</span>`
  : `<button class="gc-add" data-act="add" aria-label="Добавить в библиотеку">${ic('plus', 16)}</button>`;
// «2004 · Шутер»: год и жанр под заголовком (как в каталоге на скриншоте)
const genreRu = n => D.GENRE_RU[n] || (D.GENRES.find(g => g[0] === n || String(g[2]).toLowerCase() === String(n || '').toLowerCase()) || [])[1] || n;
function yearGenre(id){
  const m = rmeta[id] || {}, r = rgInfo[id] || {}, g = lib[id] || {};
  const year = F.yearOf(g.released || m.released || r.released);
  const genre = (g.genres && g.genres[0]) || (m.genres && m.genres[0]) || (r.genres && r.genres[0]) || '';
  return [year || '', genre ? genreRu(genre) : ''].filter(Boolean).join(' · ');
}
// строка под названием у карточки библиотеки: время, оценка, платформы (всё векторными значками)
function cardMeta(id){
  const g = lib[id]; if (!g) return '';
  const t = fmtHM(g.hours), pl = platIcons(g.playedOn);
  const bits = [t ? `<span class="gm">${ic('clock', 13)}${esc(t)}</span>` : '', g.rating ? `<span class="gm">${icf('star', 13)}${esc(g.rating)}</span>` : '', pl ? `<span class="gm pis">${pl}</span>` : ''].filter(Boolean);
  return bits.length ? `<span class="gc-meta">${bits.join('')}</span>` : '';
}
function labelOf(id){
  const yg = yearGenre(id);
  if (state.view === 'library') return yg || (STATUS[lib[id]?.status] || '');
  return yg || CAT_OF.get(String(id)) || '';
}
const devBadge = id => (state.view === 'library' ? lib[id]?.installed : instMap[id]) ? `<span class="gc-dev" title="Есть на устройстве">${ic('monitor', 12)}На устройстве</span>` : '';
function progBar(id){ if (state.view !== 'library') return ''; const p = progressOf(id); return p ? `<span class="gc-prog" title="Прогресс ${p.pct}%"><i style="width:${p.pct}%"></i></span>` : ''; }
// кнопки поверх карточки библиотеки: обложка (карандаш), папки, любимая. Появляются при наведении
const cardTools = id => lib[id] ? `<div class="gc-tools"><button data-act="cover-edit" title="Изменить обложку" aria-label="Изменить обложку">${ic('pencil', 15)}</button><button data-act="assign" title="Папки" aria-label="Папки">${ic('folder', 15)}</button><button data-act="fav" class="${lib[id].fav ? 'on' : ''}" title="Любимая игра" aria-label="Любимая игра" aria-pressed="${!!lib[id].fav}">${lib[id].fav ? icf('heart', 15) : ic('heart', 15)}</button></div>` : '';
function card(id, name, im, label){
  names[id] = name;
  const g = lib[id], src = g?.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : (im || '/uploads/none.png'));
  return `<div class="gc${g?.fav ? ' is-fav' : ''}" data-id="${esc(id)}" data-name="${esc(name)}">
  <a class="gc-link" href="#game=${esc(id)}" draggable="false" aria-label="Открыть: ${esc(name)}">
    <img src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false" data-id="${esc(id)}" data-name="${esc(name)}">
    <span class="gc-shade"></span>${devBadge(id)}${progBar(id)}${typeof nxDlcBadge === 'function' ? nxDlcBadge(id) : ''}
    <span class="gc-txt"><span class="gc-cat">${esc(label ?? labelOf(id))}</span><span class="gc-title">${esc(name)}</span>${state.view === 'library' ? cardMeta(id) : ''}</span>
    <span class="gc-go">${ic('upr', 16)}</span>
  </a>${state.view === 'library' ? cardTools(id) : ''}
  <div class="gc-act">${actInner(id)}</div></div>`;
}
const patchCards = id => document.querySelectorAll(`.gc[data-id="${id}"] .gc-act`).forEach(el => el.innerHTML = actInner(id));

function rowsHtml(){
  return DAILY_ROWS.map(([t, ids], ri) => `<section class="row cf-row-sec" data-cf-row="${ri}"><div class="row-h"><h2>${esc(t)}<i>${ids.length}</i></h2><button class="row-all" data-showall="row" data-row="${ri}" aria-label="Показать все: ${esc(t)}"><span>Показать все</span>${ic('chevR', 14)}</button></div>
  <div class="cf-host" data-cf-row-host="${ri}"></div></section>`).join('');
}

// ===== coverflow: витрина и подборки каталога =====
// Карточки витрины: чистая обложка + подпись под каруселью (как в референсе).
function cfShot(it){
  const g = lib[it.id], img = it.img || g?.cover || (isSteam(it.id) ? CDN + it.id + '/library_600x900.jpg' : '/uploads/none.png');
  const rate = +it.rating || 0, st = it.status || g?.status, year = it.year || '';
  const sub = [year, (it.genres || []).slice(0, 2).join(' · ')].filter(Boolean).join(' · ');
  const badges = [
    rate ? `<span class="cf-badge">${icf('star', 12)}${rate.toFixed(1)}</span>` : '',
    st ? `<span class="cf-badge st">${esc(STATUS[st] || '')}</span>` : '',
  ].filter(Boolean).join('');
  const meta = [];
  if (rate) meta.push({label: 'Оценка', value: rate.toFixed(1)});
  if (st) meta.push({label: 'Статус', value: STATUS[st] || ''});
  if (it.genres?.length) meta.push({label: 'Жанр', value: it.genres.slice(0, 2).join(', ')});
  return {
    title: it.name,
    subtitle: sub,
    meta,
    html: `<a class="cf-shot" href="#game=${esc(it.id)}" data-id="${esc(it.id)}" data-name="${esc(it.name)}" draggable="false" aria-label="Открыть: ${esc(it.name)}">
      <img src="${esc(img)}" alt="" loading="lazy" draggable="false" data-id="${esc(it.id)}" data-name="${esc(it.name)}">
      <span class="cf-shot-shade"></span>${badges ? `<span class="cf-shot-badges">${badges}</span>` : ''}${typeof nxDlcBadge === 'function' ? nxDlcBadge(it.id) : ''}
    </a>`,
  };
}
function mountShowcaseCoverflows(){
  const scEl = $('#showcase'); if (!scEl || scEl.hidden || !window.NexusCoverflow) return;
  scEl.querySelectorAll('[data-cf-showcase]').forEach(host => {
    if (host.dataset.mounted === '1') return;
    const key = host.dataset.cfShowcase, items = showcase && showcase[key];
    if (!Array.isArray(items) || !items.length) return;
    host.dataset.mounted = '1';
    NexusCoverflow.create(host, {
      slides: items.map(cfShot),
      rotate: 40, depth: .55, perspective: 3.2, falloff: .56, fade: .08,
      cardWidth: 'clamp(168px, 20vw, 250px)', gap: .06,
      loop: items.length > 2,
      showCaption: true, showNavigation: true, showPagination: false,
      label: key === 'fresh' ? 'Новинки' : 'Популярное',
      className: 'cf-showcase',
    });
  });
}
function mountDailyCoverflows(){
  const rows = $('#rows'); if (!rows || rows.hidden || !window.NexusCoverflow) return;
  rows.querySelectorAll('[data-cf-row-host]').forEach(host => {
    if (host.dataset.mounted === '1') return;
    const row = DAILY_ROWS[+host.dataset.cfRowHost];
    if (!row || !row[1]?.length) return;
    const [t, ids] = row;
    host.dataset.mounted = '1';
    NexusCoverflow.create(host, {
      slides: ids.map(id => ({title: NAME.get(id), html: card(id, NAME.get(id), null, CAT_OF.get(id) === t ? (yearGenre(id) || t) : t)})),
      rotate: 42, depth: .58, perspective: 3.1, falloff: .56, fade: .09,
      cardWidth: 'clamp(128px, 15vw, 188px)', gap: .055,
      loop: ids.length > 2,
      showCaption: false, showNavigation: true, showPagination: false,
      label: t,
      className: 'cf-row',
    });
  });
}
function mountCatalogCoverflow(items){
  const host = $('#cfCatalog'); if (!host || !items?.length || !window.NexusCoverflow) return;
  NexusCoverflow.create(host, {
    slides: items.map(([id, name]) => ({title: name, html: card(id, name, null, labelOf(id))})),
    rotate: 42, depth: .58, perspective: 3.1, falloff: .56, fade: .09,
    cardWidth: 'clamp(150px, 18vw, 220px)', gap: .06,
    loop: items.length > 2,
    showCaption: false, showNavigation: true, showPagination: true,
    label: 'Каталог игр',
  });
}

// ===== витрина: «Популярное» и «Новинки» =====
const SC_KEY = 'nx.showcase.v1';
let showcase = null;
function scSkeleton(n = 5){
  return Array.from({length: n}, () => '<div class="sc sk" aria-hidden="true"><span class="sk-shine"></span><span class="sk-t"></span><span class="sk-m"></span></div>').join('');
}
function scCard(it){
  names[it.id] = it.name;
  const g = lib[it.id], img = it.img || g?.cover || (isSteam(it.id) ? CDN + it.id + '/library_600x900.jpg' : '/uploads/none.png');
  const meta = [it.year || '', (it.genres || []).slice(0, 2).join(' · ')].filter(Boolean).join(' · ');
  const st = it.status || g?.status, rate = +it.rating || 0;
  return `<a class="sc" href="#game=${esc(it.id)}" data-id="${esc(it.id)}" data-name="${esc(it.name)}" role="listitem">
    <img src="${esc(img)}" alt="" loading="eager" draggable="false" data-id="${esc(it.id)}" data-name="${esc(it.name)}">
    <span class="sc-shade"></span>
    ${rate ? `<span class="sc-rate">${ic('star', 13)}<b>${rate.toFixed(1)}</b></span>` : ''}
    ${st ? `<span class="sc-st">${esc(STATUS[st] || '')}</span>` : ''}${typeof nxDlcBadge === 'function' ? nxDlcBadge(it.id) : ''}
    <span class="sc-info"><span class="sc-title">${esc(it.name)}</span>${meta ? `<span class="sc-meta">${esc(meta)}</span>` : ''}</span>
  </a>`;
}
function scRow(key, title, sub, items, loading){
  if (!loading && !(items || []).length) return '';
  const body = loading ? `<div class="cf-skel">${scSkeleton()}</div>` : '';
  return `<section class="row scrow" data-sc="${key}">
    <div class="row-h"><div class="sc-head"><h2>${esc(title)}</h2><p class="sc-sub">${esc(sub)}</p></div><div class="row-r">${items?.length ? `<span class="sc-count">${items.length} игр</span>` : ''}<button class="row-all" data-showall="${key}" aria-label="Показать все: ${esc(title)}"><span>Показать все</span>${ic('chevR', 14)}</button></div></div>
    <div class="cf-host" data-cf-showcase="${key}">${body}</div></section>`;
}
function showcaseHtml(){
  if (!showcase) return `<div class="showcase">${scRow('popular', 'Популярное', 'Лучшие игры по оценкам и популярности', null, true)}${scRow('fresh', 'Новинки', 'Самые свежие вышедшие игры', null, true)}</div>`;
  return `<div class="showcase">${scRow('popular', 'Популярное', 'Лучшие игры по оценкам и популярности', showcase.popular)}${scRow('fresh', 'Новинки', 'Самые свежие вышедшие игры', showcase.fresh)}</div>`;
}
function scLocalFallback(){
  const all = FEATURED.map(([id, name]) => {
    const g = lib[id], m = rmeta[id] || {};
    return {id, name, img: g?.cover || '', year: +(String(g?.released || m.released || '').slice(0, 4)) || 0, genres: (m.genres || []).slice(0, 2), rating: +m.rating || 0, status: g?.status || ''};
  });
  const popular = all.slice(0, 14);
  const fresh = all.filter(x => x.year).sort((a, b) => b.year - a.year).slice(0, 14);
  return {day: daySig(), popular, fresh: fresh.length ? fresh : all.slice(-14), local: true};
}
async function loadShowcase(force){
  const sig = daySig();
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(SC_KEY) || 'null');
      if (c && c.sig === sig && Date.now() - c.t < 864e5 && c.data) { showcase = {...c.data, sig}; render(); return; }
    } catch {}
  }
  try {
    const j = await jf('/api/showcase' + (force ? '?force=1' : ''));
    if (j && ((j.popular || []).length || (j.fresh || []).length)) {
      showcase = {...j, sig};
      try { localStorage.setItem(SC_KEY, JSON.stringify({sig, t: Date.now(), data: j})); } catch {}
    } else showcase = {...scLocalFallback(), sig};
  } catch { showcase = {...scLocalFallback(), sig}; }
  render();
}


// ===== списки: каталог и библиотека =====
const catFilters = () => state.cf, libFilters = () => state.lf;
const catKey = () => JSON.stringify([state.q.trim(), state.cf]);
const catHome = () => state.view === 'catalog' && !state.collection && !state.localIds && !state.q.trim() && !fActive(state.cf) && state.cf.sort === 'popular';
// известность встроенной подборки: порядок FEATURED уже примерно от популярного к редкому
const FEAT_POP = new Map(FEATURED.map(([id], i) => [id, 1 - i / Math.max(1, FEATURED.length)]));
// мгновенная выдача, пока сервер ещё ищет: встроенная подборка и библиотека, ранжирование тем же модулем поиска.
// Для коротких запросов сначала показываем самые известные игры, начинающиеся с введённых букв.
function localRank(q){
  const items = [];
  for (const [id, name] of FEATURED) items.push({id, name, pop: FEAT_POP.get(id) || 0});
  for (const [id, g] of Object.entries(lib)) items.push({id, name: g.name, pop: 1});
  const uniq = S.dedupe(items, {get: i => i.name, src: () => 'x', id: i => i.id});
  const pref = S.prefix(q, uniq, {get: i => i.name, pop: i => i.pop || 0});
  const ranked = S.rank(q, uniq, {get: i => i.name, pop: i => i.pop || 0});
  const seen = new Set(), out = [];
  for (const i of [...pref, ...ranked]) if (!seen.has(i.id)) { seen.add(i.id); out.push([i.id, i.name]); }
  return out;
}
function list(){
  const q = state.q.trim();
  if (state.view === 'library') return F.filterLibrary(lib, rmeta, {...state.lf, q: state.lq.trim()});
  if (state.localIds) return state.localIds.map(id => [id, NAME.get(id) || lib[id]?.name || ('Игра ' + id)]);
  if (!online) return q ? localRank(q) : FEATURED.slice();
  if (q && cat.key !== catKey() && !fActive(state.cf)) return localRank(q);   // пока ждём сервер, показываем быстрые результаты
  return cat.items;
}
function head(){
  const v = state.view, f = state.lf;
  const nGames = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'игра' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'игры' : 'игр'}`;
  const fn = v === 'library' && f.folder ? (f.folder === 'fav' ? 'Любимые' : folders[f.folder]?.name) : '';
  const coll = v === 'catalog' && state.collection ? state.collection : '';
  const studioName = state.studio?.name || 'Студия';
  const libTitle = f.manual ? 'Добавлены вручную' : f.status === 'all' ? 'Моя библиотека' : f.status === 'dev' ? 'На устройстве' : STATUS[f.status] || 'Библиотека';
  $('#h1').textContent = coll || (v === 'settings' ? 'Настройки' : v === 'profile' ? 'Профиль' : v === 'calendar' ? 'Календарь релизов' : v === 'studio' ? studioName : v === 'library' ? (fn || libTitle) : (state.q.trim() ? 'Результаты поиска' : 'Каталог'));
  document.body.classList.toggle('nx-grid-active', v === 'catalog' || v === 'library');
  $('#sub').textContent = coll ? (state.localIds ? 'Полный список игр этой подборки.' : 'Полный список игр этой подборки — листайте, фильтруйте и добавляйте в библиотеку.') : v === 'settings' ? 'Ключи API, отслеживание игр и данные приложения.' : v === 'profile' ? 'Ваши любимые игры, пройденные тайтлы и папки.'
    : v === 'calendar' ? 'Ближайшие релизы и даты выхода новинок. Нажмите на игру, чтобы открыть карточку.' : v === 'studio' ? 'Все игры студии, описание и ключевые данные.' : v === 'library' ? 'Ваши игры, время игры, оценки и папки.' : 'Подборки популярных игр и вся база: поиск, платформы, жанры, теги и дата выхода.';
  const pageList = v === 'catalog' || v === 'library';
  // каталог: заголовок скрыт, центральный поиск остаётся на своём месте
  { const bare = v === 'catalog' && !coll && !state.q.trim(); const ph = document.querySelector('.pagehead'); if (ph) ph.hidden = bare || v === 'calendar' || v === 'studio'; }   // у календаря и студии свой заголовок внутри раздела
  $('#stats').hidden = v !== 'library'; $('#settingsBox').hidden = v !== 'settings'; $('#profileBox').hidden = v !== 'profile';
  const cbx = $('#calendarBox'), sbx = $('#studioBox'); if (cbx) cbx.hidden = v !== 'calendar'; if (sbx) sbx.hidden = v !== 'studio';
  $('#folderbar').hidden = v !== 'library'; $('#fpanel').hidden = !pageList || !state.panel;
  // центральная строка поиска: на каталоге это главный поиск, в библиотеке — панель действий
  const spot = $('#spotlight');
  if (spot) {
    spot.hidden = !pageList;
    spot.classList.toggle('is-library', v === 'library');
    spot.classList.toggle('is-open', v === 'library' || state.panel || !!state.q.trim() || (v === 'catalog' ? fActive(state.cf) : fActive(state.lf)));
    spot.classList.toggle('has-value', !!state.q.length);
  }
  const spotSearch = $('#spotsearch'); if (spotSearch) spotSearch.hidden = v !== 'catalog';
  const headSearch = document.querySelector('.top .search'); if (headSearch) headSearch.hidden = v === 'catalog';
  syncSearchInputs();
  $('.pagehead')?.classList.toggle('center', v === 'profile');
  $('#pagehead-sub')?.remove();
  const cb = $('#collbar');
  if (cb) {
    cb.hidden = !coll;
    cb.innerHTML = coll ? `<button class="collback" data-home="1">${ic('back', 15)}<span>Все подборки</span></button><button class="collback" data-act="nx-collection-full">${ic('max', 15)}<span>На весь экран</span></button><span class="collmeta">${state.localIds ? nGames(state.localIds.length) : 'Полный список'}</span>` : '';
  }
  const qt = $('#quicktags'); if (qt) qt.hidden = v !== 'catalog';
  const o = v === 'library'
    ? [['name','По названию'],['hours','По времени игры'],['rating','По оценке'],['new','Сначала новые'],['old','Сначала старые'],['played','Недавно играл'],['platform','По платформе'],['added','Недавно добавлено'],['finished','По дате прохождения']]
    : [['popular','Популярные'],['rating','По рейтингу'],['new','Сначала новые'],['old','Сначала старые'],['metacritic','По Metacritic'],['name','По алфавиту']];
  const s = $('#sort');
  if (pageList) { s.dataset.v = v; s.innerHTML = o.map(([k, t]) => `<option value="${k}">${t}</option>`).join(''); s.value = (v === 'library' ? state.lf : state.cf).sort; }
  $('.sortl').hidden = !pageList || (v === 'catalog' && (!!state.q.trim() || !!state.localIds));
  const fb = $('#fbtn'); if (fb) fb.hidden = !pageList || (v === 'catalog' && !!state.localIds);   // в локальной подборке фильтры каталога не работают
  const ls = $('#lsearch'); if (ls) ls.hidden = v !== 'library';             // свой поиск только у библиотеки
  const ag = $('#allGamesBtn'); if (ag) ag.hidden = v !== 'catalog' || !!state.localIds;
}
const navInitials = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
function nav(){
  const nl = (v, t, n, icon) => `<button class="nl${state.view === v ? ' on' : ''}" data-view="${v}"><span class="nli">${icon ? ic(icon, 18) : ''}</span><span class="nlt">${t}</span>${n != null ? `<i>${n}</i>` : ''}</button>`;
  const pn = profile.name || 'Профиль';
  const pav = profile.avatar ? `<img src="${esc(profile.avatar)}" alt="">` : (profile.name ? `<span>${esc(navInitials(pn))}</span>` : ic('user', 16));
  const prof = `<button class="nl prof${state.view === 'profile' ? ' on' : ''}" data-view="profile" aria-label="Профиль${profile.name ? ': ' + esc(profile.name) : ''}"><span class="npa">${pav}</span><span class="npn">${esc(pn)}</span></button>`;
  $('#nav').innerHTML = nl('catalog', 'Каталог', null, 'grid') + nl('library', 'Библиотека', Object.keys(lib).length, 'layers') + nl('calendar', 'Календарь', null, 'calendar') + prof
    + `<button class="ib addtab" data-act="newgame" title="Добавить свою игру" aria-label="Добавить свою игру"><span class="nli">${ic('plus', 20)}</span><span class="nlt">Добавить</span></button><button class="ib${state.view === 'settings' ? ' on' : ''}" data-view="settings" title="Настройки" aria-label="Настройки"><span class="nli">${ic('gear', 18)}</span><span class="nlt">Настройки</span></button>`;
}
function chips(){
  if (state.view !== 'library') { $('#chips').innerHTML = ''; return; }
  const c = s => Object.values(lib).filter(g => s === 'all' || (s === 'dev' ? g.installed : s === 'manual' ? F.isManual(g) : g.status === s)).length;
  const pref = typeof nxPreferredLibTab === 'function' ? nxPreferredLibTab() : 'all';
  const opts = [['all', 'Все'], ...Object.entries(STATUS), ['manual', 'Добавлены вручную'], ['dev', 'На устройстве']];
  const on = k => k === 'manual' ? !!state.lf.manual : state.lf.status === k;
  $('#chips').innerHTML = `<label class="libpref" title="Вкладка библиотеки по умолчанию"><span>Старт</span><select id="libpref" aria-label="Вкладка библиотеки по умолчанию">${opts.map(([k, v]) => `<option value="${k}"${pref === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
    + opts.map(([k, v]) => `<button class="fc${on(k) ? ' on' : ''}" data-f="${k}"${k === 'manual' ? ' title="Только игры, добавленные вручную или найденные через эмуляторы"' : ''}>${v} <i>${c(k)}</i></button>`).join('');
}
function stats(){
  const v = Object.values(lib), n = s => v.filter(g => g.status === s).length;
  const total = v.reduce((a, g) => a + (+g.hours || 0), 0);
  $('#stats').innerHTML = [['Всего игр', v.length], ['В игре', n('playing')], ['Пройдено', n('done')], ['Запланировано', n('planned')], ['Брошено', n('dropped')], ['Всего времени', fmtHM(total, '0 мин')]].map(([l, x]) => `<div><b>${x}</b><small>${l}</small></div>`).join('');
}
function render(){
  head();
  const v = state.view, home = catHome(), scEl = $('#showcase');
  if (scEl) {
    scEl.hidden = !home;
    if (home) {
      const sig = showcase ? `${showcase.sig || showcase.day || 'd'}|${(showcase.popular || []).length}|${(showcase.fresh || []).length}` : 'load';
      if (scEl.dataset.sig !== sig) { scEl.innerHTML = showcaseHtml(); scEl.dataset.sig = sig; updRows(); requestAnimationFrame(updRows); }
      mountShowcaseCoverflows();
    }
  }
  if (v === 'calendar' || v === 'studio') {
    $('#rows').hidden = $('#grid').hidden = $('#empty').hidden = $('#more').hidden = true;
    $('#showcase').hidden = true; $('#pager').innerHTML = '';
    const lf = $('#listfade'); if (lf) lf.hidden = true;
    const rn = $('#rawgnote'); if (rn) rn.hidden = true;
    $('#calendarBox').hidden = v !== 'calendar'; $('#studioBox').hidden = v !== 'studio';
    nav(); chips(); fbar(); quickTags();
    if (v === 'calendar' && typeof nxRenderCalendar === 'function') nxRenderCalendar();
    if (v === 'studio' && typeof nxRenderStudio === 'function') nxRenderStudio();
    if (typeof window.__nxAfterRender === 'function') window.__nxAfterRender();
    return;
  }
  if (v === 'settings' || v === 'profile') {
    $('#rows').hidden = $('#grid').hidden = $('#empty').hidden = $('#more').hidden = true; const rn = $('#rawgnote'); if (rn) rn.hidden = true; nav();
    const lf = $('#listfade'); if (lf) lf.hidden = true;
    if (v === 'settings') { if (typeof renderSettings === 'function') renderSettings(); } else if (typeof renderProfile === 'function') renderProfile();
    if (typeof window.__nxAfterRender === 'function') window.__nxAfterRender();
    return;
  }
  const cbx = $('#calendarBox'), sbx = $('#studioBox'); if (cbx) cbx.hidden = true; if (sbx) sbx.hidden = true;
  $('#rows').hidden = !home; $('#grid').hidden = home; if (home) $('#pager').innerHTML = '';
  let items = [];
  if (home) { $('#rows').innerHTML = rowsHtml(); $('#grid').innerHTML = ''; }
  else {
    items = list(); $('#rows').innerHTML = '';
    const grid = $('#grid'), mode = state.localIds ? 'grid' : v === 'library' ? getMode('library') : v === 'catalog' ? (getMode('catalog') === 'coverflow' ? 'coverflow' : 'grid') : 'grid';
    const cfmode = v === 'catalog' && mode === 'coverflow';
    grid.classList.toggle('listmode', mode === 'list');
    grid.classList.toggle('cfmode', cfmode);
    if (v === 'library') items = libPage(items);                      // библиотека постраничная: по 50 игр, иначе сотни карточек тормозят
    if (cfmode) {                                                     // каталог: 3D-карусель вместо плитки
      grid.dataset.sig = '';
      grid.innerHTML = '<div class="cf-host cf-host-catalog" id="cfCatalog"></div>';
      $('#pager').innerHTML = '';
    } else if (mode === 'list') {                                     // список: все игры на одной странице
      grid.dataset.sig = ''; grid.innerHTML = items.map(([id]) => listRow(id)).join(''); $('#pager').innerHTML = '';
    } else if (v === 'library') {                                     // плитка: все игры на одной странице
      $('#pager').innerHTML = '';
      patchGrid(grid, items, v + '|grid|all');
    } else if (v === 'catalog' && cat.busy && !items.length && !state.localIds) {   // первая загрузка выдачи: заглушки вместо пустого экрана
      grid.dataset.sig = 'sk'; grid.innerHTML = Array.from({length: 15}, () => '<div class="gc gc-sk" aria-hidden="true"><span class="gcsk-i"></span></div>').join('');
    } else patchGrid(grid, items, v + '|grid');   // плитка: карточки переиспользуются, ничего не мигает
    $('#pager').innerHTML = pagerHtml();
    grid.classList.toggle('is-loading', v === 'catalog' && cat.busy && items.length > 0);   // переключение страницы: старые карточки гаснут, пока грузятся новые
  }
  $('#vmodebox').innerHTML = v === 'library' || (v === 'catalog' && !home && !state.localIds) ? spotModeSwitch(v) : '';
  const busy = v === 'catalog' && cat.busy;
  const e = $('#empty'); e.hidden = home || items.length > 0 || busy;
  e.textContent = v === 'library' ? (Object.keys(lib).length ? 'В этой подборке пока нет игр. Измените фильтры или папку.' : 'Здесь пока пусто. Откройте каталог и добавьте первую игру.') : 'Ничего не найдено. Попробуйте другое название или сбросьте фильтры.';
  const lf = $('#listfade'); if (lf) lf.hidden = home || !items.length;
  const m = $('#more'); if (m) { m.hidden = true; m.disabled = cat.busy; }   // старый «Показать ещё» заменён длинной страницей
  const rn = $('#rawgnote'); if (rn) rn.hidden = true;   // подписи источников данных в интерфейсе не показываем
  if (home) requestAnimationFrame(() => { mountShowcaseCoverflows(); mountDailyCoverflows(); });
  else if (v === 'catalog' && !state.localIds && getMode('catalog') === 'coverflow') requestAnimationFrame(() => mountCatalogCoverflow(items));
  nav(); chips(); stats(); fbar(); quickTags(); fpanel(); folderBar(); updRows(); requestAnimationFrame(updRows);
  if (typeof window.__nxAfterRender === 'function') window.__nxAfterRender();
}

// ===== фильтры: платформы, жанры, теги, дата выхода =====
const tagLabel = slug => (D.tagLabel ? D.tagLabel(slug) : D.TAG_RU[slug]) || (rmeta && Object.values(rmeta).map(m => m.tagNames?.[slug]).find(Boolean)) || (tagList.find(t => t.slug === slug) || {}).name || slug.replace(/-/g, ' ');

// ===== быстрые теги под панелью фильтров =====
// Один клик — и каталог уже отфильтрован. Повторный клик по активному тегу снимает его.
const QUICK_TAGS = [
  {label: 'Экшен', genre: 'action'},
  {label: 'RPG', genre: 'role-playing-games-rpg'},
  {label: 'Выживание', tag: 'survival'},
  {label: 'Мультиплеер', tag: 'multiplayer'},
  {label: 'Хоррор', tag: 'horror'},
  {label: 'Кооператив', tag: 'coop'},
  {label: 'Открытый мир', tag: 'open-world'},
  {label: 'Инди', genre: 'indie'},
];
function quickTags(){
  const box = $('#quicktags'); if (!box) return;
  if (state.view !== 'catalog' || state.localIds) { box.hidden = true; return; }
  box.hidden = false;
  const f = state.cf;
  box.innerHTML = `<span class="qtl">${ic('tag', 14)}Быстрый выбор</span>` + QUICK_TAGS.map((q, i) => {
    const on = q.genre ? f.genres.includes(q.genre) : f.tags.includes(q.tag);
    return `<button class="qt${on ? ' on' : ''}" data-qti="${i}" aria-pressed="${on}">${esc(q.label)}</button>`;
  }).join('');
}

// ===== «Показать все» у подборок =====
// Для подборок из категорий открываем полный каталог с нужным жанром/тегом.
// «Valve» и служебное «Ещё» остаются локальными списками — в каталоге для них нет точного фильтра.
const CAT_COLLECTIONS = {
  'Экшен и приключения': {genres: ['action', 'adventure']},
  'Ролевые игры': {genres: ['role-playing-games-rpg']},
  'Шутеры': {genres: ['shooter']},
  'Хорроры и выживание': {tags: ['horror']},
  'Стратегии и симуляторы': {genres: ['strategy', 'simulation']},
  'Инди и кооператив': {genres: ['indie'], tags: ['coop']},
};
function showAllCollection(kind, ri){
  const y = new Date().getFullYear();
  let title = '', filters = null, local = null;
  if (kind === 'popular') { title = 'Популярное'; filters = {...fresh(), sort: 'popular'}; }
  else if (kind === 'fresh') { title = 'Новинки'; filters = {...fresh(), sort: 'new', from: String(y - 1)}; }
  else {
    const row = DAILY_ROWS[+ri]; if (!row) return;
    title = row[0];
    const spec = CAT_COLLECTIONS[title];
    if (spec) filters = {...fresh(), sort: 'popular', ...spec};
    else local = row[1].slice();
  }
  state.view = 'catalog'; state.q = ''; state.collection = title; state.localIds = local; state.panel = false;
  syncSearchInputs(true);
  if (filters) state.cf = filters;
  if (location.hash) location.hash = '';
  scrollTo(0, 0);
  if (local) render(); else if (online) loadCatalog(true); else render();
}
function backToCollections(){
  state.collection = ''; state.localIds = null; state.q = ''; state.panel = false;
  state.cf = {...fresh(), sort: 'popular'};
  syncSearchInputs(true);
  if (location.hash) location.hash = '';
  scrollTo(0, 0); render();
}
function fbar(){
  const f = state.view === 'library' ? state.lf : state.cf, n = f.platforms.length + f.genres.length + f.tags.length + (f.from || f.to ? 1 : 0) + (f.manual ? 1 : 0);
  const b = $('#fbtn'); if (!b) return;
  b.className = 'fc fbtn spot-circle' + (state.panel ? ' on' : '') + (n ? ' has' : '');
  const label = 'Фильтры' + (n ? `: выбрано ${n}` : '');
  b.title = label; b.setAttribute('aria-label', label);
  b.setAttribute('aria-expanded', state.panel); b.innerHTML = `${ic('filter', 18)}<span class="sclbl">Фильтры</span>${n ? `<i class="cnt">${n}</i>` : ''}`;
}
function fpanel(){
  const box = $('#fpanel'); if (!box) return;
  box.hidden = !state.panel || !(state.view === 'catalog' || state.view === 'library'); if (box.hidden) return;
  const libv = state.view === 'library', f = libv ? state.lf : state.cf, fc = libv ? F.facets(lib, rmeta) : null;
  const chip = (k, v, label, on, extra = '') => `<button class="fc sm${on ? ' on' : ''}" data-fk="${k}" data-fv="${esc(v)}" aria-pressed="${on}">${extra}${esc(label)}</button>`;
  const platIds = libv ? fc.platforms.map(x => x[0]) : D.PLATFORMS.filter(p => p.fb).map(p => p.id);
  const platCnt = libv ? Object.fromEntries(fc.platforms) : {};
  const platBlock = D.GROUPS.map(gr => { const ps = platIds.filter(id => (D.PLATFORM_BY_ID[id] || {}).group === gr.id); return ps.length ? `<div class="pgroup"><span class="pgl">${esc(gr.label)}</span>${ps.map(id => chip('platforms', id, D.platLabel(id) + (platCnt[id] ? ' ' + platCnt[id] : ''), f.platforms.includes(id), platIcon(id))).join('')}</div>` : ''; }).join('');
  const genres = libv ? fc.genres.map(([n, c]) => [n, genreRu(n), c]) : D.GENRES.map(g => [g[0], g[1]]);
  const tags = libv ? fc.tags.map(([s, c]) => [s, tagLabel(s), c]) : (tagList.length ? tagList : D.TAGS_FALLBACK.map(slug => ({slug, name: tagLabel(slug)}))).map(t => [t.slug, D.TAG_RU[t.slug] || t.name]);
  const cy = new Date().getFullYear(), years = []; for (let y = cy + 1; y >= 1980; y--) years.push(y);
  const ysel = (k, ph) => `<select class="fsel" data-fy="${k}" aria-label="${ph}"><option value="">${ph}</option>${years.map(y => `<option value="${y}"${String(f[k]) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}</select>`;
  const q = (label, from, to) => `<button class="fc sm${String(f.from) === String(from) && String(f.to) === String(to) ? ' on' : ''}" data-yr="${from}-${to}">${label}</button>`;
  const group = (title, body, icn) => `<div class="fg"><h3>${icn ? ic(icn, 15) : ''}${title}</h3><div class="fchips">${body}</div></div>`;
  const manualCount = Object.values(lib).filter(g => F.isManual(g)).length;
  box.innerHTML = `<div class="fgrid">
    ${!libv && manualCount ? group('Библиотека', `<button class="fc sm" data-manual="1">${ic('plus', 14)} Добавлены вручную <i>${manualCount}</i></button>`, 'layers') : ''}
    ${platIds.length ? group('Платформы и консоли', platBlock, 'monitor') : ''}
    ${genres.length ? group('Жанры', genres.map(([id, l, n]) => chip('genres', id, l, f.genres.includes(id))).join(''), 'layers') : ''}
    ${group('Дата выхода', `${q('Новее 2020', 2020, '')}${q('2010–2019', 2010, 2019)}${q('2000–2009', 2000, 2009)}${q('До 2000', '', 1999)}<span class="yr">${ysel('from', 'От года')}<span class="mut">—</span>${ysel('to', 'До года')}</span>`, 'calendar')}
    ${tags.length ? group('Теги', `<div class="tagbox">${tags.map(([id, l]) => chip('tags', id, l, f.tags.includes(id))).join('')}</div>`, 'tag') : (libv ? '<div class="fg"><h3>' + ic('tag', 15) + 'Теги</h3><p class="mut">Теги появятся, когда сервер получит данные об играх.</p></div>' : '')}
  </div><div class="fact"><button class="fc" data-freset="1">Сбросить фильтры</button><button class="fc on" data-fclose="1">Готово</button></div>`;
}
function resetFilters(){ const f = state.view === 'library' ? state.lf : state.cf; Object.assign(f, fresh()); }
function onFilterChange(){
  if (state.view === 'catalog') { state.collection = ''; state.localIds = null; loadCatalog(true); }
  else render();
}
async function loadTags(){ if (tagList.length || !online) return; try { const t = await jf('/api/tags'); if (Array.isArray(t)) { tagList = t; if (state.panel && state.view === 'catalog') fpanel(); } } catch {} }

// ===== каталог: загрузка с сервера =====
// Каталог постраничный: на экране одна страница (CATALOG_PAGE игр), остальные подгружаются при переключении.
// Так выбор тега или жанра запрашивает одну порцию, а не сотни карточек сразу, и интерфейс не подвисает.
async function loadCatalog(reset, page){
  if (!online) { render(); return; }
  const target = reset ? 1 : Math.max(1, Math.min(+page || 1, cat.pages || 1));
  if (reset) Object.assign(cat, {items: [], page: 0, total: 0, pages: 1, next: false});
  else scrollToGrid();
  const tok = ++cat.tok, key = catKey(); cat.busy = true; cat.want = target;
  if (!catHome()) render();
  const f = state.cf, q = state.q.trim();
  try {
    const params = new URLSearchParams({q, page: String(target), platform: f.platforms.join(','), genre: f.genres.join(','), tag: f.tags.join(','), from: f.from, to: f.to, sort: f.sort});
    const j = await jf('/api/catalog?' + params);
    if (tok !== cat.tok) return;
    if (j.error) throw new Error(j.error);
    const results = Array.isArray(j.results) ? j.results : [];
    for (const i of results) rgInfo[i.id] = i;
    cat.total = +j.count || results.length;
    cat.size = +j.page_size || cat.size || 60;
    cat.pages = +j.pages || Math.max(1, Math.ceil(cat.total / cat.size));
    const seen = new Set(); cat.items = [];
    for (const i of results) { const id = String(i.id); if (!seen.has(id)) { seen.add(id); cat.items.push([i.id, i.name, i.img]); } }
    cat.page = +j.page || target; cat.next = !!j.next; cat.key = key;
    if (!cat.items.length && reset && fActive(f)) toast('Ничего не найдено. Измените фильтры.');
  } catch (e) { if (tok === cat.tok) toast('Не удалось загрузить каталог. ' + (online ? 'Проверьте подключение к интернету.' : 'Запустите приложение через NEXUS.exe.')); }
  if (tok === cat.tok) { cat.busy = false; cat.want = 0; render(); }
}
// при переключении страницы возвращаем прокрутку к началу сетки
function scrollToGrid(){
  try { const g = $('#grid'); if (!g) return; const y = g.getBoundingClientRect().top + scrollY - 130; if (y < scrollY) window.scrollTo({top: Math.max(0, y)}); } catch {}
}
// Номера страниц под сеткой: « ‹ 1 … 4 5 [6] 7 8 … 250 › »
const LIB_PAGE = 50;
function libPage(all){
  const key = JSON.stringify([state.lf, state.lq]);
  if (state.lpKey !== key) { state.lpKey = key; state.lpage = 1; }
  const last = Math.max(1, Math.ceil(all.length / LIB_PAGE)), cur = Math.max(1, Math.min(+state.lpage || 1, last));
  state.lpage = cur; state.lpg = {cur, last, total: all.length};
  return last > 1 ? all.slice((cur - 1) * LIB_PAGE, cur * LIB_PAGE) : all;
}
function pagerHtml(){
  let cur, last, label = 'Страницы каталога';
  if (state.view === 'library') { const p = state.lpg; if (!p || p.last < 2) return ''; cur = p.cur; last = p.last; label = 'Страницы библиотеки'; }
  else { if (state.view !== 'catalog' || catHome() || state.localIds || cat.pages < 2) return ''; cur = cat.want || cat.page || 1; last = cat.pages; }
  const set = new Set([1, last]);
  for (let i = cur - 2; i <= cur + 2; i++) if (i > 1 && i < last) set.add(i);
  let out = '', prev = 0;
  for (const n of [...set].sort((a, b) => a - b)) {
    if (n - prev > 1) out += '<span class="pg-gap">…</span>';
    out += `<button type="button" class="pg-n${n === cur ? ' on' : ''}" data-pg="${n}"${n === cur ? ' aria-current="page"' : ''}>${n}</button>`;
    prev = n;
  }
  const arrow = (to, dis, icn, label) => `<button type="button" class="pg-a" data-pg="${to}"${dis ? ' disabled' : ''} aria-label="${label}">${ic(icn, 16)}</button>`;
  return `<nav class="pgr" aria-label="${label}">${arrow(cur - 1, cur <= 1, 'chevL', 'Предыдущая страница')}${out}${arrow(cur + 1, cur >= last, 'chevR', 'Следующая страница')}<span class="pg-info">Страница ${cur} из ${last}</span></nav>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#pager [data-pg]'); if (!b || b.disabled) return;
  e.preventDefault(); const n = +b.dataset.pg;
  if (state.view === 'library') { const p = state.lpg; if (p && n >= 1 && n <= p.last && n !== p.cur) { state.lpage = n; render(); scrollToGrid(); } return; }
  if (n >= 1 && n <= cat.pages && n !== cat.page) loadCatalog(false, n);
});

// Обложки: файл Steam → API (хэш-путь Steam, SteamGridDB, RAWG) → баннер Steam на размытом фоне → градиент
function ph(i){ if (i.dataset.hero) return i.remove(); const d = document.createElement('div'); d.className = 'ph'; if (!i.closest('.gc')) d.textContent = i.dataset.name; i.replaceWith(d); }
// не больше 4 одновременных запросов обложек, чтобы библиотека не «захлёбывалась» на сотне игр
let covActive = 0; const covWait = [];
const covLimit = fn => new Promise((res, rej) => { const run = () => { covActive++; fn().then(res, rej).finally(() => { covActive--; const n = covWait.shift(); if (n) n(); }); }; if (covActive < 4) run(); else covWait.push(run); });
async function cardErr(i){
  const id = i.dataset.id, s = +(i.dataset.st || 0);
  if (s === 0) {
    i.dataset.st = 1;
    if (online) { try { const r = await covLimit(() => jf(`/api/cover?id=${encodeURIComponent(id)}&name=${encodeURIComponent(i.dataset.name || '')}`)); if (r.url) { i.src = r.url; return; } } catch {} }
  }
  if (+i.dataset.st <= 1 && isSteam(id)) { i.dataset.st = 2; i.src = CDN + id + '/header.jpg'; return; }
  ph(i);
}
// Шапка страницы игры без картинки (игра создана вручную / нет обложки): сразу просим у сервера баннер
function heroFill(i){
  if (i.dataset.hf || !online) return false;          // hf: 1 — запрос идёт, 2 — уже сделан
  i.dataset.hf = '1'; const id = i.dataset.id;
  jf(`/api/hero?id=${encodeURIComponent(id)}&name=${encodeURIComponent(i.dataset.name || lib[id]?.name || '')}`)
    .then(r => { i.dataset.hf = '2'; if (r && r.url) { i.dataset.alt = ''; i.src = r.url; } else ph(i); })
    .catch(() => { i.dataset.hf = '2'; ph(i); });
  return true;
}
document.addEventListener('error', e => {
  const i = e.target; if (i.tagName !== 'IMG' || !i.dataset.id) return;
  if (i.closest('.gc') || i.closest('.sc') || i.closest('.cf-shot')) return void cardErr(i);
  const alt = (i.dataset.alt || '').split('|').filter(Boolean);
  if (alt.length) { i.src = alt.shift(); i.dataset.alt = alt.join('|'); return; }
  if (i.dataset.hero && !isSteam(i.dataset.id)) { if (i.dataset.hf === '1' || heroFill(i)) return; }      // у игры нет своего баннера — подтягиваем по ключу обложек (пока идёт запрос, картинку не трогаем)
  if (i.dataset.det || !isSteam(i.dataset.id)) return ph(i);
  i.dataset.det = 1;
  details(i.dataset.id).then(d => { const u = d?.header_image || d?.screenshots?.[0]?.path_thumbnail; u ? i.src = u : ph(i); });
}, true);
// горизонтальная картинка вместо вертикальной обложки → показываем целиком на размытом фоне, без обрезки.
// Режим можно задать вручную в редакторе обложки: «На всю карточку» (как постер Tomb Raider II) или «Баннер»
function applyFit(c, i){
  const fit = lib[c.dataset.id]?.coverFit;
  const ban = fit === 'banner';                                                           // по умолчанию обложка заполняет всю карточку
  c.classList.toggle('is-banner', ban);
  if (ban) c.style.setProperty('--bg', `url("${i.currentSrc || i.src}")`);
}
document.addEventListener('load', e => { const i = e.target, c = i.tagName === 'IMG' && i.closest?.('.gc'); if (c) applyFit(c, i); }, true);

// ===== карусели: стрелки, состояние кнопок, перетаскивание мышью =====
function updRow(row){
  const t = row.querySelector('.track'); if (!t) return;
  const [p, n] = row.querySelectorAll('.rb, .sc-nav');
  if (p) p.disabled = t.scrollLeft <= 2;
  if (n) n.disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;
}
const updRows = () => document.querySelectorAll('.row').forEach(updRow);
document.addEventListener('scroll', e => { const t = e.target; if (t.classList?.contains('track')) updRow(t.parentElement); }, true);
addEventListener('resize', updRows);
let drag = null, suppress = false;
document.addEventListener('mousedown', e => {
  const t = e.target.closest?.('.track,.thumbs'); if (!t || e.button !== 0) return;
  drag = {t, x: e.clientX, l: t.scrollLeft, moved: false};
});
document.addEventListener('mousemove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; drag.t.classList.add('drag'); }
  if (drag.moved) drag.t.scrollLeft = drag.l - dx;
});
addEventListener('mouseup', () => {
  if (!drag) return;
  drag.t.classList.remove('drag'); if (drag.moved) { suppress = true; setTimeout(() => suppress = false, 0); }
  drag = null;
});
document.addEventListener('click', e => { if (suppress) { e.preventDefault(); e.stopPropagation(); suppress = false; } }, true);
// колесо мыши над лентой миниатюр листает её горизонтально
document.addEventListener('wheel', e => {
  const t = e.target.closest?.('.thumbs,.sctrack'); if (!t || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault(); t.scrollLeft += e.deltaY;
}, {passive: false});
// независимая прокрутка страницы игры: колесо над основной колонкой или правой панелью двигает только эту панель
document.addEventListener('wheel', e => {
  if (!document.body.classList.contains('nx-game-independent') || $('#page').hidden) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.target.closest?.('.thumbs,.sctrack')) return;
  const side = e.target.closest?.('#pside'), main = e.target.closest?.('.gmain');
  if (!side && !main) return;
  const el = side || $('#gscroll'); if (!el) return;
  const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
  const can = d > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 2;
  if (!can) return;
  e.preventDefault(); el.scrollTop += d;
}, {passive: false});

// ===== страница игры (маршрут #game=ID) =====
let snap = null;
const curId = () => $('#page .gp')?.dataset.id || '';
function route(){
  if (typeof closeNew === 'function' && !$('#modal').hidden) closeNew();
  const home = $('#home');
  const sm = location.hash.match(/^#studio=(developer|publisher)\/(\d+)/);
  if (sm) {
    closeLb(); state.pid = 0; state.view = 'studio'; state.studio = {kind: sm[1], id: sm[2], name: state.studio && String(state.studio.id) === String(sm[2]) ? state.studio.name : ''};
    $('#page').hidden = true; $('#page').innerHTML = ''; home.hidden = false; render(); scrollTo(0, 0); return;
  }
  if (location.hash === '#calendar') {
    closeLb(); state.pid = 0; state.view = 'calendar'; state.studio = null;
    $('#page').hidden = true; $('#page').innerHTML = ''; home.hidden = false; render(); scrollTo(0, 0); return;
  }
  const m = location.hash.match(/^#game=([\w-]+)/);
  if (m) {
    if (!home.hidden) snap = {view: state.view, y: scrollY, x: [...document.querySelectorAll('#showcase .track, #rows .track')].map(t => t.scrollLeft)};
    state.studio = null; home.hidden = true; $('#page').hidden = false; openPage(m[1]); scrollTo(0, 0);
  } else {
    if (!location.hash && state.view === 'studio') { state.view = 'catalog'; state.studio = null; }
    closeLb(); state.pid = 0; $('#page').hidden = true; $('#page').innerHTML = ''; home.hidden = false; render();
    if (snap && snap.view === state.view && !state.q.trim()) {
      document.querySelectorAll('#showcase .track, #rows .track').forEach((t, i) => { t.style.scrollBehavior = 'auto'; t.scrollLeft = snap.x[i] || 0; t.style.scrollBehavior = ''; });
      scrollTo(0, snap.y);
    } else scrollTo(0, 0);
    snap = null; requestAnimationFrame(updRows);
  }
}
async function openPage(id){
  const root = $('#page'), name = names[id] || lib[id]?.name || rgInfo[id]?.name || 'Игра ' + id;
  if (state.pid !== id) { state.pid = id; state.tab = 'ov'; state.shot = 0; }
  root.innerHTML = pageHtml(id, name, info[id] || null, false); afterPage();
  if (online && lib[id] && !rmeta[id] && !metaAsked.has(id)) { metaAsked.add(id); jf('/api/meta/' + encodeURIComponent(id) + '/refresh', 'POST').then(() => loadRmeta()).then(async () => { if (curId() === id) { refreshPage(id); if (!info[id] && !isSteam(id) && rmeta[id] && rmeta[id].rawgId) { const d = await extInfo(id); if (curId() === id && d) { root.innerHTML = pageHtml(id, name, d, false); afterPage(); } } } }).catch(() => {}); }
  if (!info[id]) {
    const d = await (isSteam(id) ? details(id) : extInfo(id));
    if (location.hash !== '#game=' + id) return;
    root.innerHTML = pageHtml(id, name, d, !d && isSteam(id)); afterPage();
  }
  loadSimilar(id, name);
}
// данные для игр не из Steam: RAWG (если подключён) или то, что ввёл пользователь
async function extInfo(id){
  // игры без своего RAWG-id (например, добавленные с консоли): берём данные по RAWG-id из метаданных, как только они найдены
  const rid = /^r\d+$/.test(id) ? id.slice(1) : (rmeta[id] && rmeta[id].rawgId ? String(rmeta[id].rawgId) : '');
  if (rid && online) {
    try { const r = await jf('/api/rawg/' + rid);
      if (!r.error) return info[id] = {name: r.name, short_description: r.desc, release_date: {date: r.released}, developers: r.developers, publishers: r.publishers, developersList: r.developersList || [], publishersList: r.publishersList || [], genres: (r.genres || []).map(x => ({description: x})), screenshots: r.screenshots, metacritic: r.metacritic ? {score: r.metacritic} : null, rating: r.rating, header_image: r.image, platformsList: r.parents?.length ? r.parents : r.platforms, playtime: r.playtime, esrb: r.esrb, tags: r.tags}; } catch {}
  }
  const g = lib[id] || {};
  return {name: g.name || names[id] || 'Игра', short_description: g.desc || '', release_date: {date: g.released || ''}, genres: (g.genres || []).map(x => ({description: x})), developers: [], screenshots: [], header_image: g.cover || ''};
}
const afterPage = () => { { const hi = document.querySelector('#page .hero img.bg[data-hero]'); if (hi && !isSteam(hi.dataset.id) && !hi.dataset.alt && /\/uploads\/none\.png$/.test(hi.getAttribute('src') || '')) heroFill(hi); } setTab(state.tab); renderSeries(curId()); renderSim(curId()); trDesc(curId()); renderProg(curId()); loadProgress(curId()); if (typeof window.__nxAfterRender === 'function') window.__nxAfterRender(); };
const frI = (icn, a, b) => b || b === 0 ? `<div class="fr"><small>${icn ? ic(icn, 13) : ''}${a}</small><div>${b}</div></div>` : '';
// имя студии — ссылка на её страницу; для Steam-id студии нет, страница найдётся по названию
const studioLink = (kind, name, sid) => name ? `<button class="studio-link" data-act="nx-studio" data-kind="${kind}"${sid ? ` data-sid="${sid}"` : ''} data-name="${esc(name)}">${esc(name)}</button>` : '';
const studioLinks = (kind, names, list) => {
  const arr = (list && list.length ? list : (names || []).map(name => ({name}))).filter(x => x && x.name);
  return arr.map(x => studioLink(kind, x.name, x.id)).join(', ');
};
// Теги из реальных категорий Steam (appdetails.categories): Кооператив, Мультиплеер, Одиночная игра и т.д.
const STEAM_CAT_TAGS = {2: ['singleplayer'], 1: ['multiplayer'], 9: ['co-op'], 38: ['online-co-op', 'co-op'], 48: ['co-op'], 39: ['co-op', 'split-screen'], 24: ['split-screen'],
  36: ['online-multiplayer'], 37: ['split-screen'], 47: ['multiplayer'], 49: ['pvp'], 20: ['mmo']};
function steamCatTags(d){
  const out = [];
  for (const c of (d && Array.isArray(d.categories) ? d.categories : [])) for (const t of (STEAM_CAT_TAGS[c && c.id] || [])) out.push(t);
  return out;
}
function pageHtml(id, name, d, fail){
  name = d?.name || name;
  const m = rmeta[id] || {}, g = lib[id];
  const pl = (d?.platforms && !Array.isArray(d.platforms) ? Object.entries({windows:'Windows', mac:'macOS', linux:'Linux'}).filter(([k]) => d.platforms[k]).map(e => e[1]).join(', ') : '') || (d?.platformsList || m.platforms || []).join(', ');
  const rel = d?.release_date?.date || g?.released || m.released || '';
  const chip = (icn, t) => t ? `<span>${ic(icn, 14)}${esc(t)}</span>` : '';
  const devName = (d?.developersList || [])[0]?.name || (d?.developers || [])[0] || '';
  const devId = (d?.developersList || [])[0]?.id;
  const meta = [chip('calendar', rel), devName ? `<span>${ic('user', 14)}${studioLink('developer', devName, devId)}</span>` : '', pl ? `<span>${ic('monitor', 14)}${esc(pl)}</span>` : '', g && g.hours ? chip('clock', fmtHM(g.hours)) : '', g?.playedOn?.length ? `<span class="pis">${platIcons(g.playedOn)}</span>` : ''].filter(Boolean);
  const st = isSteam(id), cov = lib[id]?.cover, hero = (st ? [d?.background_raw, d?.screenshots?.[0]?.path_full, d?.header_image, CDN + id + '/header.jpg'] : [cov, d?.header_image, d?.screenshots?.[0]?.path_full]).filter(Boolean).map(esc).join('|');
  const shots = d?.screenshots || [];
  const vids = (d?.movies || []).map(m => [m.thumbnail, m.mp4?.max || m.mp4?.['480'] || m.webm?.max]).filter(v => v[1]).slice(0, 4);
  const fr = (a, b, icn) => frI(icn, a, b);
  const facts = d ? fr('Дата выхода', esc(rel), 'calendar') + fr('Платформы', esc(pl), 'monitor') + fr('Разработчик', studioLinks('developer', d.developers, d.developersList), 'user') + fr('Издатель', studioLinks('publisher', d.publishers, d.publishersList)) + fr('Цена', esc(d.is_free ? 'Бесплатно' : d.price_overview?.final_formatted)) + fr('Metacritic', esc(d.metacritic?.score || m.metacritic)) + fr('Среднее время прохождения', (d.playtime || m.avg) ? esc(fmtHM(d.playtime || m.avg)) : '', 'clock') + fr('Возраст (ESRB)', esc(d.esrb)) : '';
  const link = !st && !/^r\d+$/.test(id) ? fr('Создана', 'вручную') : '';                  // откуда подтянута игра, не показываем
  const desc = d ? `<p id="gdesc">${esc(dec(d.short_description || ''))}</p>` : `<p class="mut">${fail ? 'Не удалось загрузить данные об игре. Попробуйте открыть страницу чуть позже.' : 'Загружаем данные…'}</p>`;
  const gen = (d?.genres || []).map(x => x.description), tgSeen = new Set(), tg = [...new Set([...(m.tags || d?.tags || []), ...steamCatTags(d)])]
    .filter(x => !D.TAG_NOISE.has(x) && !D.TAG_HIDE.has(x))
    .filter(x => { const k = tagLabel(x).toLowerCase(); if (tgSeen.has(k)) return false; tgSeen.add(k); return true; }).slice(0, 8);
  const genres = gen.length || tg.length ? `<div class="chips">${gen.map(x => `<span class="chip">${esc(genreRu(x))}</span>`).join('')}${tg.map(x => `<span class="chip tg">${ic('tag', 12)}<span class="ct">${esc(tagLabel(x))}</span></span>`).join('')}</div>` : '';
  const tabs = [['ov', 'Обзор'], ['st', 'Статистика'], ...(shots.length ? [['sh', 'Скриншоты', shots.length]] : []), ...(vids.length ? [['vd', 'Видео', vids.length]] : [])];
  if (!tabs.some(t => t[0] === state.tab)) state.tab = 'ov';
  return `<div class="gp" data-id="${esc(id)}" data-name="${esc(name)}">
  <div class="hero"><img class="bg" src="${st ? CDN + id + '/library_hero.jpg' : esc(hero.split('|')[0] || '/uploads/none.png')}" alt="" data-id="${esc(id)}" data-hero="1" data-name="${esc(name)}" data-alt="${st ? hero : hero.split('|').slice(1).join('|')}">
  ${st ? `<img class="logo-i" src="${CDN}${id}/logo.png" alt="" onerror="this.remove()">` : ''}
  <button class="back" data-act="back">${ic('back', 16)} Назад</button></div>
  <div class="gwrap"><div class="gmain"><h1>${esc(name)}</h1><div class="gmeta">${meta.join('')}</div>
  <div class="gscroll" id="gscroll">
  <div class="gp-search" role="search" aria-label="Поиск по странице игры"><span class="gps-ico">${ic('search', 15)}</span><input id="gp-q" type="text" placeholder="Поиск по разделам, заметкам и DLC…" autocomplete="off" aria-label="Поиск по странице игры"><button class="gps-clear" data-act="gp-clear" aria-label="Очистить поиск">${ic('x', 14)}</button><div class="gp-sug" id="gp-sug" role="listbox" hidden></div></div>
  <div class="tabs" role="tablist" aria-label="Разделы страницы">${tabs.map(([k, t, n]) => `<button role="tab" data-tab="${k}">${t}${n ? `<i>${n}</i>` : ''}</button>`).join('')}</div>
  <div class="tp" data-p="ov" role="tabpanel">${desc}${genres}${lib[id] ? `<div id="progbox" class="progbox">${progressHtml(id)}</div>` : ''}<div class="facts">${facts}${link}</div><div id="serbox" class="simbox"></div><div id="simbox" class="simbox"></div></div>
  <div class="tp" data-p="st" role="tabpanel" hidden><div id="statsbox">${statsHtml(id)}</div></div>
  ${shots.length ? `<div class="tp" data-p="sh" role="tabpanel" hidden><div class="viewer"><img id="shot" src="${esc(shots[Math.min(state.shot, shots.length - 1)].path_full)}" alt="Скриншот" data-act="zoom">
    <button class="vnav prev" data-act="sprev" aria-label="Предыдущий скриншот">${ic('chevL', 20)}</button><button class="vnav next" data-act="snext" aria-label="Следующий скриншот">${ic('chevR', 20)}</button>
    <button class="vzoom" data-act="zoom" aria-label="Открыть на весь экран">${ic('max', 16)}</button><span class="vcount" id="vcount"></span></div>
    <div class="thumbs" id="thumbs">${shots.map((s, i) => `<button data-i="${i}" aria-label="Скриншот ${i + 1}"><img src="${esc(s.path_thumbnail)}" alt="" loading="lazy" draggable="false"></button>`).join('')}</div></div>` : ''}
  ${vids.length ? `<div class="tp vids" data-p="vd" role="tabpanel" hidden>${vids.map(v => `<video controls preload="none" poster="${esc(v[0])}" src="${esc(v[1])}"></video>`).join('')}</div>` : ''}</div></div>
  <aside id="pside">${pside(id)}</aside></div></div>`;
}
function setTab(t){
  state.tab = t;
  document.querySelectorAll('#page [data-tab]').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('#page .tp').forEach(p => p.hidden = p.dataset.p !== t);
  document.querySelectorAll('#page video').forEach(v => v.pause());
  if (t === 'sh') showShot(state.shot);
  if (t === 'st') renderStatsBox(curId());
}

// ===== скриншоты =====
function showShot(i){
  const sh = info[state.pid]?.screenshots || []; if (!sh.length) return;
  i = (i + sh.length) % sh.length; state.shot = i; const s = sh[i];
  const img = $('#shot');
  if (img && img.src !== s.path_full) { const n = new Image(); n.onload = () => { if (state.shot === i) img.src = s.path_full; }; n.src = s.path_full; }
  const c = $('#vcount'); if (c) c.textContent = `${i + 1} / ${sh.length}`;
  const th = $('#thumbs');
  if (th) { [...th.children].forEach((b, k) => b.classList.toggle('on', k === i)); const t = th.children[i]; if (t) th.scrollTo({left: t.offsetLeft - (th.clientWidth - t.offsetWidth) / 2, behavior: 'smooth'}); }
  if (!$('#lb').hidden) { $('#lbimg').src = s.path_full; $('#lbcount').textContent = `${i + 1} / ${sh.length}`; }
  const nx = sh[(i + 1) % sh.length]; new Image().src = nx.path_full;
}
function openLb(){
  const sh = info[state.pid]?.screenshots || []; if (!sh.length) return;
  const lb = $('#lb');
  lb.innerHTML = `<img id="lbimg" alt=""><button class="lbx" data-act="lbclose" aria-label="Закрыть">${ic('x', 20)}</button>
  <button class="vnav prev" data-act="lbprev" aria-label="Предыдущий">${ic('chevL', 22)}</button><button class="vnav next" data-act="lbnext" aria-label="Следующий">${ic('chevR', 22)}</button><span class="vcount" id="lbcount"></span>`;
  lb.hidden = false; document.body.classList.add('lock'); showShot(state.shot);
}
function closeLb(){ const lb = $('#lb'); if (lb.hidden) return; lb.hidden = true; lb.innerHTML = ''; document.body.classList.remove('lock'); }

// ===== боковая панель =====
function pside(id){
  const g = lib[id], d = info[id], ms = d?.metacritic?.score || rmeta[id]?.metacritic;
  const rawg = +d?.rating || +rmeta[id]?.rating || 0;
  // Личная оценка — строго по центру блока оценок. Слева Metascore, справа оценка RAWG.
  const tiles = `<div class="tiles rating-tiles"><div class="tile"><b>${ms || '—'}</b><span>Metascore</span></div><div class="tile personal"><b>${g?.rating || '—'}</b><span>Ваша оценка</span></div><div class="tile"><b>${rawg ? rawg.toFixed(1).replace(/\.0$/, '') : '—'}</b><span>Оценка RAWG</span></div></div>`;
  return `${g && typeof nxTop === 'function' ? nxTop(id, g) : ''}<div class="mctl">${mctrl(id, g ? tiles : '')}</div>`;
}
const refreshPage = id => { const p = $('#pside'); if (p && curId() == id) { p.innerHTML = pside(id); renderStatsBox(id); } };
// ===== аккордеоны на странице игры (как в iOS): состояние открытых групп запоминается =====
const ACC_KEY = 'nx.acc';
let accOpen = (() => { try { return JSON.parse(localStorage.getItem(ACC_KEY) || '{}') || {}; } catch { return {}; } })();
function acc(id, title, body, opts = {}) {
  const open = accOpen[id] == null ? !!opts.open : !!accOpen[id];
  return `<details class="acc" data-acc="${esc(id)}"${open ? ' open' : ''}><summary><span class="acc-t">${opts.icon ? ic(opts.icon, 16) : ''}${esc(title)}</span>${opts.meta ? `<span class="acc-m">${esc(opts.meta)}</span>` : ''}${ic('chevD', 16)}</summary><div class="acc-b">${body}</div></details>`;
}
document.addEventListener('toggle', e => {
  const d = e.target.closest?.('details[data-acc]'); if (!d) return;
  accOpen[d.dataset.acc] = d.open;
  try { localStorage.setItem(ACC_KEY, JSON.stringify(accOpen)); } catch {}
}, true);
function mctrl(id, extra = ''){
  const g = lib[id];
  if (!g) return `<button class="btn" data-act="add" data-cover="${esc(info[id]?.header_image || '')}">${ic('plus', 16)} В библиотеку</button><p class="hint">После добавления можно выбрать статус, указать время игры, платформу и оценку.</p>`;
  const t = F.hm(g.hours);
  const status = `<div class="seg" role="radiogroup" aria-label="Статус">${Object.entries(STATUS).map(([k, v]) => `<button class="${g.status === k ? 'on' : ''}" role="radio" aria-checked="${g.status === k}" data-act="status" data-v="${k}">${v}</button>`).join('')}</div>
  <div class="lbl"><span class="li">${ic('clock', 14)}Время игры</span><b class="hv">${esc(fmtHM(g.hours, '0 мин'))}</b></div>
  <div class="hm"><label><input type="number" min="0" step="1" inputmode="numeric" data-hm="h" placeholder="0" value="${t.total ? t.h : ''}" aria-label="Часы"><span>ч</span></label><label><input type="number" min="0" max="59" step="1" inputmode="numeric" data-hm="m" placeholder="0" value="${t.total ? t.m : ''}" aria-label="Минуты"><span>мин</span></label></div>
  <div class="quick">${[[-0.25, '−15 мин'], [0.25, '+15 мин'], [1, '+1 ч'], [5, '+5 ч']].map(([v, l]) => `<button data-act="hadd" data-v="${v}">${l}</button>`).join('')}</div>`;
  const rating = `<div class="rating-block"><div class="lbl"><span class="li">${ic('star', 14)}Оценка</span><b>${g.rating || 'нет'}</b></div>
  <div class="rate">${Array.from({length: 10}, (_, i) => i + 1).map(n => `<button class="${+g.rating === n ? 'on' : ''}" data-act="rate" data-v="${n}">${n}</button>`).join('')}</div>
  <textarea data-k="note" placeholder="Заметка об игре" aria-label="Заметка">${esc(g.note)}</textarea></div>`;
  return `${acc('status', 'Статус и время', status, {icon: 'pad', open: true, meta: STATUS[g.status] || ''})}
  ${acc('rating', 'Оценка и заметка', rating, {icon: 'star', open: true, meta: g.rating ? `${g.rating} / 10` : 'нет оценки'})}
  ${extra}
  ${typeof extSide === 'function' ? extSide(id, g) : ''}
  ${typeof nxBottom === 'function' ? nxBottom(id, g) : ''}
  <button class="ghost" data-act="del">Удалить из библиотеки</button>`;
}

// ===== клики и ввод =====
document.addEventListener('click', e => {
  const t = e.target; let b;
  if (t.id === 'lb') return closeLb();
  if ((b = t.closest('[data-showall]'))) { showAllCollection(b.dataset.showall, b.dataset.row); return; }
  if (t.closest('[data-home]')) { backToCollections(); return; }
  if ((b = t.closest('[data-car]'))) { const tr = b.closest('.row').querySelector('.track'); tr.scrollBy({left: +b.dataset.car * tr.clientWidth * .85}); return; }
  if ((b = t.closest('[data-tab]'))) return setTab(b.dataset.tab);
  if ((b = t.closest('[data-i]'))) return showShot(+b.dataset.i);
  b = t.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (typeof nxActCatalog === 'function' && nxActCatalog(act, b, e)) return;
  if (typeof nxAct === 'function' && nxAct(act, b, e)) return;
  if (typeof nxAct2 === 'function' && nxAct2(act, b, e)) return;
  if (typeof nxSwitchAct === 'function' && nxSwitchAct(act, b, e)) return;
  if (typeof profAct === 'function' && profAct(act, b, e)) return;
  if (typeof extAct === 'function' && extAct(act, b, e)) return;
  if (act === 'back') { location.hash = ''; return; }
  if (act === 'sprev') return showShot(state.shot - 1);
  if (act === 'snext') return showShot(state.shot + 1);
  if (act === 'zoom') return openLb();
  if (act === 'lbclose') return closeLb();
  if (act === 'lbprev') return showShot(state.shot - 1);
  if (act === 'lbnext') return showShot(state.shot + 1);
  const w = b.closest('[data-id]'), id = w?.dataset.id, name = w?.dataset.name || names[id];
  let g = lib[id];
  if (!id || (!g && act !== 'add' && act !== 'status')) return;
  let ex = {}, newGame = false;
  if (act === 'status') {
    if (!g) { g = addToLib(id, name, w.dataset.cover || w.querySelector('img')?.src); newGame = true; toast(`«${name}» добавлена в библиотеку`); }
    const was = g.status; g.status = b.dataset.v;
    if (g.status === 'done' && !g.finished) ex.finished = ymdL();
    if (g.status !== 'done' && was === 'done' && g.finished) ex.finished = '';
    if (g.status === 'playing' && !g.started && !g.firstPlayed) ex.started = ymdL();
    Object.assign(g, ex); }
  else if (act === 'hadd') g.hours = Math.max(0, Math.round(((+g.hours || 0) + +b.dataset.v) * 1e4) / 1e4);
  else if (act === 'rate') g.rating = +g.rating === +b.dataset.v ? '' : +b.dataset.v;
  else if (act === 'add') {
    addToLib(id, name, b.dataset.cover || w.querySelector('img')?.src);
    toast(`«${name}» добавлена в библиотеку`); }
  else if (act === 'del') { delete lib[id]; toast(`«${name}» удалена из библиотеки`); }
  if (act === 'del') push(id, null, true);
  else if (act === 'add' || newGame) push(id, null);
  else push(id, act === 'status' ? {status: g.status, ...ex} : act === 'hadd' ? {hours: g.hours} : {rating: g.rating});
  nav(); stats();
  if (!$('#home').hidden) patchCards(id);
  refreshPage(id);
});
document.addEventListener('input', e => {
  const hm = e.target.dataset.hm;
  if (hm) {                                         // время игры: часы и минуты
    const box = e.target.closest('.hm'), id = e.target.closest('[data-id]')?.dataset.id, g = lib[id]; if (!g) return;
    const h = box.querySelector('[data-hm=h]').value, m = box.querySelector('[data-hm=m]').value;
    g.hours = h === '' && m === '' ? '' : F.fromHM(h, m); push(id, {hours: g.hours});
    const hv = e.target.closest('.mctl')?.querySelector('.hv'); if (hv) hv.textContent = fmtHM(g.hours, '0 мин');
    stats(); renderStatsBox(id); return;
  }
  const rg = e.target.closest?.('[data-prog]');
  if (rg) {                                          // прогресс: ползунок двигается сразу, сохранение — по отпусканию
    const box = rg.closest('.pgr'), b = box?.querySelector('.pgr-h b'), bar = box?.querySelector('.rs-bar i');
    if (b) b.textContent = rg.value + '%'; if (bar) bar.style.width = rg.value + '%'; return;
  }
  const k = e.target.dataset.k; if (!k) return;
  let v = e.target.value;
  if (e.target.dataset.skip) return; const g = lib[e.target.closest('[data-id]')?.dataset.id]; if (!g) return;
  g[k] = v; const gid = e.target.closest('[data-id]').dataset.id; push(gid, {[k]: v}); stats(); renderStatsBox(gid);
  if (k === 'progress') {
    if (v === '' || v == null) { delete progCache[gid]; setTimeout(() => loadProgress(gid, true), 600); }
    else progCache[gid] = {pct: Math.max(0, Math.min(100, Math.round(+v || 0))), source: 'manual', t: Date.now()};
    renderProg(gid); refreshPage(gid); patchProgCards(gid);
  }
});
// клавиатура: стрелки в галерее / лайтбоксе, Esc, стрелки на вкладках
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') return closeLb();
  if (e.target.closest?.('input,textarea,select')) return;
  const tl = e.target.closest?.('[role=tablist]');
  if (tl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const bs = [...tl.querySelectorAll('[data-tab]')], i = bs.indexOf(e.target.closest('[data-tab]')), n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
    n.focus(); setTab(n.dataset.tab); e.preventDefault(); return;
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!$('#lb').hidden || (state.pid && state.tab === 'sh')) { showShot(state.shot + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault(); }
});
// свайпы на телефоне: галерея и лайтбокс
let tx = null;
document.addEventListener('touchstart', e => { tx = e.target.closest?.('.viewer,#lb') ? e.touches[0].clientX : null; }, {passive: true});
document.addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 45) showShot(state.shot + (dx < 0 ? 1 : -1)); }, {passive: true});

// ===== навигация, фильтры, сортировка =====
function goView(v){
  state.view = v; snap = null; if (location.hash) location.hash = ''; scrollTo(0, 0);
  if (v !== 'studio') state.studio = null;
  if (v === 'catalog') state.collection = '', state.localIds = null;
  if (v === 'library' && typeof nxApplyPreferredLibTab === 'function') nxApplyPreferredLibTab();
  if (v === 'catalog') { loadTags(); if (!catHome() && cat.key !== catKey()) return void loadCatalog(true); }
  if (v === 'calendar' && typeof nxInvalidateCalendar === 'function') nxInvalidateCalendar();
  render();
}
$('#nav').onclick = e => { const b = e.target.closest('[data-view]'); if (b) goView(b.dataset.view); };
$('#logo').onclick = e => { e.preventDefault(); state.q = ''; syncSearchInputs(true); state.remote = []; sug(); goView('catalog'); };
$('#chips').onclick = e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  if (b.dataset.f === 'manual') { state.lf.manual = !state.lf.manual; render(); return; }   // фильтр-модификатор: сочетается со статусом и «На устройстве»
  state.lf.status = b.dataset.f; state.lf.sort = lsortGet(b.dataset.f); render();
};   // у каждой категории своя сортировка
$('#sort').onchange = e => { (state.view === 'library' ? state.lf : state.cf).sort = e.target.value; if (state.view === 'library') lsortSet(state.lf.status, e.target.value); state.view === 'catalog' ? loadCatalog(true) : render(); };
$('#fbtn').onclick = () => { state.panel = !state.panel; if (state.panel) loadTags(); head(); fbar(); fpanel(); };
document.addEventListener('click', e => {
  let b;
  if ((b = e.target.closest('[data-qti]'))) {
    const q = QUICK_TAGS[+b.dataset.qti]; if (!q) return;
    const f = state.cf, isGenre = !!q.genre, arr = isGenre ? f.genres : f.tags, val = q.genre || q.tag, i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else { f.genres = []; f.tags = []; (isGenre ? f.genres : f.tags).push(val); }
    state.collection = ''; state.localIds = null;
    return onFilterChange();
  }
  if (e.target.closest('[data-manual]')) {
    const ids = Object.entries(lib).filter(([, g]) => F.isManual(g)).map(([id, g]) => [id, g.name]);
    state.view = 'catalog'; state.q = ''; state.collection = 'Добавлены вручную'; state.localIds = ids;
    state.panel = false; syncSearchInputs(true); if (location.hash) location.hash = ''; scrollTo(0, 0); render(); return;
  }
  if ((b = e.target.closest('[data-fk]'))) {
    const f = state.view === 'library' ? state.lf : state.cf, a = f[b.dataset.fk], v = b.dataset.fv, i = a.indexOf(v);
    i < 0 ? a.push(v) : a.splice(i, 1); fpanelKeep(); return onFilterChange();
  }
  if ((b = e.target.closest('[data-yr]'))) {
    const f = state.view === 'library' ? state.lf : state.cf, [from, to] = b.dataset.yr.split('-');
    if (String(f.from) === from && String(f.to) === to) { f.from = ''; f.to = ''; } else { f.from = from; f.to = to; }
    fpanelKeep(); return onFilterChange();
  }
  if (e.target.closest('[data-freset]')) { resetFilters(); fpanelKeep(); return onFilterChange(); }
  if (e.target.closest('[data-fclose]')) { state.panel = false; head(); fbar(); fpanel(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset?.fy; if (!k) return;
  const f = state.view === 'library' ? state.lf : state.cf; f[k] = e.target.value;
  if (f.from && f.to && +f.from > +f.to) [f.from, f.to] = [f.to, f.from];
  fpanelKeep(); onFilterChange();
});
function fpanelKeep(){ const sc = document.querySelector('#fpanel .tagbox')?.scrollTop || 0; fbar(); fpanel(); const tb = document.querySelector('#fpanel .tagbox'); if (tb) tb.scrollTop = sc; }
$('#more').onclick = () => loadCatalog(false, cat.page + 1);

// ===== поиск с подсказками =====
// Один запрос на два поля: большое в центре каталога и компактное в шапке для остальных разделов.
function syncSearchInputs(force){
  const v = state.q || '';
  for (const sel of ['#q', '#sq']) {
    const el = $(sel);
    if (el && (force || document.activeElement !== el) && el.value !== v) el.value = v;
  }
}
// Подсказки приходят уже отранжированными: точное название первым, опечатки и сокращения (gta, cs2, rdr2) понимаются
async function remote(q){
  if (!q.length) { state.remote = []; return sug(); }
  state.remote = localRank(q).slice(0, 6).map(([id, n]) => [id, n, '', lib[id] ? 'lib' : 'steam']); sug();     // мгновенно, пока сервер думает
  try {
    const r = online ? await jf('/api/search?q=' + encodeURIComponent(q))
      : (await proxy(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=russian&cc=US`)).items.map(i => ({id: String(i.id), name: i.name, img: i.tiny_image, src: 'steam'}));
    if (q !== state.q.trim()) return;
    state.remote = (online ? r : S.rank(q, r, {get: i => i.name})).map(i => [i.id, i.name, i.img, i.src]); sug();
  } catch {}
}
function sug(){
  const r = state.remote.slice(0, 7), show = !!r.length && !!state.q.trim();
  const html = r.map(([id, n, im]) => {
    const src = isSteam(id) ? CDN + id + '/header.jpg' : (im || '');
    return `<li data-id="${esc(id)}" data-name="${esc(n)}">${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}<span>${esc(n)}</span>${lib[id] ? `<small class="inlib">${ic('check', 12)}В библиотеке</small>` : ''}</li>`;
  }).join('');
  for (const sel of ['#sug', '#sugs']) {
    const u = $(sel); if (!u) continue;
    u.hidden = !show; u.innerHTML = html;
  }
  const spot = $('#spotlight');
  if (spot) { spot.classList.toggle('has-value', !!state.q.length); spot.classList.toggle('has-sug', show); }
  const clear = $('#sqclear'); if (clear) clear.hidden = !state.q.length;
}
function hideSug(){
  const a = $('#sug'), b = $('#sugs');
  if (a) a.hidden = true; if (b) b.hidden = true;
  const spot = $('#spotlight'); if (spot) spot.classList.remove('has-sug');
}
function pickSuggestion(li){
  if (!li) return;
  hideSug();
  names[li.dataset.id] = li.dataset.name; location.hash = 'game=' + li.dataset.id;
}
function sugKeys(e, listSel){
  const u = $(listSel); if (!u || u.hidden) return;
  const items = [...u.querySelectorAll('li')]; if (!items.length) return;
  const cur = items.findIndex(x => x.classList.contains('on'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    let n = cur + (e.key === 'ArrowDown' ? 1 : -1);
    if (n < 0) n = items.length - 1; if (n >= items.length) n = 0;
    items.forEach(x => x.classList.remove('on')); items[n].classList.add('on'); items[n].scrollIntoView({block: 'nearest'});
  } else if (e.key === 'Enter') {
    const li = (cur >= 0 ? items[cur] : items[0]);
    if (li) { e.preventDefault(); pickSuggestion(li); }
  } else if (e.key === 'Escape') { hideSug(); }
}
let dt;
function onSearchInput(value){
  state.q = value; snap = null; state.collection = ''; state.localIds = null; if (location.hash) location.hash = '';
  if (state.view !== 'catalog') { state.view = 'catalog'; }                                // поиск работает только по каталогу, библиотеку он не трогает
  syncSearchInputs();
  render(); clearTimeout(dt);
  dt = setTimeout(() => { remote(state.q.trim()); if (state.view === 'catalog') { if (state.q.trim() || fActive(state.cf) || state.cf.sort !== 'popular') loadCatalog(true); else render(); } }, 250);
}
$('#q').addEventListener('input', e => onSearchInput(e.target.value));
$('#sq')?.addEventListener('input', e => onSearchInput(e.target.value));
$('#q').addEventListener('keydown', e => sugKeys(e, '#sug'));
$('#sq')?.addEventListener('keydown', e => sugKeys(e, '#sugs'));
$('#sug').addEventListener('click', e => pickSuggestion(e.target.closest('li')));
$('#sugs')?.addEventListener('click', e => pickSuggestion(e.target.closest('li')));
document.addEventListener('click', e => {
  if (!e.target.closest('.search, #spotlight')) hideSug();
});
$('#q').addEventListener('focus', sug);
$('#sq')?.addEventListener('focus', sug);
$('#sqclear')?.addEventListener('click', () => { hideSug(); onSearchInput(''); syncSearchInputs(true); $('#sq')?.focus(); });
// «/» фокусирует центральный поиск, как в Spotlight
document.addEventListener('keydown', e => {
  if (e.key !== '/' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  const spot = $('#spotlight'); if (!spot || spot.hidden) return;
  e.preventDefault(); $('#sq')?.focus();
});

// Ctrl/Cmd + K — фокус на поиск (работает и из других полей ввода)
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return;
  const spot = $('#spotlight'), sq = $('#sq');
  const target = (spot && !spot.hidden && sq && !$('#spotsearch').hidden) ? sq : $('#q');   // в новом shell поиск живёт в верхней панели
  if (!target) return;
  e.preventDefault(); target.focus(); target.select?.();
});

// ===== живые события от сервера =====
let liveStat = null, metaT = 0, libSig = '';
const sigOf = () => Object.entries(lib).map(([id, g]) => [id, Math.round((+g.hours || 0) * 60), g.status, g.fav ? 1 : 0, (g.folders || []).join(), (g.playedOn || []).join(), g.cover || '', g.coverFit || ''].join(':')).join('|');
async function syncLib(){
  let s; try { s = await jf('/api/lib'); } catch { return; }
  for (const id of Object.keys(lib)) if (!(id in s) && !pending[id]) delete lib[id];
  for (const [id, g] of Object.entries(s)) if (!pending[id]) lib[id] = g;
  loadRmeta().then(() => { if (state.pid) { renderStatsBox(state.pid); renderProg(state.pid); } });  backup(); nav(); stats(); chips();
  const sig = sigOf(), changed = sig !== libSig; libSig = sig;
  if (!$('#home').hidden && changed) {
    if (state.view === 'library' || state.view === 'profile') { if (!document.querySelector('#modal:not([hidden])')) render(); }
    else document.querySelectorAll('.gc').forEach(c => patchCards(c.dataset.id));
  }
  const a = document.activeElement;
  if (state.pid && !$('#page').hidden && !(a && a.closest?.('#pside') && /INPUT|TEXTAREA/.test(a.tagName))) refreshPage(state.pid);
}
async function pollNow(){ if (!online) return; try { liveStat = await jf('/api/tracker/status'); liveStat.at = Date.now(); } catch {} updNow(); }
function updNow(){
  let el = $('#now'); if (!el) { el = document.createElement('a'); el.id = 'now'; el.className = 'now'; $('.top').insertBefore(el, $('#nav')); }
  const n = liveStat?.now?.[0];
  if (!n) { el.hidden = true; return; }
  el.hidden = false; el.href = '#game=' + n.id;
  el.innerHTML = `<i></i><span>${esc(n.name)}</span><b>${fmtDur(n.seconds + (Date.now() - liveStat.at) / 1000)}</b>`;
}
function live(){
  if (!online || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'lib') { syncLib(); pollNow(); loadInst(); }
    else if (ev.type === 'folders') { loadMisc().then(() => { if (state.view === 'library') render(); }); }
    else if (ev.type === 'start') { toast(`Вы играете: ${ev.name}. Время считается автоматически`); pollNow(); }
    else if (ev.type === 'end') { toast(`${ev.name}: сессия ${fmtDur(ev.seconds)}`); pollNow(); }
    else if (ev.type === 'added') toast(`Нашёл игру «${ev.name}» и добавил в библиотеку`);
    else if (ev.type === 'notif' && typeof nxNotifPush === 'function') nxNotifPush(ev.n);
    else if (ev.type === 'meta') { clearTimeout(metaT); metaT = setTimeout(async () => { await loadRmeta(); if (state.pid) refreshPage(state.pid); if (state.view === 'library' && !$('#home').hidden) render(); }, 1500); }
  };
  pollNow(); setInterval(pollNow, 15000); setInterval(updNow, 1000);
}

// ===== выбор статуса по правой кнопке на карточке =====
// Меню живёт в body и позиционируется fixed: так оно не обрезается
// overflow у карточки и coverflow-рамки.
const GCS_ICON = {playing:'play', done:'check', planned:'calendar', dropped:'x'};
let gcsMenu = null;

function statusMenuHtml(id, name){
  const g = lib[id], cur = g?.status || '';
  const rows = Object.keys(STATUS).map(k => `<button type="button" class="gcs-b${cur === k ? ' on' : ''}" data-act="status" data-v="${k}" role="menuitemradio" aria-checked="${cur === k}">${ic(GCS_ICON[k] || 'check', 15)}<span>${esc(STATUS[k])}</span>${cur === k ? `<b class="gcs-check">${ic('check', 13)}</b>` : ''}</button>`).join('');
  return `<div class="gcs-head"><span class="gcs-name">${esc(name || '')}</span><span class="gcs-sub">${cur ? 'Статус: ' + esc(STATUS[cur]) : 'Добавить в библиотеку'}</span></div><div class="gcs-list" role="group">${rows}</div>`;
}

function placeStatusMenu(card, x, y){
  if (!gcsMenu || !card) return;
  const mw = gcsMenu.offsetWidth || 208, mh = gcsMenu.offsetHeight || 220;
  const pad = 10;
  if (x == null || y == null) {
    const r = card.getBoundingClientRect();
    x = r.right + pad;
    if (x + mw > innerWidth - pad) x = r.left - mw - pad;
    if (x < pad) x = Math.max(pad, Math.min(innerWidth - mw - pad, r.left + r.width / 2 - mw / 2));
    y = r.top + 8;
    if (y + mh > innerHeight - pad) y = Math.max(pad, innerHeight - mh - pad);
  }
  x = Math.max(pad, Math.min(innerWidth - mw - pad, x));
  y = Math.max(pad, Math.min(innerHeight - mh - pad, y));
  gcsMenu.style.left = Math.round(x) + 'px';
  gcsMenu.style.top = Math.round(y) + 'px';
}

function closeStatusMenu(){
  if (!gcsMenu) return;
  gcsMenu.classList.remove('show');
  gcsMenu.dataset.id = '';
  gcsMenu.dataset.name = '';
  gcsMenu.dataset.cover = '';
}

function showStatusMenu(card, x, y){
  const id = card?.dataset.id;
  if (!id || !gcsMenu) return;
  const name = card.dataset.name || names[id] || '';
  if (gcsMenu.dataset.id !== String(id) || gcsMenu.dataset.name !== name) {
    gcsMenu.dataset.id = String(id);
    gcsMenu.dataset.name = name;
    gcsMenu.innerHTML = statusMenuHtml(id, name);
  }
  gcsMenu.dataset.cover = card.querySelector('img')?.src || '';
  gcsMenu.classList.add('show');
  placeStatusMenu(card, x, y);
}

function initStatusMenu(){
  if (gcsMenu) return;
  gcsMenu = document.createElement('div');
  gcsMenu.className = 'gc-status';
  gcsMenu.setAttribute('role', 'menu');
  gcsMenu.setAttribute('aria-label', 'Статус игры');
  document.body.appendChild(gcsMenu);

  document.addEventListener('contextmenu', e => {
    const card = e.target.closest?.('.gc[data-id], .cf-shot[data-id], .sc[data-id]');
    if (!card || !card.getClientRects().length) return;
    e.preventDefault();
    showStatusMenu(card, e.clientX + 4, e.clientY + 4);
  });
  gcsMenu.addEventListener('click', e => {
    if (!e.target.closest('button[data-v]')) return;
    // Глобальный обработчик применит статус; после него закрываем меню.
    setTimeout(closeStatusMenu, 0);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeStatusMenu();
  });
  document.addEventListener('pointerdown', e => {
    if (!gcsMenu.contains(e.target)) closeStatusMenu();
  }, true);
  addEventListener('scroll', closeStatusMenu, true);
  addEventListener('resize', closeStatusMenu);
}
initStatusMenu();
