'use strict';
// NEXUS 3.2: серия игр, перевод описаний, «На устройстве», режимы просмотра, карусель любимых, стеклянные папки, мобильная версия

Object.assign(IC, {grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>'});
// ===== библиотека: свой поиск и своя сортировка у каждой категории =====
const LSORT_DEFAULT = {all: 'name', playing: 'played', done: 'finished', planned: 'added', dropped: 'played', manual: 'added', dev: 'name'};
const lsortLoad = () => { try { return JSON.parse(localStorage.getItem('nx.lsort') || '{}'); } catch { return {}; } };
const lsortGet = st => lsortLoad()[st] || LSORT_DEFAULT[st] || 'name';
const lsortSet = (st, v) => { try { const o = lsortLoad(); o[st] = v; localStorage.setItem('nx.lsort', JSON.stringify(o)); } catch {} };
state.lf.sort = lsortGet(state.lf.status);
(() => { const ls = $('#lsearch'); if (!ls) return; ls.innerHTML = ic('search', 16) + '<input id="lq" type="text" placeholder="Поиск в библиотеке" autocomplete="off" aria-label="Поиск в библиотеке"><button type="button" class="search-clear" data-act="lq-clear" aria-label="Очистить поиск">' + ic('x', 14) + '</button>';
  let t = 0; $('#lq').addEventListener('input', e => { state.lq = e.target.value; clearTimeout(t); t = setTimeout(render, 120); }); })();

// ===== «На устройстве» =====
let instMap = {};
async function loadInst() { try { instMap = await jf('/api/installed'); } catch {} }

// ===== серия игр =====
const nParts = n => `${n} ${plural(n, 'часть', 'части', 'частей')}`;
const nDlc = n => `${n} ${plural(n, 'дополнение', 'дополнения', 'дополнений')}`;
const serC = {};
async function renderSeries(id) {
  const box = $('#serbox'); if (!box || !online || !id) return;
  if (serC[id] === undefined) { serC[id] = null; try { serC[id] = await jf(`/api/series/${encodeURIComponent(id)}?name=${encodeURIComponent(names[id] || lib[id]?.name || '')}`); } catch { serC[id] = {total: 0, parts: [], dlcs: []}; } }
  const s = serC[id]; if (!s || curId() != id) return;
  const el = $('#serbox'); if (!el) return;
  const parts = s.parts || [], dlcs = s.dlcs || [];
  if (s.total < 2 && !dlcs.length) { el.innerHTML = ''; return; }
  for (const p of [...parts, ...dlcs]) rgInfo[p.id] = {...rgInfo[p.id], released: p.released, img: p.img};
  dlcs.forEach(p => { rgInfo[p.id] = {...rgInfo[p.id], dlc: true}; if (typeof nxMarkDlc === 'function') nxMarkDlc(p.id); });
  const head = (title, n, icn, full) => `<div class="row-h"><h2 class="sth2">${ic(icn, 18)} ${title}${n ? `<i class="cnt">${n}</i>` : ''}</h2><div class="ser-hacts">${full ? `<button class="fc sm" data-act="nx-series-full" data-id="${esc(id)}">${ic('max', 14)} На весь экран</button>` : ''}<div class="arrows"><button class="rb" data-car="-1" aria-label="Назад">${ic('chevL')}</button><button class="rb" data-car="1" aria-label="Вперёд">${ic('chevR')}</button></div></div></div>`;
  let html = '';
  if (s.total >= 2) {
    html += `<section class="row ser">${head('Серия игр', '', 'layers', true)}
    <p class="mut simbasis">Серия: ${esc(s.name)} (всего ${nParts(s.total)})</p>
    <div class="track">${parts.map((p, i) => card(p.id, p.name, p.img, esc(`${i + 1} · ${(p.released || '').slice(0, 4) || 'скоро'}`))).join('')}</div></section>`;
  }
  if (dlcs.length) {
    html += `<section class="row ser dlcrow">${head('Дополнения (DLC)', '', 'plus', true)}
    <p class="mut simbasis">Дополнения к игре: ${nDlc(dlcs.length)}. Это не части серии.</p>
    <div class="track">${dlcs.map(p => card(p.id, p.name, p.img, esc(`DLC${p.released ? ' · ' + p.released.slice(0, 4) : ''}`))).join('')}</div></section>`;
  }
  el.innerHTML = html;
  parts.forEach(p => { if (p.current) el.querySelector(`.gc[data-id="${CSS.escape(String(p.id))}"]`)?.classList.add('cur'); });
  const facts = $('#page .facts');                                     // и в сводке: «Серия: God of War (всего 8 частей)»
  if (facts && s.total >= 2 && !facts.querySelector('[data-ser]')) facts.insertAdjacentHTML('beforeend', `<div class="fr" data-ser><small>${ic('layers', 13)}Серия</small><div>${esc(s.name)} (всего ${nParts(s.total)})</div></div>`);
  if (facts && dlcs.length && !facts.querySelector('[data-dlc]')) facts.insertAdjacentHTML('beforeend', `<div class="fr" data-dlc><small>${ic('plus', 13)}Дополнения</small><div>${nDlc(dlcs.length)}</div></div>`);
  requestAnimationFrame(updRows);
}

// ===== описание всегда на русском =====
const trC = {};
async function trDesc(id) {
  const el = $('#gdesc'), d = info[id]; if (!el || !d || !online) return;
  const txt = dec(d.short_description || ''); if (txt.length < 30 || /[а-яё]/i.test(txt)) return;
  if (trC[id] === undefined) { trC[id] = null; try { const r = await jf('/api/translate', 'POST', {text: txt}); trC[id] = r.translated ? r.text : ''; } catch { trC[id] = ''; } }
  const e2 = $('#gdesc'); if (trC[id] && e2 && curId() == id) e2.textContent = trC[id];
}

// ===== режимы просмотра: плитка и список =====
const modeKey = k => 'nx.mode.' + k;
const getMode = k => { try { return localStorage.getItem(modeKey(k)) || 'grid'; } catch { return 'grid'; } };
const setMode = (k, v) => { try { localStorage.setItem(modeKey(k), v); } catch {} };
const modeSwitch = k => {
  const m = getMode(k);
  if (k === 'catalog') return `<div class="vmode" role="group" aria-label="Вид"><button class="${m === 'grid' ? 'on' : ''}" data-act="nx-mode" data-k="catalog" data-v="grid" title="Плитка" aria-label="Плитка" aria-pressed="${m === 'grid'}">${ic('grid', 16)}</button><button class="${m === 'coverflow' ? 'on' : ''}" data-act="nx-mode" data-k="catalog" data-v="coverflow" title="Карусель" aria-label="Карусель" aria-pressed="${m === 'coverflow'}">${ic('layers', 16)}</button></div>`;
  return `<div class="vmode" role="group" aria-label="Вид"><button class="${m === 'grid' ? 'on' : ''}" data-act="nx-mode" data-k="${k}" data-v="grid" title="Плитка" aria-label="Плитка" aria-pressed="${m === 'grid'}">${ic('grid', 16)}</button><button class="${m === 'list' ? 'on' : ''}" data-act="nx-mode" data-k="${k}" data-v="list" title="Список" aria-label="Список" aria-pressed="${m === 'list'}">${ic('list', 16)}</button></div>`;
};
// одна круглая кнопка в центральном поиске: переключает вид на следующий
const spotModeSwitch = k => {
  const m = getMode(k), cat = k === 'catalog';
  const next = cat ? (m === 'grid' ? 'coverflow' : 'grid') : (m === 'grid' ? 'list' : 'grid');
  const label = cat ? (m === 'grid' ? 'Показать каруселью' : 'Показать плиткой') : (m === 'grid' ? 'Показать списком' : 'Показать плиткой');
  const icon = m === 'grid' ? ic('grid', 18) : m === 'coverflow' ? ic('layers', 18) : ic('list', 18);
  return `<button type="button" class="spot-circle spot-mode" data-act="nx-mode" data-k="${k}" data-v="${next}" title="${label}" aria-label="${label}">${icon}</button>`;
};
// строка списка: обложка, название, время, платформа, оценка, прогресс
function listRow(id) {
  const g = lib[id]; if (!g) return '';
  const pr = progressOf(id), src = g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
  return `<a class="lrow" href="#game=${esc(id)}" data-id="${esc(id)}"><img src="${esc(src)}" alt="" loading="lazy" data-id="${esc(id)}" data-name="${esc(g.name)}">
    <span class="lt"><b>${esc(g.name)}</b>${typeof nxDlcBadge === 'function' ? nxDlcBadge(id, true) : ''}<span class="lm">${esc(STATUS[g.status] || '')}${g.installed ? `<span class="gm">${ic('monitor', 13)}На устройстве</span>` : ''}${g.hours ? `<span class="gm">${ic('clock', 13)}${esc(fmtHM(g.hours))}</span>` : ''}${g.playedOn?.length ? `<span class="gm pis">${platIcons(g.playedOn)}</span>` : ''}${g.rating ? `<span class="gm">${ic('star', 13)}${esc(g.rating)}</span>` : ''}</span></span>
    ${pr ? `<span class="lp" title="Прогресс ${pr.pct}%"><i style="width:${pr.pct}%"></i></span>` : ''}</a>`;
}
// сетка без пересборки: карточки переиспользуются, поэтому фильтры не мигают и не теряют прокрутку
function patchGrid(grid, items, sig) {
  if (grid.dataset.sig !== sig) { grid.innerHTML = ''; grid.dataset.sig = sig; }
  const old = new Map(); for (const el of [...grid.children]) old.set(el.dataset.id, el);
  const tpl = document.createElement('template'); let ref = grid.firstElementChild;
  for (const [id, n, im] of items) {
    let el = old.get(String(id));
    if (el) { old.delete(String(id)); const lab = el.querySelector('.gc-cat'); if (lab) { const h = labelOf(id); if (lab.innerHTML !== h) lab.innerHTML = h; } }
    else { tpl.innerHTML = card(id, n, im).trim(); el = tpl.content.firstElementChild; }
    if (el === ref) ref = ref.nextElementSibling; else grid.insertBefore(el, ref);
  }
  for (const el of old.values()) el.remove();
}
let rqf = 0; const renderSoon = () => { cancelAnimationFrame(rqf); rqf = requestAnimationFrame(render); };

// ===== любимые: карусель и «Показать все» =====
function favCarousel(favs) {
  if (!favs.length) return '<p class="mut">Нажмите на сердце на карточке игры в библиотеке или на странице игры: она появится здесь.</p>';
  const cnt = nParts(favs.length).replace('часть', 'игра').replace('части', 'игры').replace('частей', 'игр');
  // та же разметка, что у лент каталога (.sx-sec / .sx-track): стрелки, перетаскивание мышью и «Показать все»
  // шапка (счётчик и «Показать все») + лента карточек; sx.js превращает ленту в 3D-карусель, как «Карусель» в каталоге.
  // Если карусель не смонтировалась, остаётся обычная лента со стрелками.
  return `<section class="sx-sec favrow"><div class="row-h"><span class="mut simbasis">${cnt}</span><div class="sx-rr"><button class="sx-arr" data-dir="-1" aria-label="Назад">${ic('chevL', 16)}</button><button class="sx-arr" data-dir="1" aria-label="Вперёд">${ic('chevR', 16)}</button><button class="row-all" data-act="fav-all"><span>Показать все</span>${ic('chevR', 14)}</button></div></div>
    <div class="sx-track">${favs.map(([id, g]) => card(id, g.name, '', yearGenre(id) || STATUS[g.status])).join('')}</div></section>`;
}

// ===== стеклянные папки (адаптация Glass Folder Cards под сайт: тёмное стекло, без React и Tailwind) =====
const GF = {W: 340, H: 272, HEAD: 54, FRONT_TOP: 74, MAX: 4};
GF.FRONT_H = GF.H - GF.FRONT_TOP;
GF.BACK = 'M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z';
GF.FRONT = `M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 ${GF.FRONT_H - 22}A22 22 0 0 1 318 ${GF.FRONT_H}L22 ${GF.FRONT_H}A22 22 0 0 1 0 ${GF.FRONT_H - 22}Z`;
const GF_RECIPE = {style: 'marble', colors: ['#050505', '#161616', '#3a3a3a', '#0e0e0e', '#7a7a7a', '#cfcfcf', '#ffffff'], scale: 0.7, warp: 3.2, angle: -0.5, gloss: 0.5, veins: 0.5};   // монохром под стиль сайта
const gfHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const gfRng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function gfFbm(seed) {
  const r = gfRng(seed), perm = new Uint8Array(512), grad = new Float32Array(512), p = []; for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; grad[i * 2] = Math.cos(a); grad[i * 2 + 1] = Math.sin(a); }
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const h00 = perm[X + perm[Y]] * 2, h10 = perm[X + 1 + perm[Y]] * 2, h01 = perm[X + perm[Y + 1]] * 2, h11 = perm[X + 1 + perm[Y + 1]] * 2;
    const d00 = grad[h00] * xf + grad[h00 + 1] * yf, d10 = grad[h10] * (xf - 1) + grad[h10 + 1] * yf, d01 = grad[h01] * xf + grad[h01 + 1] * (yf - 1), d11 = grad[h11] * (xf - 1) + grad[h11 + 1] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    return d00 + u * (d10 - d00) + v * (d01 - d00 + u * (d11 - d01 - d10 + d00)); };
  return (x, y, oct) => { let sum = 0, amp = 0.5; for (let i = 0; i < oct; i++) { sum += amp * noise(x, y); const nx = 1.6 * x + 1.2 * y + 7.1; y = -1.2 * x + 1.6 * y + 3.3; x = nx; amp *= 0.5; } return sum; };
}
// рисунок на задней панели: «жидкая» поверхность из шума (то же, что в исходном компоненте), но чёрно-белая
function gfArt(w, h, seed) {
  const R = GF_RECIPE, stops = R.colors.map((c, i) => ({t: i / (R.colors.length - 1), c: parseInt(c.slice(1), 16)})), fbm = gfFbm(seed * 977 + 13), r = gfRng(seed + 1);
  const ox = r() * 50, oy = r() * 50, ang = R.angle + (r() - 0.5) * 0.5, ca = Math.cos(ang), sa = Math.sin(ang), m = Math.min(w, h), px = new Uint8ClampedArray(w * h * 4);
  const gw = Math.ceil(w / 2) + 3, gh = Math.ceil(h / 2) + 3, G = new Float32Array(gw * gh), F = new Float32Array(w * h); let row = 0;
  const field = gy => { for (let gx = 0; gx < gw; gx++) { const u = ((gx - 1) * 2 - w / 2) / m, v = ((gy - 1) * 2 - h / 2) / m; let x = (u * ca - v * sa) * R.scale + ox, y = (u * sa + v * ca) * R.scale + oy;
    const qx = fbm(x, y, 3), qy = fbm(x + 5.2, y + 1.3, 3), rx = fbm(x + R.warp * qx + 1.7, y + R.warp * qy + 9.2, 3), ry = fbm(x + R.warp * qx + 8.3, y + R.warp * qy + 2.8, 3); G[gy * gw + gx] = fbm(x + R.warp * rx, y + R.warp * ry, 4); } };
  const finish = () => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) F[y * w + x] = G[((y >> 1) + 1) * gw + (x >> 1) + 1];
    const s = []; for (let i = 0; i < F.length; i += Math.max(1, Math.floor(F.length / 4096))) s.push(F[i]); s.sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * 0.02)], k = 1 / ((s[Math.floor(s.length * 0.98)] - lo) || 1), slope = k * m * 0.012;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let t = (F[i] - lo) * k; t = t < 0 ? 0 : t > 1 ? 1 : t; let j = 1; while (j < stops.length - 1 && stops[j].t < t) j++;
      const a = stops[j - 1], b = stops[j]; let f = (t - a.t) / (b.t - a.t || 1); f = f < 0 ? 0 : f > 1 ? 1 : f; f = f * f * (3 - 2 * f);
      const gx = (F[x < w - 1 ? i + 1 : i] - F[x > 0 ? i - 1 : i]) * slope, gy = (F[y < h - 1 ? i + w : i] - F[y > 0 ? i - w : i]) * slope, nd = (0.55 * gx + 0.65 * gy + 0.52) / Math.sqrt(gx * gx + gy * gy + 1);
      const spec = Math.pow(nd > 0 ? nd : 0, 24) * R.gloss * 255, lit = 0.82 + 0.28 * nd, ch = k0 => ((a.c >> k0) & 255) + ((((b.c >> k0) & 255) - ((a.c >> k0) & 255)) * f);
      px[i * 4] = ch(16) * lit + spec; px[i * 4 + 1] = ch(8) * lit + spec; px[i * 4 + 2] = ch(0) * lit + spec; px[i * 4 + 3] = 255;
    }
  };
  return {w, h, px, step(n) { if (row >= gh) return true; const e = Math.min(gh, row + n); while (row < e) field(row++); if (row < gh) return false; finish(); return true; }};
}
// общая очередь: рисунки папок рисуются по кадрам, страница не подвисает
const gfCache = new Map(), gfQueue = []; let gfPump = false;
function gfPaint(canvas, seed) {
  const w = Math.round(canvas.dataset.w), h = Math.round(canvas.dataset.h), key = seed + ':' + w + 'x' + h;
  const done = src => { if (!canvas.isConnected) return; canvas.width = src.width; canvas.height = src.height; canvas.getContext('2d').drawImage(src, 0, 0); canvas.dataset.ready = '1'; };
  if (gfCache.has(key)) { const v = gfCache.get(key); return v instanceof HTMLCanvasElement ? done(v) : v.push(done); }
  const waiters = [done]; gfCache.set(key, waiters); gfQueue.push({job: gfArt(w, h, seed), key, waiters});
  if (!gfPump) { gfPump = true; const tick = () => { const until = performance.now() + 7; while (gfQueue.length && performance.now() < until) { const q = gfQueue[0]; if (q.job.step(4)) { gfQueue.shift(); const c = document.createElement('canvas'); c.width = q.job.w; c.height = q.job.h; c.getContext('2d').putImageData(new ImageData(q.job.px, q.job.w, q.job.h), 0, 0); gfCache.set(q.key, c); q.waiters.forEach(f => f(c)); } } if (gfQueue.length) requestAnimationFrame(tick); else gfPump = false; }; requestAnimationFrame(tick); }
}
function paintFolders(root = document) { root.querySelectorAll('canvas.gf-art:not([data-ready])').forEach(c => gfPaint(c, +c.dataset.seed)); }

// одна папка: задняя панель с рисунком, «файлы» (обложки игр), матовая передняя панель, кнопки «+» и «···»
function glassFolder(fid, o = {}) {
  const f = folders[fid]; if (!f) return '';
  const k = (o.width || 280) / GF.W, games = Object.entries(lib).filter(([, g]) => (g.folders || []).includes(fid)).sort((a, b) => String(b[1].added || '').localeCompare(String(a[1].added || ''))), n = games.length;
  const vis = games.slice(0, GF.MAX).reverse(), seed = gfHash(fid) % 997, hours = games.reduce((a, [, g]) => a + (+g.hours || 0), 0);
  const sheets = vis.map(([id, g], v) => { const slot = vis.length <= 1 ? 0 : (v / (vis.length - 1)) * 2 - 1, jr = gfRng(gfHash(id)), src = g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
    return `<a class="gf-sheet" href="#game=${esc(id)}" style="--gf-slot:${slot};--gf-depth:${vis.length - 1 - v};--gf-jx:${((jr() - .5) * 10).toFixed(2)}px;--gf-jr:${((jr() - .5) * 3.2).toFixed(2)}deg;z-index:${v + 1}" aria-label="${esc(g.name)}"><img class="gf-sheet-art" src="${esc(src)}" alt="" loading="lazy" draggable="false" data-id="${esc(id)}" data-name="${esc(g.name)}"><span class="gf-sheet-head"><span class="gf-sheet-name">${esc(g.name)}</span>${g.hours ? `<span class="gf-sheet-meta">${esc(fmtHM(g.hours))}</span>` : ''}</span></a>`; }).join('');
  return `<div class="gf-root" data-tone="dark" data-fid="${esc(fid)}" style="width:${o.width || 280}px;height:${(GF.H + GF.HEAD) * k}px" data-entered="1">
    <button type="button" class="gf-open" data-act="gf-toggle" tabindex="-1" aria-hidden="true"></button>
    <div class="gf-stage" style="transform:translateY(${GF.HEAD * k}px) scale(${k})"><div class="gf-tilt"><div class="gf-shadow" aria-hidden="true"></div>
      <div class="gf-back" style="clip-path:path('${GF.BACK}')" aria-hidden="true"><canvas class="gf-art" data-seed="${seed}" data-w="${Math.round((GF.W + 24) * k * Math.min(1.5, devicePixelRatio || 1))}" data-h="${Math.round((GF.H + 24) * k * Math.min(1.5, devicePixelRatio || 1))}" style="width:${GF.W + 24}px;height:${GF.H + 24}px"></canvas><div class="gf-back-sheen"></div></div>
      <svg class="gf-rim gf-back-rim" viewBox="0 0 ${GF.W} ${GF.H}" aria-hidden="true"><path d="${GF.BACK}"/></svg>
      <div class="gf-front" style="clip-path:path('${GF.FRONT}')"><div class="gf-tint" aria-hidden="true"></div><div class="gf-spec" aria-hidden="true"></div>
        <svg class="gf-rim gf-front-rim" viewBox="0 0 ${GF.W} ${GF.FRONT_H}" aria-hidden="true"><defs><linearGradient id="gfr-${esc(fid)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient></defs><path d="${GF.FRONT}" stroke="url(#gfr-${esc(fid)})"/></svg>
        <button type="button" class="gf-hit" data-act="gf-toggle" aria-expanded="false" aria-label="${esc(f.name)}: ${nParts(n).replace('частей', 'игр').replace('части', 'игры').replace('часть', 'игра')}"></button>
        <div class="gf-label"><span class="gf-title">${esc(f.name)}</span><span class="gf-meta">${n} ${plural(n, 'игра', 'игры', 'игр')}${hours ? ' · ' + esc(fmtHM(hours)) : ''}</span></div></div>
      <div class="gf-files" role="list" aria-label="Игры в папке «${esc(f.name)}»">${sheets}</div>
      <button type="button" class="gf-key gf-key--more" data-act="gf-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Действия с папкой «${esc(f.name)}»"><svg class="gf-glyph gf-glyph--more" viewBox="0 0 30 12" aria-hidden="true"><rect x="1" y="1.5" width="8" height="9" rx="3.4"/><rect x="11" y="1.5" width="8" height="9" rx="3.4"/><rect x="21" y="1.5" width="8" height="9" rx="3.4"/></svg></button>
      <button type="button" class="gf-key gf-key--add" data-act="gf-add" data-fid="${esc(fid)}" aria-label="Добавить игры в папку «${esc(f.name)}»"><svg class="gf-glyph gf-glyph--plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg></button>
      <div class="gf-menu" role="menu" aria-label="Действия с папкой"><button type="button" role="menuitem" class="gf-menu-item" data-act="open-folder" data-fid="${esc(fid)}" tabindex="-1">Открыть в библиотеке</button><button type="button" role="menuitem" class="gf-menu-item" data-act="gf-add" data-fid="${esc(fid)}" tabindex="-1">Добавить игры</button><button type="button" role="menuitem" class="gf-menu-item" data-act="folder-edit" data-fid="${esc(fid)}" tabindex="-1">Переименовать или удалить</button></div>
    </div></div></div>`;
}
function glassFolders(o = {}) {
  const ids = folderIds(), favN = Object.values(lib).filter(g => g.fav).length, f = state.lf.folder;
  return `<div class="gfbar">${o.chips === false ? '' : `<div class="gfchips"><button class="fc fd${f === '' ? ' on' : ''}" data-act="ffilter" data-v="">${ic('layers', 15)} Все игры <i>${Object.keys(lib).length}</i></button><button class="fc fd${f === 'fav' ? ' on' : ''}" data-act="ffilter" data-v="fav">${ic('heart', 15)} Любимые <i>${favN}</i></button></div>`}
    <div class="gf-row">${ids.map(id => `<div class="gf-cell${f === id ? ' cur' : ''}">${glassFolder(id, {width: o.width})}</div>`).join('')}<button class="gf-new" data-act="folder-new" style="height:${(GF.H + GF.HEAD) * ((o.width || 280) / GF.W)}px;width:${o.width || 280}px">${ic('plus', 22)}<span>Новая папка</span></button></div></div>`;
}
const gfClose = (except) => document.querySelectorAll('.gf-root[data-open]').forEach(r => { if (r !== except) { r.removeAttribute('data-open'); r.querySelector('.gf-hit')?.setAttribute('aria-expanded', 'false'); r.querySelector('.gf-files')?.setAttribute('inert', ''); } });
function gfSetOpen(root, open) {
  gfClose(open ? root : null); root.toggleAttribute('data-open', open); root.querySelector('.gf-hit').setAttribute('aria-expanded', open); root.querySelector('.gf-files').toggleAttribute('inert', !open);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.gf-menu[data-open]').forEach(m => m.removeAttribute('data-open')); gfClose(); } });
document.addEventListener('pointerdown', e => { if (!e.target.closest('.gf-menu, .gf-key--more')) document.querySelectorAll('.gf-menu[data-open]').forEach(m => m.removeAttribute('data-open')); if (!e.target.closest('.gf-root')) gfClose(); });

// «Добавить игры» в папку: список игр библиотеки с поиском и переключателями
let gfPick = '';
function openFolderPicker(fid) {
  if (!folders[fid]) return; gfPick = fid;
  mbox(`Игры в папке «${folders[fid].name}»`, `<div class="mform"><input id="gfp-q" class="tin" placeholder="Найти игру в библиотеке" autocomplete="off" aria-label="Поиск"><div class="aslist" id="gfp-list"></div></div>`, true);
  const draw = () => { const q = $('#gfp-q').value.trim(), rows = Object.entries(lib).map(([id, g]) => [id, g.name]), res = q ? NexusSearch.rank(q, rows.map(([id, n]) => ({id, name: n})), {get: r => r.name}).map(r => [r.id, r.name]) : rows.sort((a, b) => a[1].localeCompare(b[1], 'ru'));
    $('#gfp-list').innerHTML = res.slice(0, 80).map(([id, n]) => { const on = (lib[id].folders || []).includes(fid); return `<button class="asrow${on ? ' on' : ''}" data-act="gfp-toggle" data-id="${esc(id)}" aria-pressed="${on}"><img src="${esc(lib[id].cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png'))}" alt="" loading="lazy"><span>${esc(n)}</span>${on ? ic('check', 16) : ic('plus', 16)}</button>`; }).join('') || '<p class="mut">Ничего не найдено</p>'; };
  $('#gfp-q').oninput = draw; draw(); $('#gfp-q').focus();
}
// Прямой клик по папке: сразу открываем её игры в окне, не уводя в библиотеку
function openFolderView(fid) {
  const f = folders[fid]; if (!f) return;
  const games = Object.entries(lib).filter(([, g]) => (g.folders || []).includes(fid)).sort((a, b) => String(b[1].added || '').localeCompare(String(a[1].added || '')) || a[1].name.localeCompare(b[1].name, 'ru'));
  const body = games.length
    ? `<div class="grid fgrid2 modalgrid folder-grid">${games.map(([id, g]) => card(id, g.name, '', yearGenre(id) || STATUS[g.status])).join('')}</div>`
    : '<p class="mut folder-empty">В папке пока нет игр. Добавьте их кнопкой ниже.</p>';
  mbox(`Папка «${f.name}»`, `${body}<div class="sbtns folder-acts"><button class="ib wide" data-act="nx-folder-full" data-fid="${esc(fid)}">${ic('max', 16)} На весь экран</button><button class="ib wide" data-act="open-folder" data-fid="${esc(fid)}">${ic('layers', 16)} Открыть в библиотеке</button><button class="ib wide" data-act="gf-add" data-fid="${esc(fid)}">${ic('plus', 16)} Добавить игры</button></div>`, true);
}

// ===== настройки: ключ перевода, полный экран эмуляторов, мобильная версия =====
function nxMoreSettings(c) {
  const fs = c.launch ? c.launch.fullscreen !== false : true;
  return `<section class="scard"><h2>Эмуляторы и запуск</h2>
    <div class="srow"><div><b>Запускать игры в эмуляторах на весь экран</b><p class="mut">Образ открывается сразу в игре, без окна выбора.</p></div><button class="tg${fs ? ' on' : ''}" role="switch" aria-checked="${fs}" data-act="nx-fs" aria-label="Полный экран в эмуляторах"><i></i></button></div></section>
  <section class="scard" id="mobsec"><h2>Мобильная версия</h2><p class="mut sdesc">Откройте NEXUS на телефоне по постоянной ссылке из вашей домашней сети. Ссылка с секретным ключом: без него сайт не откроется. С телефона можно смотреть и править библиотеку; запуск игр, пути и ключи доступны только на компьютере.</p><div id="mobbox"><p class="mut">Загрузка…</p></div></section>`;
}
async function renderMobile() {
  const box = $('#mobbox'); if (!box) return; const m = await jf('/api/mobile').catch(() => null); if (!m || !$('#mobbox')) return;
  box.innerHTML = `<div class="srow"><div><b>Доступ с телефона по Wi-Fi</b><p class="mut">${m.enabled ? (m.active ? 'Включён' : 'Включён, перезапустите NEXUS, чтобы применить') : 'Выключен'}</p></div><button class="tg${m.enabled ? ' on' : ''}" role="switch" aria-checked="${m.enabled}" data-act="mob-toggle" aria-label="Доступ с телефона"><i></i></button></div>
  ${m.enabled && m.urls.length ? m.urls.map(u => `<div class="covctl mob"><input readonly value="${esc(u)}" aria-label="Ссылка для телефона" onfocus="this.select()"><button class="ib" data-act="mob-copy" data-u="${esc(u)}" title="Копировать" aria-label="Копировать">${ic('copy', 16)}</button></div>`).join('') + `<p class="hint l">Телефон и компьютер должны быть в одной сети (или в одной сети VPN). Откройте ссылку в браузере телефона и выберите «Добавить на главный экран»: появится ярлык NEXUS. Установка как полноценного приложения (PWA) на телефон требует защищённого адреса https, в домашней сети по http появится обычный ярлык.</p><div class="sbtns"><button class="ib wide" data-act="mob-token">${ic('refresh', 16)} Выпустить новую ссылку</button>${m.active ? '' : `<button class="ib wide" data-act="mob-restart">${ic('refresh', 16)} Перезапустить NEXUS</button>`}</div>` : (m.enabled ? '<p class="hint l">Сетевой адрес не найден: подключитесь к Wi-Fi.</p>' : '')}`;
}

// ===== действия =====
function nxAct2(act, b, e) {
  const A = {
    'nx-mode': () => { setMode(b.dataset.k, b.dataset.v); if (b.dataset.k === 'done') renderProfile(); else render(); },
    'fav-all': () => { const favs = Object.entries(lib).filter(([, g]) => g.fav).sort((a, c) => a[1].name.localeCompare(c[1].name, 'ru')); mbox(`Любимые игры (${favs.length})`, `<div class="grid fgrid2 modalgrid">${favs.map(([id, g]) => card(id, g.name, '', yearGenre(id) || STATUS[g.status])).join('')}</div>`, true); },
    'gf-toggle': () => { const r = b.closest('.gf-root'); if (r) openFolderView(r.dataset.fid); },
    'gf-menu': () => { const r = b.closest('.gf-root'), m = r.querySelector('.gf-menu'), on = !m.hasAttribute('data-open'); document.querySelectorAll('.gf-menu[data-open]').forEach(x => x.removeAttribute('data-open')); m.toggleAttribute('data-open', on); b.setAttribute('aria-expanded', on); m.querySelectorAll('[role=menuitem]').forEach(i => i.tabIndex = on ? 0 : -1); if (on) m.querySelector('[role=menuitem]').focus(); },
    'gf-add': () => { document.querySelectorAll('.gf-menu[data-open]').forEach(x => x.removeAttribute('data-open')); openFolderPicker(b.dataset.fid); },
    'gfp-toggle': () => { const g = lib[b.dataset.id]; if (!g) return; const a = g.folders || []; g.folders = a.includes(gfPick) ? a.filter(x => x !== gfPick) : [...a, gfPick]; push(b.dataset.id, {folders: g.folders}); b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); b.lastElementChild.outerHTML = b.classList.contains('on') ? ic('check', 16) : ic('plus', 16); afterLibChange(b.dataset.id); },
    'nx-fs': () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); jf('/api/config', 'PUT', {launch: {fullscreen: on}}).catch(() => toast('Не удалось сохранить')); },
    'mob-toggle': async () => { const on = !b.classList.contains('on'); await jf('/api/mobile', 'PUT', {enabled: on}); renderMobile(); toast(on ? 'Включено. Перезапустите NEXUS, чтобы применить' : 'Выключено. Перезапустите NEXUS'); },
    'mob-copy': async () => { try { await navigator.clipboard.writeText(b.dataset.u); toast('Ссылка скопирована'); } catch { toast('Выделите ссылку и скопируйте вручную'); } },
    'mob-token': async () => { if (!confirm('Старая ссылка перестанет работать. Продолжить?')) return; await jf('/api/mobile/token', 'POST'); renderMobile(); toast('Новая ссылка готова'); },
    'mob-restart': async () => { const r = await jf('/api/desktop/restart', 'POST').catch(() => ({})); if (!r.ok) toast('Закройте NEXUS через значок в трее и запустите снова'); }
  };
  const fn = A[act]; if (!fn) return false; fn(); return true;
}
// после отрисовки папок рисуем их задние панели
// Раньше paintFolders() вызывался на КАЖДОЕ изменение страницы (карточки, таймер «сейчас играет», тосты), это тормозило каталог.
// Теперь проверка откладывается на кадр и идёт только если на странице есть ещё не нарисованные папки.
{ let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; if (document.querySelector('canvas.gf-art:not([data-ready])')) paintFolders(); }); }).observe(document.body, {childList: true, subtree: true}); }
