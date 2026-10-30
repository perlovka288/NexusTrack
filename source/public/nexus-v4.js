'use strict';
// NEXUS v4: управление безрамочным окном, ручки изменения размера, цвет страницы игры.
(() => {
const root = document.documentElement, body = document.body;
const svg = d => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

// ---------- окно приложения (только в Electron: preload выдаёт window.nxWin) ----------
function windowShell() {
  const W = window.nxWin; if (!W) return;
  root.classList.add('nx-app');

  // Прокрутка теперь внутри панели окна, а не у документа: подставляем привычные scrollY / scrollTo / scrollHeight.
  const sc = body, fr = () => parseFloat(getComputedStyle(root).getPropertyValue('--fr')) || 0;
  try {
    Object.defineProperty(window, 'scrollY', {get: () => sc.scrollTop, configurable: true});
    Object.defineProperty(window, 'pageYOffset', {get: () => sc.scrollTop, configurable: true});
    Object.defineProperty(root, 'scrollHeight', {get: () => sc.scrollHeight + 2 * fr(), configurable: true});
    window.scrollTo = function (a, b) {
      if (a && typeof a === 'object') sc.scrollTo({top: a.top || 0, left: a.left || 0, behavior: a.behavior || 'auto'});
      else sc.scrollTo(a || 0, b || 0);
    };
    sc.addEventListener('scroll', () => window.dispatchEvent(new Event('scroll')), {passive: true});
  } catch (e) { console.warn('nx scroll', e); }

  // кнопки окна
  const wc = document.createElement('div'); wc.className = 'nx-wc';
  wc.innerHTML = `<button data-w="min" title="Свернуть" aria-label="Свернуть">${svg('<path d="M5 12h14"/>')}</button>` +
    `<button data-w="max" title="Развернуть" aria-label="Развернуть">${svg('<rect x="5" y="5" width="14" height="14" rx="3"/>')}</button>` +
    `<button data-w="close" class="x" title="Закрыть (свернуть в трей)" aria-label="Закрыть">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button>`;
  wc.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) W[b.dataset.w](); });
  body.append(wc);

  // ручки изменения размера по краям и углам
  for (const e of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const h = document.createElement('div'); h.className = 'nx-rz'; h.dataset.e = e; root.append(h); }  // вне панели: её обрезает скруглённая маска
  let act = null, raf = 0;
  document.addEventListener('pointerdown', ev => {
    const h = ev.target.closest && ev.target.closest('.nx-rz'); if (!h || ev.button) return;
    ev.preventDefault(); try { h.setPointerCapture(ev.pointerId); } catch {}
    act = h.dataset.e; W.rs();
  });
  document.addEventListener('pointermove', () => { if (!act || raf) return; raf = requestAnimationFrame(() => { raf = 0; if (act) W.rb(act); }); });
  const end = () => { if (act) { act = null; W.re(); } };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);

  // состояние «развёрнуто»
  const setMax = s => { root.classList.toggle('maxed', !!(s && s.max)); const b = wc.querySelector('[data-w="max"]'); if (b) b.title = s && s.max ? 'Восстановить' : 'Развернуть'; };
  W.onState(setMax); W.state().then(setMax).catch(() => {});
}

// ---------- цвет игры на её странице ----------
const GC_KEY = 'nx.gamecolor', gcOn = () => { try { return localStorage.getItem(GC_KEY) !== '0'; } catch { return true; } };
const hueOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function hsl2hex(h, s, l) {
  s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
const inkOf = hex => { const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return .299 * r + .587 * g + .114 * b > 160 ? '#000000' : '#ffffff'; };
const colorCache = new Map();
// v = {h, s} или {neutral: true}: для белых/серых обложек свет белый
function dominant(url, id) {
  const key = id || url; if (colorCache.has(key)) return Promise.resolve(colorCache.get(key));
  const fallback = () => { const v = {h: hueOf(id || url), s: 72}; colorCache.set(key, v); return v; };
  return new Promise(res => {
    if (!url) return res(fallback());
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onerror = () => res(fallback());
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 32, 32);
        const v = window.nxPickColor(x.getImageData(0, 0, 32, 32).data); colorCache.set(key, v); res(v);
      } catch { res(fallback()); }
    };
    im.src = url;
  });
}
let applied = '', ours = '';
function clearGC() {
  if (!applied) return; applied = '';
  const s = body.style; ['--acc', '--acc-ink', '--acc-soft', '--acc-glow'].forEach(p => s.removeProperty(p));
  if (ours && s.getPropertyValue('--hc') === ours) s.removeProperty('--hc');
  ours = ''; body.classList.remove('nx-gc', 'nx-white');
  // вернуть свечение текущего слайда главной
  const hs = ((document.querySelector('#sxHero .sx-slide.on') || {dataset: {}}).dataset.hs || '').split(',');
  if (hs[0] && !document.getElementById('sxHero').hidden) s.setProperty('--hc', `hsl(${hs[0]} ${hs[1]}% ${hs[2] || 52}%)`);
}
function applyGC(v, id) {
  // белая/серая обложка: белый свет и белый акцент; иначе цвет обложки
  const hex = v.neutral ? '#e9ebf2' : hsl2hex(v.h, Math.min(92, v.s + 6), 56), s = body.style;
  s.setProperty('--acc', hex); s.setProperty('--acc-ink', inkOf(hex)); s.setProperty('--acc-soft', hex + (v.neutral ? '26' : '33')); s.setProperty('--acc-glow', hex + (v.neutral ? '55' : '4d'));
  ours = v.neutral ? 'hsl(220 12% 90%)' : `hsl(${v.h} ${v.s}% 52%)`; s.setProperty('--hc', ours);
  body.classList.toggle('nx-white', !!v.neutral);
  body.classList.add('nx-gc'); applied = id;
}
async function checkGame(force) {
  const page = document.getElementById('page'), gp = page && !page.hidden && page.querySelector('.gp');
  if (!gp || !gcOn()) return clearGC();
  const id = gp.dataset.id; if (!force && applied === id) return;
  const img = gp.querySelector('.hero img.bg');
  const v = await dominant(img && img.src, id);
  // за время загрузки цвета пользователь мог уйти со страницы
  const still = document.getElementById('page'); if (still && !still.hidden && still.querySelector('.gp') && still.querySelector('.gp').dataset.id === id && gcOn()) applyGC(v, id); else clearGC();
}
function gameColor() {
  const page = document.getElementById('page'); if (!page) return;
  new MutationObserver(() => checkGame()).observe(page, {childList: true, attributes: true, attributeFilter: ['hidden']});
  addEventListener('hashchange', () => setTimeout(checkGame, 60));
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'nx-gamecolor') { try { localStorage.setItem(GC_KEY, e.target.checked ? '1' : '0'); } catch {} checkGame(true); }
  });
  checkGame();
}

windowShell();
gameColor();
})();
