'use strict';
// NEXUS 3.3: рулетка «Что поиграть?», акцентный цвет интерфейса и галерея «Мои лучшие моменты».

// ===== акцентный цвет =====
const ACC_STORE_KEY = 'nx.accent';
const ACC_PRESETS = [
  ['Neon Green', '#39ff88'], ['Cyberpunk Yellow', '#f5e642'], ['PlayStation Blue', '#2d7ff9'],
  ['Xbox Green', '#10c95a'], ['Neon Violet', '#a855f7'], ['Crimson Red', '#ff3b5c'], ['Белый', '#ffffff']
];
const accOk = h => /^#[0-9a-f]{6}$/i.test(String(h || ''));
const accLocal = () => { try { const a = localStorage.getItem(ACC_STORE_KEY); return accOk(a) ? a : ''; } catch { return ''; } };
// тёмный или светлый текст поверх акцентной заливки
function accInk(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000000' : '#ffffff';
}
function applyAccent(hex) {
  if (!accOk(hex)) hex = '#ffffff';
  const s = document.documentElement.style;
  s.setProperty('--acc', hex); s.setProperty('--acc-ink', accInk(hex));
  s.setProperty('--acc-soft', hex + '33'); s.setProperty('--acc-glow', hex + '4d');
  return hex;
}
function setAccent(hex, save) {
  const v = applyAccent(hex);
  try { localStorage.setItem(ACC_STORE_KEY, v); } catch {}
  if (save) jf('/api/config', 'PUT', {ui: {accent: v === '#ffffff' ? '' : v}}).catch(() => {});
  return v;
}
const curAccent = () => { const v = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim(); return accOk(v) ? v : '#ffffff'; };
applyAccent(accLocal() || '#ffffff');
// сохранённый на сервере цвет главнее локального (например, при открытии сайта с телефона)
if (typeof jf === 'function') jf('/api/config').then(c => { const a = c && c.ui && c.ui.accent; if (accOk(a)) { applyAccent(a); try { localStorage.setItem(ACC_STORE_KEY, a); } catch {} } }).catch(() => {});

function nxThemeSettings() {
  const cur = curAccent().toLowerCase();
  const gridStyle = typeof nxGridStyle === 'function' ? nxGridStyle() : 'wide';
  const gameScroll = typeof nxGameScroll === 'function' ? nxGameScroll() : 'independent';
  const fill = typeof nxPrefs === 'object' ? !!nxPrefs.gridFill : true;
  const styleOpt = (v, label) => `<option value="${v}"${gridStyle === v ? ' selected' : ''}>${label}</option>`;
  const scrollOpt = (v, label) => `<option value="${v}"${gameScroll === v ? ' selected' : ''}>${label}</option>`;
  return `<section class="scard"><h2>Оформление</h2><p class="mut sdesc">Акцентный цвет кнопок, активных состояний, прогресс-баров и свечений. Настройка хранится на этом компьютере и в профиле приложения.</p>
  <div class="accrow">${ACC_PRESETS.map(([n, c]) => `<button class="accsw${cur === c ? ' on' : ''}" style="--sw:${c}" data-act="acc-set" data-c="${c}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${cur === c}"><i></i></button>`).join('')}
    <label class="acccustom"><input type="color" id="acc-color" value="${cur}" aria-label="Свой цвет"><span>Свой HEX</span></label>
    <button class="fc sm" data-act="acc-reset">Сбросить</button></div>
  <label class="gcsw"><input type="checkbox" id="nx-gamecolor" ${localStorage.getItem('nx.gamecolor') === '0' ? '' : 'checked'}><span class="gcsw-t"><b>Цвет игры на её странице</b><small>Страница игры, баннер и кнопки подстраиваются под цвет обложки. Выключите, чтобы везде был выбранный акцент.</small></span><i class="gcsw-k" aria-hidden="true"></i></label>
  <p class="hint l">Пресеты: Neon Green, Cyberpunk Yellow, PlayStation Blue, Xbox Green, Neon Violet и Crimson Red. «Белый» возвращает классический монохром.</p></section>
  <section class="scard"><h2>Сетка и прокрутка</h2><p class="mut sdesc">Раскладка каталога и библиотеки, а также способ прокрутки страницы игры. Изменения применяются сразу и сохраняются в локальных настройках.</p>
    <div class="srow"><div><b>Заполнять всю ширину экрана</b><p class="mut">Сетка карточек растягивается на свободные боковые зоны вместо узкой центральной колонки.</p></div>
      <button class="tg${fill ? ' on' : ''}" role="switch" aria-checked="${fill}" aria-label="Заполнять всю ширину экрана" data-uipref-toggle="1"><i></i></button></div>
    <div class="srow col"><div><b>Стиль сетки</b><p class="mut">Компактный вариант показывает больше постеров в ряд, широкий — увеличивает карточки и использует всю ширину, классический оставляет центрированную колонку.</p></div>
      <select id="s-gridstyle" class="fsel" data-uipref="gridStyle" aria-label="Стиль сетки">${styleOpt('compact', 'Компактная сетка с плотным расположением')}${styleOpt('wide', 'Широкий контент с увеличенным количеством колонок')}${styleOpt('classic', 'Классический по центру')}</select></div>
    <div class="srow col"><div><b>Прокрутка страницы игры</b><p class="mut">Независимый режим прокручивает основное полотно и правую панель отдельно при наведении. Классический — единый вертикальный поток страницы.</p></div>
      <select id="s-gamescroll" class="fsel" data-uipref="gameScroll" aria-label="Режим прокрутки страницы игры">${scrollOpt('independent', 'Независимая прокрутка (Split-Screen)')}${scrollOpt('classic', 'Классический вертикальный поток')}</select></div>
  </section>`;
}

// ===== «Что поиграть?» =====
const PICK_GENRE_H = [
  [/role-playing|\brpg\b/, 38], [/massively-multiplayer|\bmmo\b/, 60], [/strategy/, 26], [/simulation/, 22],
  [/adventure/, 15], [/shooter/, 11], [/action/, 13], [/platformer/, 10], [/racing/, 12], [/sports/, 10],
  [/fighting/, 8], [/puzzle/, 6], [/indie/, 8], [/casual/, 6], [/arcade/, 6], [/card|board/, 5]
];
function estHours(id, g) {
  const m = (typeof rmeta === 'object' && rmeta[id]) || {};
  if (+m.avg > 0) return +m.avg;
  if (+g.playtime > 0) return +g.playtime;
  if (g.status === 'done' && +g.hours > 0) return +g.hours;
  const inf = F.info(id, g, m), keys = [...(inf.genres || []), ...((m.genreSlugs) || [])].map(x => String(x).toLowerCase());
  let h = 0; for (const k of keys) for (const [re, v] of PICK_GENRE_H) if (re.test(k) && v > h) h = v;
  return h || 12;
}
const pickT = {source: 'lib', status: 'all', genre: '', plat: '', time: ''};
const pickCover = (id, g) => g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
const pickPlural = n => n % 10 === 1 && n % 100 !== 11 ? 'игра' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'игры' : 'игр');
function pickPool() {
  const out = [];
  for (const [id, g] of Object.entries(lib)) {
    if (pickT.status !== 'all' && g.status !== pickT.status) continue;
    const inf = F.info(id, g, rmeta[id]);
    if (pickT.genre && !inf.genres.includes(pickT.genre)) continue;
    if (pickT.plat && !inf.platforms.includes(pickT.plat)) continue;
    if (pickT.time) { const h = estHours(id, g), b = h <= 10 ? 's' : h <= 25 ? 'm' : h <= 50 ? 'l' : 'xl'; if (b !== pickT.time) continue; }
    out.push([id, g]);
  }
  return out;
}
// Весь каталог: сервер отдаёт случайную выборку из популярной части базы.
// Слабые, неизвестные и непопулярные игры отфильтровываются, поэтому рулетка не выдаёт мусор.
let pickCat = {key: '', items: [], t: 0, busy: null};
let pickLast = null;   // последняя выпавшая игра: нужна, чтобы «В библиотеку» работала и после очистки пула
const pickCatKey = () => [pickT.genre, pickT.plat, pickT.time].join('|');
async function loadCatPick(force) {
  const key = pickCatKey();
  if (!force && pickCat.key === key && pickCat.items.length && Date.now() - pickCat.t < 5 * 60000) return pickCat.items;
  if (pickCat.busy && pickCat.busy.key === key) return pickCat.busy.p;
  const p = new URLSearchParams();
  if (pickT.genre) p.set('genre', D.GENRE_SLUG[pickT.genre] || pickT.genre);
  if (pickT.plat) p.set('platform', pickT.plat);
  if (pickT.time) p.set('time', pickT.time);
  const task = jf('/api/random?' + p).then(j => {
    pickCat = {key, t: Date.now(), busy: null, items: (j.results || []).map(it => [it.id, {
      name: it.name, cover: it.img || '', released: it.released || '', genres: it.genres || [],
      playtime: it.playtime || 0, rating: it.rating || 0, added: it.added || 0, catalog: true
    }])};
    return pickCat.items;
  }).catch(e => { pickCat.busy = null; throw e; });
  pickCat.busy = {key, p: task};
  return task;
}
function pickCardHtml(id, g) {
  return `<div class="pick-card"><img src="${esc(pickCover(id, g))}" alt="" loading="eager" onerror="this.onerror=null;this.src='/uploads/none.png'">
    <span class="pick-shade"></span><span class="pick-name">${esc(g.name)}</span></div>`;
}
async function pickReelIdle() {
  const tr = $('#reeltrack'); if (!tr) return;
  const stale = pickT.source === 'catalog' && pickCat.key !== pickCatKey();
  let pool = pickT.source === 'catalog' ? pickCat.items : pickPool();
  if (pickT.source === 'catalog' && (!pool.length || stale)) {
    tr.innerHTML = '<p class="mut" style="padding:20px">Подбираем игры из каталога…</p>';
    try { pool = await loadCatPick(); } catch {}
    if (!tr.isConnected) return;
  }
  const src = pool.length ? pool : (pickT.source === 'lib' ? Object.entries(lib) : []);
  if (!src.length) {
    tr.innerHTML = `<p class="mut" style="padding:20px">${pickT.source === 'catalog' ? 'Не удалось загрузить каталог — проверьте подключение.' : 'Библиотека пуста — добавьте игры, и рулетка заработает.'}</p>`;
    return;
  }
  const cards = []; for (let i = 0; i < 22; i++) cards.push(src[(i * 7 + Math.floor(Math.random() * src.length)) % src.length]);
  tr.style.transition = 'none'; tr.style.transform = 'translateX(0)'; tr.innerHTML = cards.map(([id, g]) => pickCardHtml(id, g)).join('');
}
function openPick() {
  if (!Object.keys(lib).length && pickT.source !== 'catalog') pickT.source = 'catalog';
  if (pickT.source === 'catalog' && !online) pickT.source = Object.keys(lib).length ? 'lib' : 'catalog';
  const cat = pickT.source === 'catalog';
  const f = F.facets(lib, rmeta);
  const genres = cat ? D.GENRES.map(g => [g[2], g[1], 0]) : f.genres.slice(0, 24).map(([x, n]) => [x, genreRu(x), n]);
  const plats = cat ? D.PLATFORMS.filter(p => p.fb).map(p => [p.id, p.label, 0]) : f.platforms.filter(([p]) => p).map(([p, n]) => [p, (D.PLATFORM_BY_ID[p] || {label: p}).label, n]);
  const st = Object.entries(STATUS);
  modal().innerHTML = `<div class="mbox pickm" role="dialog" aria-modal="true" aria-label="Что поиграть">
    <div class="mh"><h2>Что поиграть?</h2><button class="ib" data-act="pick-close" aria-label="Закрыть">${ic('x', 18)}</button></div>
    <p class="mut pick-sub">Выберите настроение и доверьте выбор рулетке. Можно крутить по своей библиотеке или по всему каталогу — слабые и непопулярные игры отсеиваются.</p>
    <div class="pick-filters">
      <label>Источник<select class="fsel" data-pf="source"><option value="lib"${cat ? '' : ' selected'}>Моя библиотека</option><option value="catalog"${cat ? ' selected' : ''}>Весь каталог</option></select></label>
      <label>Статус<select class="fsel" data-pf="status"${cat ? ' disabled title="Работает для своей библиотеки"' : ''}><option value="all">Вся библиотека</option>${st.map(([k, v]) => `<option value="${k}"${pickT.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Жанр<select class="fsel" data-pf="genre"><option value="">Любой жанр</option>${genres.map(([x, label, n]) => `<option value="${esc(x)}"${pickT.genre === x ? ' selected' : ''}>${esc(label)}${n ? ` · ${n}` : ''}</option>`).join('')}</select></label>
      <label>Платформа<select class="fsel" data-pf="plat"><option value="">Любая платформа</option>${plats.map(([p, label, n]) => `<option value="${p}"${pickT.plat === p ? ' selected' : ''}>${esc(label)}${n ? ` · ${n}` : ''}</option>`).join('')}</select></label>
      <label>Время прохождения<select class="fsel" data-pf="time"><option value="">Любое</option><option value="s"${pickT.time === 's' ? ' selected' : ''}>до 10 часов</option><option value="m"${pickT.time === 'm' ? ' selected' : ''}>10–25 часов</option><option value="l"${pickT.time === 'l' ? ' selected' : ''}>25–50 часов</option><option value="xl"${pickT.time === 'xl' ? ' selected' : ''}>50+ часов</option></select></label>
    </div>
    <div class="reelwrap">
      <div class="reel" id="reel"><div class="reeltrack" id="reeltrack"></div><span class="reelmark" aria-hidden="true"></span></div>
      <div class="pickbar"><button class="btn pick-spin" data-act="pick-spin">${ic('play', 16)} Крутить</button><span class="mut" id="pickcount"></span></div>
      <div id="pickres" class="pickres" aria-live="polite"></div>
    </div></div>`;
  modal().hidden = false; document.body.classList.add('lock');
  pickCount(); pickReelIdle();
}
async function pickCount() {
  const el = $('#pickcount'); if (!el) return;
  if (pickT.source === 'catalog') {
    const stale = pickCat.key !== pickCatKey();
    if (!pickCat.items.length || stale) el.textContent = 'Ищем игры в каталоге…';
    let items = pickCat.items;
    if (!items.length || stale) { try { items = await loadCatPick(); } catch {} }
    if (!el.isConnected) return;
    el.textContent = items.length ? `${items.length} ${pickPlural(items.length)} из популярной части каталога` : 'Ничего не подошло — ослабьте фильтры';
    return;
  }
  const n = pickPool().length;
  el.textContent = n ? `${n} ${pickPlural(n)} в подборке` : 'Под фильтры ничего не подошло';
}
async function spinPick() {
  const tr = $('#reeltrack'), reel = $('#reel'), res = $('#pickres');
  if (!tr || !reel || reel.dataset.spin === '1') return;
  let pool;
  if (pickT.source === 'catalog') {
    const count = $('#pickcount'); if (count) count.textContent = 'Крутим каталог…';
    try { pool = await loadCatPick(); } catch { pool = []; }
    if (!pool.length) { toast('Не удалось получить игры из каталога — проверьте подключение'); pickCount(); return; }
  } else {
    pool = pickPool();
    if (!pool.length) return toast('Под эти фильтры ничего не подошло — ослабьте условия');
  }
  const winner = pool[Math.floor(Math.random() * pool.length)];
  const N = 46, target = 40, cards = [];
  for (let i = 0; i < N; i++) cards.push(pool[Math.floor(Math.random() * pool.length)]);
  cards[target] = winner;
  reel.dataset.spin = '1'; reel.classList.add('spinning'); if (res) res.innerHTML = '';
  tr.style.transition = 'none'; tr.style.transform = 'translateX(0)'; tr.innerHTML = cards.map(([id, g]) => pickCardHtml(id, g)).join('');
  void tr.offsetWidth;
  const item = tr.children[target], dx = Math.max(0, item.offsetLeft - (reel.clientWidth - item.offsetWidth) / 2);
  requestAnimationFrame(() => { tr.style.transition = 'transform 3.8s cubic-bezier(.08,.72,.06,1)'; tr.style.transform = `translateX(${-dx}px)`; });
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    reel.dataset.spin = ''; reel.classList.remove('spinning'); showPickResult(winner);
    if (pickT.source === 'catalog') { pickLast = winner; pickCat.items = []; pickCount(); }
  };
  tr.addEventListener('transitionend', finish, {once: true});
  setTimeout(finish, 4200);   // страховка, если transitionend не придёт
}
function showPickResult([id, g]) {
  const res = $('#pickres'); if (!res) return;
  const inf = F.info(id, g, rmeta[id]), h = Math.round(estHours(id, g));
  const owned = !!lib[id], rate = g.rating || rmeta[id]?.rating || 0;
  const can = !!(g.installed || g.launch || g.emu || /^\d+$/.test(id));
  const meta = [inf.year || g.released?.slice(0, 4) || '', inf.genres.length ? (typeof genreRu === 'function' ? genreRu(inf.genres[0]) : inf.genres[0]) : '', h ? `≈ ${h} ч` : '', g.status ? (STATUS[g.status] || '') : '', g.catalog ? 'из каталога' : ''].filter(Boolean).map(esc);
  res.innerHTML = `<div class="picked"><img src="${esc(pickCover(id, g))}" alt="" onerror="this.onerror=null;this.src='/uploads/none.png'">
    <div class="picked-in"><span class="picked-l">Выпала игра</span><h3>${esc(g.name)}</h3><p class="mut">${meta.join(' · ')}${rate ? ` · ★ ${esc(rate)}` : ''}</p>
    <div class="pickbtns">${owned ? '' : `<button class="btn" data-act="pick-add" data-id="${esc(id)}">${ic('plus', 16)} В библиотеку</button>`}
    <button class="btn${owned ? '' : ' ghost'}" data-act="pick-launch" data-id="${esc(id)}"${can ? '' : ' disabled title="Укажите файл запуска на странице игры"'}>${ic('play', 16)} Запустить прямо сейчас</button>
    <button class="ib wide" data-act="pick-again">${ic('refresh', 16)} Крутить ещё раз</button>
    <button class="ib wide" data-act="pick-open-page" data-id="${esc(id)}">${ic('back', 16)} Открыть страницу</button></div></div></div>`;
  res.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}
async function pickLaunch(id) {
  const g = lib[id]; if (!g) return;
  const r = await jf('/api/launch/' + encodeURIComponent(id), 'POST').catch(() => ({ok: false, message: 'Нет связи с сервером'}));
  toast(r.ok ? `Запускаю «${g.name}»` + (r.how === 'emulator' ? ' в эмуляторе' : '') : (r.message || 'Не удалось запустить'));
}

// ===== скриншоты и «Мои лучшие моменты» =====
const shotsOf = id => { const a = lib[id] && lib[id].shots; return Array.isArray(a) ? a.filter(x => x && x.u) : []; };
const shotOk = u => /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/i.test(String(u || ''));
const shotDate = t => { const d = new Date(t || ''); return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'}); };
const pickFiles = accept => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = accept; i.onchange = () => ok([...(i.files || [])]); i.click(); });
function moments() {
  const out = [];
  for (const [id, g] of Object.entries(lib)) for (const s of shotsOf(id)) out.push({id, g, u: s.u, t: s.t || ''});
  return out.sort((a, b) => String(b.t).localeCompare(String(a.t)));
}
function shotsSide(id, g) {
  const list = shotsOf(id);
  const thumbs = list.length ? `<div class="shotgrid">${list.map((s, i) => `<div class="shot"><img src="${esc(s.u)}" alt="" loading="lazy" data-act="mom-open-game" data-id="${esc(id)}" data-i="${i}"><button class="shotx" data-act="shot-del" data-id="${esc(id)}" data-i="${i}" title="Удалить" aria-label="Удалить скриншот">${ic('x', 12)}</button></div>`).join('')}</div>`
    : '<p class="hint l">Пока пусто. Загрузите скриншоты или гифки — они появятся в галерее «Мои лучшие моменты» в профиле.</p>';
  return acc('shots', 'Скриншоты и моменты', `<div class="shots" data-id="${esc(id)}">${thumbs}
    <div class="sbtns"><button class="ib wide" data-act="shot-up" data-id="${esc(id)}">${ic('upload', 16)} Загрузить файлы</button></div>
    <div class="covctl"><input id="shot-url" placeholder="Ссылка на скриншот или гифку (https://…)" aria-label="Ссылка на скриншот"><button class="ib" data-act="shot-link" data-id="${esc(id)}" title="Добавить ссылку" aria-label="Добавить ссылку">${ic('check', 16)}</button></div>
    <p class="hint l">Подойдут PNG, JPG, WEBP и GIF до 16 МБ. Моменты видны в профиле на вкладке «Мои лучшие моменты».</p></div>`, {icon: 'image', meta: list.length ? String(list.length) : ''});
}
function shotsGallery() {
  const list = moments();
  if (!list.length) return `<div class="momempty"><span class="momic">${ic('image', 34)}</span><h3>Моментов пока нет</h3><p class="mut">Откройте страницу игры и добавьте скриншоты в блоке «Скриншоты и моменты». Всё лучшее соберётся здесь.</p><button class="btn" data-act="pf-tab" data-v="main">${ic('back', 16)} В профиль</button></div>`;
  return `<div class="momtop"><p class="mut">Всего моментов: <b>${list.length}</b> · из ${new Set(list.map(x => x.id)).size} игр</p></div>
  <div class="masonry">${list.map((m, i) => `<button class="mom" data-act="mom-open" data-i="${i}" title="${esc(m.g.name)}"><img src="${esc(m.u)}" alt="${esc(m.g.name)}" loading="lazy">
    <span class="momshade"></span><span class="momcap"><b>${esc(m.g.name)}</b><small>${esc([shotDate(m.t), m.g.rating ? '★ ' + m.g.rating : ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>`;
}
let momCache = [];
function openMoments(list, i) {
  momCache = list; const lb = ensureMomLb(); lb.dataset.i = i; lb.hidden = false; document.body.classList.add('lock'); showMoment(+i);
}
function ensureMomLb() {
  let lb = document.getElementById('mlb');
  if (lb) return lb;
  lb = document.createElement('div'); lb.id = 'mlb'; lb.className = 'mlb'; lb.hidden = true; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Просмотр момента');
  lb.innerHTML = `<button class="mlbx x" data-act="mom-close" aria-label="Закрыть">${ic('x', 22)}</button>
    <button class="mlbx prev" data-act="mom-prev" aria-label="Предыдущий">${ic('chevL', 24)}</button>
    <figure><img id="mlb-img" alt=""><figcaption><b id="mlb-game"></b><span id="mlb-meta"></span></figcaption></figure>
    <button class="mlbx next" data-act="mom-next" aria-label="Следующий">${ic('chevR', 24)}</button>`;
  document.body.appendChild(lb);
  return lb;
}
function showMoment(i) {
  if (!momCache.length) return;
  i = (i + momCache.length) % momCache.length;
  const lb = ensureMomLb(); lb.dataset.i = i;
  const m = momCache[i];
  $('#mlb-img').src = m.u; $('#mlb-img').alt = m.g.name;
  $('#mlb-game').textContent = m.g.name;
  $('#mlb-meta').textContent = [shotDate(m.t), m.g.rating ? `★ ${m.g.rating} / 10` : 'без оценки', STATUS[m.g.status] || ''].filter(Boolean).join(' · ');
}
function closeMoment() { const lb = document.getElementById('mlb'); if (!lb || lb.hidden) return false; lb.hidden = true; document.body.classList.remove('lock'); return true; }
function momStep(d) { const lb = document.getElementById('mlb'); if (!lb || lb.hidden) return; showMoment((+lb.dataset.i || 0) + d); }
async function addShotFiles(id, files) {
  const g = lib[id]; if (!g) return;
  const list = shotsOf(id).slice(), before = list.length; let skipped = 0;
  for (const f of files.slice(0, 12)) {
    if (!/^image\//i.test(f.type)) { skipped++; continue; }
    try { const u = await uploadFile(f); if (shotOk(u)) list.push({u, t: new Date().toISOString()}); } catch (e) { toast(e.message); }
  }
  const added = list.length - before;
  if (!added) { if (skipped) toast('Нужны файлы изображений: PNG, JPG, WEBP или GIF'); return; }
  g.shots = list.slice(0, 80); push(id, {shots: g.shots}); try { accOpen.shots = true; } catch {}
  refreshPage(id);
  toast(`Добавлено моментов: ${added}`);
  if (skipped) toast(`Пропущено файлов: ${skipped} (нужны картинки)`);
  if (state.view === 'profile') renderProfile();
}
async function addShotLink(id) {
  const inp = $('#shot-url'), u = inp ? inp.value.trim() : '';
  if (!shotOk(u)) return toast('Нужна ссылка на картинку: https://… или /uploads/…');
  const g = lib[id]; if (!g) return;
  const list = shotsOf(id).slice(); list.push({u, t: new Date().toISOString()});
  g.shots = list.slice(0, 80); push(id, {shots: g.shots}); try { accOpen.shots = true; } catch {} refreshPage(id); toast('Момент добавлен');
  if (state.view === 'profile') renderProfile();
}
function delShot(id, i) {
  const g = lib[id]; if (!g) return;
  const list = shotsOf(id).slice(); list.splice(i, 1);
  g.shots = list; push(id, {shots: g.shots}); try { accOpen.shots = true; } catch {} refreshPage(id);
  if (state.view === 'profile') renderProfile();
}

// ===== кнопка рулетки в панели инструментов =====
function mountWheelBtn() {
  const r = document.querySelector('.toolr'); if (!r || document.getElementById('wheelbtn')) return;
  const b = document.createElement('button');
  b.id = 'wheelbtn'; b.className = 'fc fbtn wheelbtn spot-circle'; b.dataset.act = 'pick-open'; b.title = 'Что поиграть?'; b.setAttribute('aria-label', 'Что поиграть?');
  b.innerHTML = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg><span class="sclbl">Что поиграть?</span>`;
  r.insertBefore(b, r.firstChild);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountWheelBtn, {once: true}); else mountWheelBtn();

// ===== события =====
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  const A = {
    'pick-open': () => openPick(),
    'pick-close': () => closeNew(),
    'pick-spin': () => spinPick(),
    'pick-again': () => spinPick(),
    'pick-launch': () => pickLaunch(id),
    'pick-add': () => {
      const found = pickCat.items.find(x => x[0] === id) || (pickLast && pickLast[0] === id ? pickLast : null);
      if (!found || lib[id]) return;
      rgInfo[id] = found[1];
      addToLib(id, found[1].name, found[1].cover);
      push(id, null); nav(); stats(); patchCards(id);
      toast(`«${found[1].name}» добавлена в библиотеку`);
      showPickResult([id, {...found[1], ...lib[id], cover: lib[id].cover || found[1].cover, rating: found[1].rating || lib[id].rating}]);
    },
    'pick-open-page': () => { const gid = b.dataset.id; closeNew(); location.hash = 'game=' + encodeURIComponent(gid); },
    'acc-set': () => { setAccent(b.dataset.c, true); renderSettings(); },
    'acc-reset': () => { setAccent('#ffffff', true); renderSettings(); },
    'shot-up': async () => { const id2 = b.dataset.id || state.pid; const files = await pickFiles('image/*'); if (files.length) addShotFiles(id2, files); },
    'shot-link': () => addShotLink(b.dataset.id || state.pid),
    'shot-del': () => delShot(b.dataset.id || state.pid, +b.dataset.i),
    'mom-open': () => openMoments(moments(), +b.dataset.i),
    'mom-open-game': () => { const gid = b.dataset.id, list = shotsOf(gid).map(s => ({id: gid, g: lib[gid], u: s.u, t: s.t})); openMoments(list, +b.dataset.i); },
    'mom-close': () => closeMoment(),
    'mom-prev': () => momStep(-1),
    'mom-next': () => momStep(1),
    'pf-tab': () => { if (typeof setPfTab === 'function') setPfTab(b.dataset.v); }
  };
  const fn = A[act], isMine = /^(pick|acc|shot|mom|pf-tab)/.test(act);
  if (!isMine) return;
  e.preventDefault(); e.stopPropagation();      // не даём общему обработчику принять наш клик за действие с игрой
  if (fn) fn();
}, true);

// фильтры рулетки
document.addEventListener('change', e => {
  const s = e.target.closest?.('[data-pf]'); if (!s) return;
  pickT[s.dataset.pf] = s.value;
  const res = $('#pickres'); if (res) res.innerHTML = '';
  if (s.dataset.pf === 'source') {
    openPick();   // у каталога и библиотеки разные наборы жанров и платформ — перестраиваем окно
    return;
  }
  pickReelIdle(); pickCount();
}, true);
document.addEventListener('input', e => {
  if (e.target.id !== 'acc-color') return;
  setAccent(e.target.value, false);
}, true);
document.addEventListener('change', e => {
  if (e.target.id !== 'acc-color') return;
  setAccent(e.target.value, true); renderSettings();
}, true);
// лайтбокс моментов: Esc и стрелки
document.addEventListener('keydown', e => {
  const lb = document.getElementById('mlb');
  if (!lb || lb.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMoment(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); momStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); momStep(1); }
}, true);
document.addEventListener('click', e => {
  const lb = document.getElementById('mlb'); if (!lb || lb.hidden) return;
  if (e.target === lb) closeMoment();
}, true);
