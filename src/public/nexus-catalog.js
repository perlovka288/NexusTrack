'use strict';
// NEXUS: «Все игры», полноэкранные серии/папки/подборки, страницы студий,
// календарь релизов, поиск по внутренним разделам игры и вкладка библиотеки по умолчанию.

// ===== вкладка библиотеки по умолчанию =====
const NX_LIBTAB_KEY = 'nx.libtab';
const NX_LIBTABS = ['all', 'playing', 'done', 'planned', 'dropped', 'manual', 'dev'];
const NX_LIBTAB_LABEL = {all: 'Все игры', playing: 'Играю', done: 'Пройдено', planned: 'Буду играть', dropped: 'Брошено', manual: 'Добавлены вручную', dev: 'На устройстве'};
let nxPrefs = {libraryTab: 'all', gridFill: true, gridStyle: 'wide', gameScroll: 'independent'};

// ===== раскладка каталога/библиотеки и режим прокрутки страницы игры =====
const NX_GRID_FILL_KEY = 'nx.gridFill', NX_GRID_STYLE_KEY = 'nx.gridStyle', NX_GAME_SCROLL_KEY = 'nx.gameScroll';
const NX_GRID_STYLES = ['compact', 'wide', 'classic'], NX_GAME_SCROLLS = ['independent', 'classic'];
const nxLocal = k => { try { return localStorage.getItem(k); } catch { return null; } };
const nxStore = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
function nxGridStyle() { const v = String(nxPrefs.gridStyle || ''); return NX_GRID_STYLES.includes(v) ? v : 'wide'; }
function nxGameScroll() { const v = String(nxPrefs.gameScroll || ''); return NX_GAME_SCROLLS.includes(v) ? v : 'independent'; }
function nxApplyUiPrefs() {
  const style = nxGridStyle(), fill = !!nxPrefs.gridFill && style !== 'classic';
  document.body.classList.toggle('nx-grid-fill', fill);
  document.body.classList.toggle('nx-grid-classic', !fill);
  document.body.classList.remove('nx-grid-compact', 'nx-grid-wide');
  document.body.classList.add('nx-grid-' + (fill ? style : 'classic'));
  const classicScroll = nxGameScroll() === 'classic';
  document.body.classList.toggle('nx-game-independent', !classicScroll);
  document.body.classList.toggle('nx-game-classic', classicScroll);
}
function nxPersistUi() {
  const body = {ui: {libraryTab: nxPreferredLibTab(), gridFill: !!nxPrefs.gridFill, gridStyle: nxGridStyle(), gameScroll: nxGameScroll()}};
  jf('/api/config', 'PUT', body).catch(() => {});
}
function nxSetGridFill(on) {
  nxPrefs.gridFill = !!on;
  if (!nxPrefs.gridFill) nxPrefs.gridStyle = 'classic';
  else if (nxGridStyle() === 'classic') nxPrefs.gridStyle = 'wide';
  nxStore(NX_GRID_FILL_KEY, nxPrefs.gridFill ? '1' : '0'); nxStore(NX_GRID_STYLE_KEY, nxGridStyle());
  nxApplyUiPrefs(); nxPersistUi();
}
function nxSetGridStyle(v) {
  nxPrefs.gridStyle = NX_GRID_STYLES.includes(v) ? v : 'wide';
  nxPrefs.gridFill = nxPrefs.gridStyle !== 'classic';
  nxStore(NX_GRID_STYLE_KEY, nxPrefs.gridStyle); nxStore(NX_GRID_FILL_KEY, nxPrefs.gridFill ? '1' : '0');
  nxApplyUiPrefs(); nxPersistUi();
}
function nxSetGameScroll(v) {
  nxPrefs.gameScroll = NX_GAME_SCROLLS.includes(v) ? v : 'independent';
  nxStore(NX_GAME_SCROLL_KEY, nxPrefs.gameScroll);
  nxApplyUiPrefs(); nxPersistUi();
}

function nxPreferredLibTab() {
  const v = String(nxPrefs.libraryTab || '').trim();
  return NX_LIBTABS.includes(v) ? v : 'all';
}
function nxApplyPreferredLibTab() {
  const v = nxPreferredLibTab();
  state.lf.status = v === 'manual' ? 'all' : v;
  state.lf.manual = v === 'manual';
  state.lf.folder = '';
  if (typeof lsortGet === 'function') state.lf.sort = lsortGet(state.lf.status);
}
function nxSetPreferredLibTab(v) {
  v = NX_LIBTABS.includes(v) ? v : 'all';
  nxPrefs.libraryTab = v;
  try { localStorage.setItem(NX_LIBTAB_KEY, v); } catch {}
  state.lf.status = v === 'manual' ? 'all' : v;
  state.lf.manual = v === 'manual';
  state.lf.folder = '';
  if (typeof lsortGet === 'function') state.lf.sort = lsortGet(state.lf.status);
  jf('/api/config', 'PUT', {ui: {libraryTab: v}}).catch(() => {});
  if (state.view === 'library') render();
}
async function nxLoadPrefs() {
  try { const c = await jf('/api/config'); if (c && c.ui) {
    if (NX_LIBTABS.includes(c.ui.libraryTab)) nxPrefs.libraryTab = c.ui.libraryTab;
    if (typeof c.ui.gridFill === 'boolean') nxPrefs.gridFill = c.ui.gridFill;
    if (NX_GRID_STYLES.includes(c.ui.gridStyle)) nxPrefs.gridStyle = c.ui.gridStyle;
    if (NX_GAME_SCROLLS.includes(c.ui.gameScroll)) nxPrefs.gameScroll = c.ui.gameScroll;
  } } catch {}
  try {
    const v = localStorage.getItem(NX_LIBTAB_KEY); if (NX_LIBTABS.includes(v)) nxPrefs.libraryTab = v;
    const f = nxLocal(NX_GRID_FILL_KEY); if (f === '1' || f === '0') nxPrefs.gridFill = f === '1';
    const gs = nxLocal(NX_GRID_STYLE_KEY); if (NX_GRID_STYLES.includes(gs)) nxPrefs.gridStyle = gs;
    const sc = nxLocal(NX_GAME_SCROLL_KEY); if (NX_GAME_SCROLLS.includes(sc)) nxPrefs.gameScroll = sc;
  } catch {}
  if (!nxPrefs.gridFill) nxPrefs.gridStyle = 'classic';
  else if (nxGridStyle() === 'classic') nxPrefs.gridFill = false;
  nxApplyUiPrefs();
}
// мгновенно применяем локальные значения ещё до загрузки библиотеки, чтобы не было вспышки старой раскладки
try {
  const f = nxLocal(NX_GRID_FILL_KEY); if (f === '1' || f === '0') nxPrefs.gridFill = f === '1';
  const gs = nxLocal(NX_GRID_STYLE_KEY); if (NX_GRID_STYLES.includes(gs)) nxPrefs.gridStyle = gs;
  const sc = nxLocal(NX_GAME_SCROLL_KEY); if (NX_GAME_SCROLLS.includes(sc)) nxPrefs.gameScroll = sc;
} catch {}
if (!nxPrefs.gridFill) nxPrefs.gridStyle = 'classic';
else if (nxGridStyle() === 'classic') nxPrefs.gridFill = false;
nxApplyUiPrefs();

// ===== DLC-бейджи =====
const nxDlcIds = new Set();
function nxMarkDlc(id) { if (id != null) nxDlcIds.add(String(id)); }
function nxIsDlc(id) { return nxDlcIds.has(String(id)) || !!(rgInfo[id] && rgInfo[id].dlc); }
function nxDlcBadge(id, inline) {
  return nxIsDlc(id) ? `<span class="dlc-badge${inline ? ' inline' : ''}">DLC</span>` : '';
}

// ===== общий полноэкранный лист =====
let nxFull = null;
function nxFullHost() {
  let el = $('#nxFull');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nxFull'; el.className = 'nxfull'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Полный список игр');
    document.body.appendChild(el);
  }
  return el;
}
function nxBodyLock() {
  const on = !!($('#nxFull') && !$('#nxFull').hidden) || !!($('#nxAll') && !$('#nxAll').hidden);
  document.body.classList.toggle('lock', on);
}
function nxNormItems(items) {
  return (items || []).map(x => typeof x === 'string' ? {id: x, name: names[x] || x, img: rgInfo[x]?.img || ''} : x)
    .filter(x => x && x.id != null)
    .map(x => ({id: String(x.id), name: x.name || names[x.id] || String(x.id), img: x.img || rgInfo[x.id]?.img || '', meta: x.meta || '', dlc: !!x.dlc || nxIsDlc(x.id)}));
}
function nxOpenFull(opts) {
  const items = nxNormItems(opts.items);
  nxFull = {title: opts.title || 'Игры', subtitle: opts.subtitle || '', items, q: '', sort: 'default', mode: 'grid'};
  const host = nxFullHost();
  host.innerHTML = `<div class="nxfull-bg" data-act="nx-full-close"></div>
  <div class="nxfull-panel">
    <header class="nxfull-head"><div><h2>${esc(nxFull.title)}</h2><p>${esc(nxFull.subtitle || `${items.length} игр`)}</p></div><button class="nxclose" data-act="nx-full-close" aria-label="Закрыть">${ic('x', 18)}</button></header>
    <div class="nxfull-tools">
      <label class="nxsearch">${ic('search', 15)}<input id="nxFullQ" type="text" placeholder="Поиск по списку" autocomplete="off" aria-label="Поиск по списку"><button class="search-clear" data-act="nx-full-clear" aria-label="Очистить поиск">${ic('x', 13)}</button></label>
      <select id="nxFullSort" class="nxselect" aria-label="Сортировка списка"><option value="default">Как в подборке</option><option value="name">По названию</option><option value="year">По году</option><option value="added">По популярности</option></select>
      <div class="nxseg" role="group" aria-label="Вид списка"><button class="on" data-act="nx-full-mode" data-v="grid" aria-label="Плитка">${ic('grid', 15)}</button><button data-act="nx-full-mode" data-v="list" aria-label="Список">${ic('list', 15)}</button></div>
    </div>
    <div class="nxfull-body" id="nxFullBody"></div>
  </div>`;
  host.hidden = false;
  nxFullPaint();
  nxBodyLock();
}
function nxFullItems() {
  if (!nxFull) return [];
  const q = nxFull.q.trim().toLowerCase();
  let out = nxFull.items.filter(x => !q || String(x.name).toLowerCase().includes(q));
  if (nxFull.sort === 'name') out = out.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  else if (nxFull.sort === 'year') out = out.slice().sort((a, b) => String(rgInfo[b.id]?.released || '').localeCompare(String(rgInfo[a.id]?.released || '')));
  else if (nxFull.sort === 'added') out = out.slice().sort((a, b) => (+rgInfo[b.id]?.added || 0) - (+rgInfo[a.id]?.added || 0));
  return out;
}
function nxFullPaint() {
  if (!nxFull) return;
  const body = $('#nxFullBody'); if (!body) return;
  const items = nxFullItems();
  if (!items.length) { body.innerHTML = '<p class="nx-empty">Ничего не найдено. Измените запрос.</p>'; return; }
  if (nxFull.mode === 'list') {
    body.innerHTML = `<div class="nxfull-list">${items.map(x => {
      const meta = x.meta || yearGenre(x.id) || '';
      return `<a class="nx-lrow" href="#game=${esc(x.id)}"><img src="${esc(x.img || '/uploads/none.png')}" alt="" loading="lazy"><span class="lt"><b>${esc(x.name)}${nxDlcBadge(x.id, true)}</b><span>${esc(meta)}</span></span></a>`;
    }).join('')}</div>`;
  } else {
    body.innerHTML = `<div class="grid">${items.map(x => card(x.id, x.name, x.img, x.meta || '')).join('')}</div>`;
  }
}
function nxCloseFull() {
  const el = $('#nxFull'); if (!el) return;
  el.hidden = true; el.innerHTML = ''; nxFull = null; nxBodyLock();
}
function nxOpenSeries(id) {
  if (!online) return toast('Серия доступна при подключённом интернете.');
  const name = names[id] || lib[id]?.name || rgInfo[id]?.name || '';
  jf(`/api/series/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`).then(s => {
    if (!s || s.error) return toast('Не удалось загрузить серию.');
    const parts = s.parts || [], dlcs = s.dlcs || [];
    const items = [...parts.map((p, i) => ({id: p.id, name: p.name, img: p.img, meta: `${i + 1} · ${(p.released || '').slice(0, 4) || 'скоро'}`})),
      ...dlcs.map(p => ({id: p.id, name: p.name, img: p.img, meta: `DLC${p.released ? ' · ' + p.released.slice(0, 4) : ''}`, dlc: true}))];
    items.forEach(x => { rgInfo[x.id] = {...(rgInfo[x.id] || {}), name: x.name, img: x.img, released: x.meta.includes('DLC') ? '' : (parts.find(p => p.id === x.id)?.released || '')}; if (x.dlc) nxMarkDlc(x.id); });
    nxOpenFull({title: `Серия: ${s.name || name}`, subtitle: `${parts.length} частей · ${dlcs.length} DLC`, items});
  }).catch(() => toast('Не удалось загрузить серию.'));
}
function nxOpenFolder(fid) {
  const f = folders[fid]; if (!f) return;
  const items = Object.entries(lib).filter(([, g]) => (g.folders || []).includes(fid))
    .sort((a, b) => String(b[1].added || '').localeCompare(String(a[1].added || '')) || String(a[1].name).localeCompare(String(b[1].name), 'ru'))
    .map(([id, g]) => ({id, name: g.name, img: g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : ''), meta: yearGenre(id) || STATUS[g.status] || ''}));
  nxOpenFull({title: `Папка «${f.name}»`, subtitle: `${items.length} игр`, items});
}
function nxOpenCollectionFull() {
  if (!state.collection) return;
  const items = (typeof list === 'function' ? list() : []).map(([id, name, img]) => ({id, name, img, meta: yearGenre(id)}));
  nxOpenFull({title: state.collection, subtitle: `${items.length} игр`, items});
}

// ===== «Все игры»: отдельная полноэкранная таблица с расширенными фильтрами =====
let nxAll = null;
const nxAllOpt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
function nxAllHost() {
  let el = $('#nxAll');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nxAll'; el.className = 'nxall'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Все игры');
    document.body.appendChild(el);
  }
  return el;
}
function nxOpenAllGames() {
  nxAll = {q: '', sort: 'popular', platform: '', genre: '', tag: '', from: '', to: '', page: 1, pages: 1, items: [], total: 0, busy: false, next: false};
  const host = nxAllHost();
  const tags = [...D.TAG_GROUPS.map(g => [g.key, g.label]), ...D.TAG_SINGLE.slice(0, 28).map(s => [s, D.tagLabel ? D.tagLabel(s) : (D.TAG_RU[s] || s)])];
  const years = []; const cy = new Date().getFullYear() + 1; for (let y = cy; y >= 1980; y--) years.push(y);
  host.innerHTML = `<div class="nxall-bg" data-act="nx-all-close"></div>
  <div class="nxall-panel">
    <header class="nxall-head"><div><h2>Все игры</h2><p>Расширенные фильтры и сортировка по всей базе. В выдаче только игры с аудиторией больше 100 человек.</p></div><button class="nxclose" data-act="nx-all-close" aria-label="Закрыть">${ic('x', 18)}</button></header>
    <div class="nxall-tools">
      <label class="nxsearch">${ic('search', 15)}<input id="nxAllQ" type="text" placeholder="Название игры" autocomplete="off" aria-label="Поиск игры"><button class="search-clear" data-act="nx-all-clear" aria-label="Очистить поиск">${ic('x', 13)}</button></label>
      <select id="nxAllSort" class="nxselect" aria-label="Сортировка"><option value="popular">По популярности</option><option value="rating">По рейтингу</option><option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="metacritic">По Metacritic</option><option value="name">По названию</option></select>
      <button class="fc sm" data-act="nx-all-reset">${ic('refresh', 14)} Сбросить</button>
    </div>
    <div class="nxall-filters" id="nxAllFilters">
      <label>Платформа<select class="nxselect" data-nxall="platform"><option value="">Все платформы</option>${D.PLATFORMS.filter(p => p.fb).map(p => nxAllOpt(p.id, p.label, '')).join('')}</select></label>
      <label>Жанр<select class="nxselect" data-nxall="genre"><option value="">Все жанры</option>${D.GENRES.map(g => nxAllOpt(g[0], g[1], '')).join('')}</select></label>
      <label>Тег<select class="nxselect" data-nxall="tag"><option value="">Все теги</option>${tags.map(([v, l]) => nxAllOpt(v, l, '')).join('')}</select></label>
      <label>От года<select class="nxselect" data-nxall="from"><option value="">Любой</option>${years.map(y => nxAllOpt(y, y, '')).join('')}</select></label>
      <label>До года<select class="nxselect" data-nxall="to"><option value="">Любой</option>${years.map(y => nxAllOpt(y, y, '')).join('')}</select></label>
    </div>
    <div class="nxall-body" id="nxAllBody"><p class="nx-empty">Загрузка…</p></div>
    <footer class="nxall-foot"><span id="nxAllCount">Загрузка…</span><button class="fc sm" data-act="nx-all-more" id="nxAllMore" hidden>Показать ещё</button></footer>
  </div>`;
  host.hidden = false;
  nxBodyLock();
  nxAllLoad(true);
}
async function nxAllLoad(reset) {
  if (!nxAll || nxAll.busy) return;
  if (reset) { nxAll.page = 1; nxAll.items = []; nxAll.next = false; }
  nxAll.busy = true;
  const body = $('#nxAllBody'), more = $('#nxAllMore'), cnt = $('#nxAllCount');
  if (reset && body) body.innerHTML = '<p class="nx-empty">Загрузка…</p>';
  if (more) { more.disabled = true; more.hidden = true; }
  try {
    const qs = new URLSearchParams({page: String(nxAll.page), sort: nxAll.sort});
    for (const k of ['q', 'platform', 'genre', 'tag', 'from', 'to']) if (nxAll[k]) qs.set(k, nxAll[k]);
    const r = await jf('/api/catalog?' + qs.toString());
    if (r && r.error) throw new Error(r.error);
    const res = (r.results || []).map(it => {
      rgInfo[it.id] = {...(rgInfo[it.id] || {}), name: it.name, img: it.img, released: it.released, genres: it.genres, genreSlugs: it.genreSlugs, platforms: it.platforms, rating: it.rating, added: it.added};
      return it;
    });
    const seen = new Set(nxAll.items.map(x => String(x.id)));
    for (const it of res) if (!seen.has(String(it.id))) { seen.add(String(it.id)); nxAll.items.push(it); }
    nxAll.total = +r.count || nxAll.items.length;
    nxAll.pages = +r.pages || 1;
    nxAll.next = !!r.next;
    if (body) body.innerHTML = nxAll.items.length
      ? `<div class="grid">${nxAll.items.map(it => card(it.id, it.name, it.img, yearGenre(it.id))).join('')}</div>`
      : '<p class="nx-empty">По этим фильтрам игр не найдено. Сбросьте часть условий.</p>';
    if (cnt) cnt.textContent = `Найдено: ${nxAll.total.toLocaleString('ru-RU')} · показано ${nxAll.items.length}`;
    if (more) { more.hidden = !nxAll.next; more.disabled = false; }
  } catch (e) {
    if (body) body.innerHTML = '<p class="nx-empty">Не удалось загрузить каталог. Проверьте соединение и ключ RAWG.</p>';
    if (cnt) cnt.textContent = 'Ошибка загрузки';
  } finally {
    if (nxAll) nxAll.busy = false;
  }
}
function nxCloseAll() {
  const el = $('#nxAll'); if (!el) return;
  el.hidden = true; el.innerHTML = ''; nxAll = null; nxBodyLock();
}

// ===== страница разработчика/издателя =====
let nxStudioState = {key: '', data: null, busy: false, page: 1, next: false};
function nxOpenStudio(kind, id, name) {
  if (!online) return toast('Страницы студий доступны при подключённом интернете.');
  state.view = 'studio'; state.studio = {kind: kind === 'publisher' ? 'publisher' : 'developer', id: String(id), name: name || ''};
  const h = `#studio=${state.studio.kind}/${state.studio.id}`;
  if (location.hash !== h) location.hash = h;
  render(); scrollTo(0, 0);
}
async function nxOpenStudioByName(kind, name) {
  if (!name) return;
  try {
    const list = await jf('/api/studios?q=' + encodeURIComponent(name));
    const arr = Array.isArray(list) ? list.filter(x => x.kind === (kind === 'publisher' ? 'publisher' : 'developer')) : [];
    const hit = arr.find(x => String(x.name).toLowerCase() === String(name).toLowerCase()) || arr[0];
    if (!hit) return toast('Студия не найдена в базе.');
    nxOpenStudio(hit.kind, hit.id, hit.name);
  } catch { toast('Не удалось найти студию.'); }
}
function nxStudioKey() { return state.studio ? `${state.studio.kind}:${state.studio.id}` : ''; }
async function nxStudioLoad(page, append) {
  const st = state.studio; if (!st) return;
  const key = nxStudioKey();
  if (nxStudioState.busy) return;
  nxStudioState.busy = true;
  try {
    const d = await jf(`/api/studio/${st.kind}/${encodeURIComponent(st.id)}?page=${page || 1}`);
    if (d && d.error) throw new Error(d.error);
    if (nxStudioKey() !== key) return;
    if (append && nxStudioState.data) {
      const seen = new Set((nxStudioState.data.games || []).map(x => String(x.id)));
      for (const it of d.games || []) if (!seen.has(String(it.id))) { seen.add(String(it.id)); nxStudioState.data.games.push(it); }
      nxStudioState.data.next = d.next; nxStudioState.data.page = d.page;
    } else nxStudioState = {key, data: d, busy: false, page: d.page || 1, next: !!d.next};
    for (const it of d.games || []) rgInfo[it.id] = {...(rgInfo[it.id] || {}), name: it.name, img: it.img, released: it.released, genres: it.genres, genreSlugs: it.genreSlugs, platforms: it.platforms, rating: it.rating, added: it.added};
    if (state.studio && d.name) state.studio.name = d.name;
    nxStudioState.busy = false;
    nxStudioPaint();
  } catch {
    nxStudioState.busy = false;
    const box = $('#studioBox'); if (box) box.innerHTML = '<p class="studio-loading">Не удалось загрузить страницу студии. Проверьте соединение.</p>';
  }
}
function nxRenderStudio() {
  const box = $('#studioBox'); if (!box) return;
  const st = state.studio; if (!st) return;
  const key = nxStudioKey();
  if (nxStudioState.key !== key || !nxStudioState.data) {
    if (nxStudioState.key !== key) nxStudioState = {key, data: null, busy: false, page: 1, next: false};
    box.innerHTML = '<p class="studio-loading">Загрузка страницы студии…</p>';
    nxStudioLoad(1, false);
    return;
  }
  nxStudioPaint();
}
function nxStudioPaint() {
  const box = $('#studioBox'); const st = state.studio, d = nxStudioState.data;
  if (!box || !st || !d) return;
  const games = d.games || [];
  const kind = st.kind === 'publisher' ? 'Издатель' : 'Разработчик';
  const desc = d.description || `${d.name || st.name || 'Студия'} — ${st.kind === 'publisher' ? 'издатель' : 'разработчик'} игр. В базе RAWG связано ${(+d.gamesCount || games.length).toLocaleString('ru-RU')} тайтлов; ниже собраны самые заметные из них.`;
  box.innerHTML = `<div class="studio-hero">${d.image ? `<div class="studio-bg" style="background-image:url('${esc(d.image)}')"></div>` : ''}<div class="studio-shade"></div>
    <div class="studio-inner"><button class="studio-back" data-act="nx-studio-back">${ic('back', 15)} Назад</button>
      <div class="studio-kind">${kind}</div><h2>${esc(d.name || st.name || 'Студия')}</h2>
      <p class="studio-desc">${esc(desc)}</p>
      <div class="studio-stats"><span>${(+d.gamesCount || games.length).toLocaleString('ru-RU')} игр в базе</span><span>${games.length}${d.next ? '+' : ''} в подборке</span>${d.slug ? `<span>${esc(d.slug)}</span>` : ''}</div>
    </div></div>
    <div class="studio-games"><div class="row-h"><h3>Игры студии</h3><span class="mut">${games.length}${d.next ? '+' : ''} показано</span></div>
    <div class="grid" id="studioGrid">${games.map(it => card(it.id, it.name, it.img, yearGenre(it.id))).join('')}</div>
    ${d.next ? `<div class="nxmorewrap"><button class="btn" data-act="nx-studio-more">Показать ещё</button></div>` : ''}</div>`;
  if (state.view === 'studio' && typeof head === 'function') head();
}
function nxStudioMore() {
  const d = nxStudioState.data; if (!d || !d.next || nxStudioState.busy) return;
  nxStudioLoad((d.page || 1) + 1, true);
}

// ===== календарь релизов =====
let nxCalState = {data: null, t: 0, busy: false, months: 8};
function nxInvalidateCalendar(force) {
  if (force || !nxCalState.data || Date.now() - nxCalState.t > 10 * 60 * 1000) nxCalState.data = null;
}
function nxRenderCalendar() {
  const box = $('#calendarBox'); if (!box || state.view !== 'calendar') return;
  if (nxCalState.data) return nxCalendarPaint();
  if (nxCalState.busy) return;
  nxCalState.busy = true;
  box.innerHTML = '<p class="cal-loading">Собираем ближайшие релизы…</p>';
  jf('/api/calendar?months=' + nxCalState.months).then(d => {
    nxCalState.busy = false;
    if (!d || d.error) { box.innerHTML = '<p class="cal-empty">Не удалось загрузить календарь. Проверьте соединение и ключ RAWG.</p>'; return; }
    nxCalState.data = d; nxCalState.t = Date.now();
    for (const m of d.months || []) for (const it of m.items || []) rgInfo[it.id] = {...(rgInfo[it.id] || {}), name: it.name, img: it.img, released: it.released, genres: it.genres, genreSlugs: it.genreSlugs, platforms: it.platforms, rating: it.rating, added: it.added};
    if (typeof nxWishSyncCalendar === 'function') nxWishSyncCalendar(d.months);
    nxCalendarPaint();
  }).catch(() => { nxCalState.busy = false; box.innerHTML = '<p class="cal-empty">Не удалось загрузить календарь.</p>'; });
}
function nxMonthLabel(key) {
  try { const s = new Date(key + '-01T12:00:00').toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'}); return s.charAt(0).toUpperCase() + s.slice(1); } catch { return key; }
}
function nxCalendarPaint() {
  const box = $('#calendarBox'), d = nxCalState.data; if (!box || !d) return;
  const months = d.months || [];
  if (!months.length) { box.innerHTML = '<p class="cal-empty">Ближайших релизов не найдено.</p>'; return; }
  box.innerHTML = `<div class="cal-head"><div><h2>Календарь релизов</h2><p>${esc(d.from || '')} — ${esc(d.to || '')}. Только заметные релизы и ожидаемые инди-игры. Нажмите «Добавить в желаемое» — когда дата наступит, NEXUS пришлёт уведомление с подробной карточкой.</p></div><button class="fc sm" data-act="cal-refresh">${ic('refresh', 15)} Обновить</button></div>
  <div class="cal-months">${months.map(m => `<section class="cal-month"><h3>${esc(nxMonthLabel(m.key))} <i>${(m.items || []).length}</i></h3><div class="cal-list">${(m.items || []).map(it => {
    const dt = String(it.released || ''); const day = dt.slice(8, 10) || '—'; const mon = dt ? new Date(dt + 'T12:00:00').toLocaleDateString('ru-RU', {month: 'short'}).replace('.', '') : '';
    const gl = (it.genreSlugs && it.genreSlugs.length ? it.genreSlugs : it.genres) || [];
    const meta = [it.released, (it.platforms || []).slice(0, 3).join(' · '), gl.slice(0, 2).map(g => genreRu(g)).join(' · ')].filter(Boolean);
    return `<article class="cal-row"><a class="cal-date" href="#game=${esc(it.id)}"><b>${esc(day)}</b><span>${esc(mon)}</span></a><a class="cal-cover" href="#game=${esc(it.id)}"><img src="${esc(it.img || '/uploads/none.png')}" alt="" loading="lazy"></a><div class="cal-main"><a class="cal-name" href="#game=${esc(it.id)}">${esc(it.name)}</a><div class="cal-meta">${meta.map(x => `<span>${esc(x)}</span>`).join('')}</div></div><div class="cal-act" data-id="${esc(it.id)}" data-name="${esc(it.name)}" data-cover="${esc(it.img || '')}">${typeof nxCalWishBtn === 'function' ? nxCalWishBtn(it) : actInner(it.id)}</div></article>`;
  }).join('')}</div></section>`).join('')}</div>`;
}

// ===== поиск по внутренним разделам страницы игры =====
function nxGameItems(id) {
  const out = [];
  const add = (label, text, target) => { text = String(text || '').trim(); if (text) out.push({label, text, target}); };
  const desc = $('#gdesc'); if (desc) add('Описание', desc.textContent, {tab: 'ov', sel: '#gdesc'});
  const note = document.querySelector('#page textarea[data-k="note"]'); if (note && note.value.trim()) add('Заметка', note.value, {tab: 'ov', sel: '#page textarea[data-k="note"]'});
  document.querySelectorAll('#page .facts .fr').forEach((el, i) => {
    const label = el.querySelector('small')?.textContent || 'Сведения';
    const text = el.querySelector('div')?.textContent || '';
    add(label, text, {tab: 'ov', sel: `#page .facts .fr:nth-child(${i + 1})`});
  });
  if (typeof serC !== 'undefined' && serC[id]) {
    const s = serC[id];
    for (const p of s.parts || []) add('Серия игр', p.name, {tab: 'ov', sel: '#serbox'});
    for (const p of s.dlcs || []) add('DLC', p.name, {tab: 'ov', sel: '#serbox'});
  }
  if (typeof simCache !== 'undefined' && simCache[id] && Array.isArray(simCache[id].results)) {
    for (const p of simCache[id].results) add('Похожие игры', p.name, {tab: 'ov', sel: '#simbox'});
  }
  const shots = info[id]?.screenshots || [];
  if (shots.length) add('Скриншоты', `${shots.length} скриншотов`, {tab: 'sh', sel: '#page .viewer'});
  return out;
}
function nxMarkText(text, q) {
  text = String(text || '');
  const i = text.toLowerCase().indexOf(String(q || '').toLowerCase());
  if (i < 0) return esc(text.slice(0, 150));
  const from = Math.max(0, i - 45), to = Math.min(text.length, i + q.length + 105);
  return (from ? '…' : '') + esc(text.slice(from, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, to)) + (to < text.length ? '…' : '');
}
function nxGameSearch(q) {
  const box = $('#gp-sug'); if (!box) return;
  q = String(q || '').trim();
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const id = curId();
  const hits = nxGameItems(id).filter(x => (x.label + ' ' + x.text).toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!hits.length) { box.innerHTML = '<div class="gp-sug-empty">На этой странице ничего не найдено.</div>'; box.hidden = false; return; }
  box.innerHTML = `<div class="gp-sug-h">На странице игры</div>${hits.map(x => `<button class="gp-sug-row" data-act="gp-jump" data-jtab="${x.target.tab || 'ov'}" data-sel="${esc(x.target.sel || '')}"><b>${esc(x.label)}</b><span>${nxMarkText(x.text, q)}</span></button>`).join('')}`;
  box.hidden = false;
}
function nxGameJump(b) {
  const tab = b.dataset.jtab; if (tab) setTab(tab);
  const sel = b.dataset.sel; const el = sel ? document.querySelector(sel) : null;
  if (el) {
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
    el.classList.add('nx-flash'); setTimeout(() => el.classList.remove('nx-flash'), 1200);
  }
  const box = $('#gp-sug'); if (box) box.hidden = true;
}

// ===== верхние кнопки очистки =====
function nxMountCatalogUi() {
  const q = $('#q');
  if (q && !$('#qclear')) {
    const b = document.createElement('button');
    b.id = 'qclear'; b.type = 'button'; b.className = 'search-clear'; b.dataset.act = 'q-clear'; b.setAttribute('aria-label', 'Очистить поиск');
    b.innerHTML = ic('x', 14);
    q.insertAdjacentElement('afterend', b);
  }
}

// ===== действия =====
function nxActCatalog(act, b, e) {
  switch (act) {
    case 'nx-allgames': nxOpenAllGames(); return true;
    case 'nx-all-close': nxCloseAll(); return true;
    case 'nx-all-more': if (nxAll) { nxAll.page = (nxAll.page || 1) + 1; nxAllLoad(false); } return true;
    case 'nx-all-reset':
      if (nxAll) {
        Object.assign(nxAll, {q: '', sort: 'popular', platform: '', genre: '', tag: '', from: '', to: ''});
        const q = $('#nxAllQ'); if (q) q.value = '';
        const s = $('#nxAllSort'); if (s) s.value = 'popular';
        document.querySelectorAll('[data-nxall]').forEach(x => x.value = '');
        nxAllLoad(true);
      }
      return true;
    case 'nx-all-clear': { const q = $('#nxAllQ'); if (q) q.value = ''; if (nxAll) nxAll.q = ''; nxAllLoad(true); return true; }
    case 'nx-full-close': nxCloseFull(); return true;
    case 'nx-full-clear': { const q = $('#nxFullQ'); if (q) q.value = ''; if (nxFull) nxFull.q = ''; nxFullPaint(); return true; }
    case 'nx-full-mode': if (nxFull) { nxFull.mode = b.dataset.v === 'list' ? 'list' : 'grid'; document.querySelectorAll('[data-act="nx-full-mode"]').forEach(x => x.classList.toggle('on', x.dataset.v === nxFull.mode)); nxFullPaint(); } return true;
    case 'nx-series-full': nxOpenSeries(b.dataset.id); return true;
    case 'nx-folder-full': nxOpenFolder(b.dataset.fid); return true;
    case 'nx-collection-full': nxOpenCollectionFull(); return true;
    case 'nx-studio': if (b.dataset.sid) nxOpenStudio(b.dataset.kind, b.dataset.sid, b.dataset.name); else nxOpenStudioByName(b.dataset.kind, b.dataset.name); return true;
    case 'nx-studio-back': state.studio = null; goView('catalog'); return true;
    case 'nx-studio-more': nxStudioMore(); return true;
    case 'cal-refresh': nxInvalidateCalendar(true); nxCalState.data = null; nxRenderCalendar(); return true;
    case 'gp-clear': { const q = $('#gp-q'); if (q) q.value = ''; const s = $('#gp-sug'); if (s) { s.hidden = true; s.innerHTML = ''; } return true; }
    case 'gp-jump': nxGameJump(b); return true;
    case 'lq-clear': { const q = $('#lq'); if (q) q.value = ''; state.lq = ''; render(); return true; }
    case 'q-clear': {
      if (typeof onSearchInput === 'function') onSearchInput('');
      else { const q = $('#q'); if (q) { q.value = ''; q.dispatchEvent(new Event('input', {bubbles: true})); } }
      if (typeof syncSearchInputs === 'function') syncSearchInputs(true);
      return true;
    }
  }
  return false;
}

// ===== события =====
document.addEventListener('input', e => {
  if (e.target.id === 'gp-q') return nxGameSearch(e.target.value);
  if (e.target.id === 'nxFullQ' && nxFull) { nxFull.q = e.target.value; nxFullPaint(); return; }
  if (e.target.id === 'nxAllQ' && nxAll) {
    nxAll.q = e.target.value;
    clearTimeout(nxAll._t);
    nxAll._t = setTimeout(() => nxAllLoad(true), 320);
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-uipref-toggle]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  nxSetGridFill(!nxPrefs.gridFill);
  if (typeof renderSettings === 'function') renderSettings();
}, true);
document.addEventListener('change', e => {
  if (e.target.id === 's-libtab' || e.target.id === 'libpref') return nxSetPreferredLibTab(e.target.value);
  const uk = e.target.dataset && e.target.dataset.uipref;
  if (uk === 'gridStyle') { nxSetGridStyle(e.target.value); if (typeof renderSettings === 'function') renderSettings(); return; }
  if (uk === 'gameScroll') { nxSetGameScroll(e.target.value); if (typeof renderSettings === 'function') renderSettings(); return; }
  if (e.target.id === 'nxFullSort' && nxFull) { nxFull.sort = e.target.value; nxFullPaint(); return; }
  if (e.target.id === 'nxAllSort' && nxAll) { nxAll.sort = e.target.value; nxAllLoad(true); return; }
  const k = e.target.dataset && e.target.dataset.nxall;
  if (k && nxAll) { nxAll[k] = e.target.value; nxAllLoad(true); }
});
document.addEventListener('pointerdown', e => {
  const box = $('#gp-sug');
  if (box && !box.hidden && !e.target.closest('.gp-search')) box.hidden = true;
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (nxAll) { nxCloseAll(); return; }
  if (nxFull) { nxCloseFull(); return; }
  const box = $('#gp-sug'); if (box && !box.hidden) { box.hidden = true; return; }
});
addEventListener('hashchange', () => { nxCloseAll(); nxCloseFull(); });

// ===== запуск =====
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { nxMountCatalogUi(); }, {once: true});
  else nxMountCatalogUi();
}
