'use strict';
// NEXUS v7 (объединённая версия): акцент из баннера (--accent-color) и цвет окна, стеклянная плашка прогресса,
// поиск-лупа на странице игры, выпадающее меню профиля. Без библиотек. Подключается последним.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // ===================== 1. Акцентный цвет из арт-баннера =====================
  const hsl2hex = (h, s, l) => {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const inkOf = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#000000' : '#ffffff'; };
  const hashHue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  // Картинка уменьшается на canvas до 32x32 (как 1x1, но без «грязного» среднего): пиксели раскладываются
  // по 24 корзинам оттенков с весом по насыщенности, берётся самая «весомая» корзина.
  function sampleAccent(img) {
    const S = 32, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d', {willReadFrequently: true});
    x.drawImage(img, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data, B = 24, bins = Array.from({length: B}, () => ({w: 0, r: 0, g: 0, b: 0}));
    let lum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
      lum += l; n++;
      if (dl < .08 || l < .14 || l > .9) continue;
      const s = dl / (1 - Math.abs(2 * l - 1)), h = (mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4) * 60;
      const w = s * s * (1 - Math.abs(l - .5)), k = Math.floor(((h + 360) % 360) / (360 / B)), bin = bins[k];
      bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
    }
    const top = bins.reduce((a, b) => b.w > a.w ? b : a, bins[0]);
    if (!n || top.w < 1.2) return {neutral: true};
    const r = top.r / top.w, g = top.g / top.w, b = top.b / top.w, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
    const h = (mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4) * 60;
    return {h: Math.round((h + 360) % 360), s: 74};
  }
  const accCache = new Map();
  const loadPx = url => new Promise((ok, bad) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onerror = bad; im.onload = () => { try { ok(sampleAccent(im)); } catch (e) { bad(e); } };
    im.src = url;
  });
  // баннеры с чужих хостов нельзя читать на canvas напрямую (CORS), поэтому сначала берём их через локальный /proxy
  async function accentFor(img, id) {
    const src = img.currentSrc || img.src, key = src || id, fb = {h: hashHue(id), s: 72};
    if (accCache.has(key)) return accCache.get(key);
    let v = fb;
    if (src) {
      const own = /^(data:|blob:)/.test(src) || src.startsWith(location.origin);
      const tries = own ? [src] : ['/proxy?url=' + encodeURIComponent(src), src];
      for (const u of tries) { try { v = await loadPx(u); break; } catch {} }
    }
    accCache.set(key, v); return v;
  }
  const GC_KEY = 'nx.gamecolor', gcOn = () => { try { return localStorage.getItem(GC_KEY) !== '0'; } catch { return true; } };
  let mine = null;      // {hex, neutral, hue} текущей страницы игры
  const vars = m => { const hex = m.hex; return {'--accent-color': hex, '--acc': hex, '--acc-ink': inkOf(hex), '--acc-soft': hex + (m.neutral ? '26' : '33'), '--acc-glow': hex + (m.neutral ? '55' : '4d'), '--hc': m.neutral ? 'hsl(220 12% 90%)' : `hsl(${m.hue} ${m.s}% 52%)`}; };
  function paintBody() {
    const pg = document.getElementById('page');
    if (!pg || pg.hidden || !pg.querySelector('.gp')) { mine = null; return; }
    if (!mine || !gcOn()) return; const b = document.body, st = b.style, v = vars(mine);
    if (st.getPropertyValue('--acc') === v['--acc'] && b.classList.contains('nx-gc')) return;
    for (const k in v) st.setProperty(k, v[k]);
    b.classList.toggle('nx-white', !!mine.neutral); b.classList.add('nx-gc');
  }
  function paintAccent(gp, v) {
    mine = {hex: v.neutral ? '#e9ebf2' : hsl2hex(v.h, Math.min(90, v.s + 8), 57), neutral: !!v.neutral, hue: v.h, s: v.s};
    const st = gp.style, vs = vars(mine);
    for (const k in vs) if (k !== '--hc') st.setProperty(k, vs[k]);
    gp.dataset.accent = mine.hex;
    paintBody();
  }
  let token = 0;
  async function applyAccent() {
    const page = document.getElementById('page'), gp = page && !page.hidden && page.querySelector('.gp');
    if (!gp) { mine = null; return; }
    const img = gp.querySelector('.hero img.bg'); if (!img) return;
    const my = ++token, id = gp.dataset.id || '';
    const v = await accentFor(img, id);
    if (my === token && gp.isConnected) paintAccent(gp, v);
  }
  // штатный слой v4 красит окно по хэшу, если не смог прочитать картинку: возвращаем реальный цвет баннера
  new MutationObserver(() => paintBody()).observe(document.body, {attributes: true, attributeFilter: ['style', 'class']});
  const pageEl = document.getElementById('page');
  if (pageEl) new MutationObserver(() => applyAccent()).observe(pageEl, {childList: true, attributes: true, attributeFilter: ['hidden']});
  // у баннера запасной источник подменяется при ошибке загрузки; load не всплывает, ловим в фазе захвата
  document.addEventListener('load', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.matches && t.matches('.gp .hero img.bg')) applyAccent(); }, true);
  applyAccent();

  // ===================== 2. Плашка прогресса =====================
  window.progressHtml = function (id) {
    const g = lib[id]; if (!g) return '';
    const p = progressOf(id), pct = p ? p.pct : 0;
    const tail = `${p && p.source === 'manual' ? '<button type="button" class="gp-auto" data-act="prog-auto" title="Определять автоматически">Авто</button>' : ''}<button type="button" class="gp-ref" data-act="prog-refresh" title="Обновить прогресс" aria-label="Обновить прогресс">${ic('refresh', 14)}</button>`;
    return `<div class="gprog${p ? '' : ' is-empty'}">
      <div class="gprog-h"><div class="gprog-pct"><span class="gprog-num">${p ? p.pct : '—'}</span>${p ? '<span class="gprog-sign">%</span>' : ''}</div>
        <span class="gprog-src">${E(p ? progLabel(p) : 'Отметьте прогресс вручную или включите достижения')}</span></div>
      <input type="range" min="0" max="100" step="1" value="${pct}" style="--p:${pct}%" data-prog="${E(id)}" aria-label="Прогресс прохождения">
      <div class="gprog-pills" role="group" aria-label="Быстрый выбор прогресса">${[0, 25, 50, 75, 100].map(n => `<button type="button" data-act="prog-set" data-v="${n}"${p && p.pct === n ? ' class="on"' : ''}>${n}%</button>`).join('')}<span class="gp-tail">${tail}</span></div>
    </div>`;
  };
  // ползунок: число, заливка и активная таблетка меняются сразу, сохранение делает основной обработчик
  document.addEventListener('input', e => {
    const rg = e.target.closest && e.target.closest('.gprog input[data-prog]'); if (!rg) return;
    const box = rg.closest('.gprog'), v = +rg.value;
    rg.style.setProperty('--p', v + '%');
    const num = box.querySelector('.gprog-num'); if (num) num.textContent = v;
    box.classList.remove('is-empty');
    box.querySelectorAll('.gprog-pills [data-v]').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  });

  // ===================== 2b. Поиск по странице игры: лупа -> раскрывается =====================
  const sOpen = box => { box.classList.add('open'); setTimeout(() => { const q = box.querySelector('#gp-q'); if (q) q.focus(); }, 80); };
  const sShut = box => { const q = box.querySelector('#gp-q'); if (q && q.value) return; box.classList.remove('open'); };
  document.addEventListener('click', e => {
    const box = e.target.closest && e.target.closest('.gp-search');
    if (box && !box.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); sOpen(box); return; }
    document.querySelectorAll('.gp-search.open').forEach(b => { if (b !== box) sShut(b); });
  }, true);
  document.addEventListener('focusout', e => {
    const box = e.target.closest && e.target.closest('.gp-search'); if (!box) return;
    setTimeout(() => { if (!box.contains(document.activeElement)) sShut(box); }, 140);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return; const box = e.target.closest && e.target.closest('.gp-search'); if (!box || !box.classList.contains('open')) return;
    const c = box.querySelector('.gps-clear'); if (c) c.click(); box.classList.remove('open'); if (e.target.blur) e.target.blur();
  }, true);
})();

// ===================== 3. Меню профиля (Профиль / Библиотека / Настройки / Выйти) =====================
(function () {
  const $ = s => document.querySelector(s);
  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    lib: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".55"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  let menu = null, anchor = null, askOut = 0, admShown = false;

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'nx7-menu'; menu.id = 'nx7-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Меню профиля'); menu.hidden = true;
    document.body.appendChild(menu);
    menu.addEventListener('click', onMenuClick);
    menu.addEventListener('keydown', onMenuKey);
    return menu;
  }

  function view() { try { return state.view; } catch { return ''; } }     // state объявлен в app.js

  function fill() {
    let p = {}; try { p = profile || {}; } catch {}
    const name = p.name || 'Профиль';
    const ini = String(p.name || '').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
    const av = p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : (ini ? esc(ini) : svg('user'));
    const v = view();
    const it = (act, ico, t, cls = '') => `<button class="nx7-it ${cls}${v === act ? ' cur' : ''}" role="menuitem" data-nx7="${act}" tabindex="-1">${svg(ico)}<span>${t}</span></button>`;
    admShown = !!(window.nxAdminUI && window.nxAdminUI.visible());   // пункт виден только если логин профиля есть в списке админов
    menu.innerHTML = `<div class="nx7-mh"><span class="nx7-av">${av}</span><div class="nx7-who"><b>${esc(name)}</b><span>Локальный профиль</span></div></div>`
      + it('profile', 'user', 'Профиль') + it('library', 'lib', 'Библиотека') + (admShown ? it('admin', 'shield', 'Админ-панель') : '') + it('settings', 'gear', 'Настройки')
      + '<div class="nx7-sep" role="separator"></div>' + it('quit', 'out', 'Выйти', 'out');
    askOut = 0;
  }

  function place() {
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect(), W = menu.offsetWidth, H = menu.offsetHeight, vw = innerWidth, vh = innerHeight, gap = 10;
    let x, y, ox;
    if (vw > 900 && r.left < vw / 3 && r.right + gap + W <= vw - 8) {   // боковая панель: меню справа от кнопки
      x = r.right + gap; y = Math.min(Math.max(8, r.top + r.height / 2 - 28), vh - H - 8); ox = '0 28px';
    } else if (r.top < vh / 2) {                                      // верхняя панель: под кнопкой, по её правому краю
      x = Math.min(Math.max(8, r.right - W), vw - W - 8); y = r.bottom + gap; ox = '100% 0';
    } else {                                                          // нижняя панель: над кнопкой
      x = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), vw - W - 8); y = r.top - H - gap; ox = '50% 100%';
    }
    menu.style.left = Math.round(x) + 'px'; menu.style.top = Math.round(Math.max(8, y)) + 'px'; menu.style.setProperty('--nx7-ox', ox);
  }

  function open(btn) {
    ensureMenu(); anchor = btn; fill(); menu.hidden = false; place();
    requestAnimationFrame(() => menu.classList.add('on'));
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', 'nx7-menu');
    const cur = menu.querySelector('.cur') || menu.querySelector('.nx7-it'); cur && cur.focus({preventScroll: true});
    if (window.nxAdminUI) window.nxAdminUI.check().then(ok => {      // логин мог измениться: перепроверяем и при необходимости перерисовываем меню
      if (ok === admShown || !menu || menu.hidden || anchor !== btn) return;
      fill(); place(); const c = menu.querySelector('.cur') || menu.querySelector('.nx7-it'); c && c.focus({preventScroll: true});
    }).catch(() => {});
  }
  function close(restore) {
    if (!menu || menu.hidden) return;
    menu.classList.remove('on');
    const b = anchor; anchor = null;
    setTimeout(() => { if (!menu.classList.contains('on')) menu.hidden = true; }, 180);
    // nav() перерисовывает кнопку, поэтому ищем актуальную
    const cur = document.querySelector('#nav .nl.prof'); if (cur) cur.setAttribute('aria-expanded', 'false');
    if (b && b.isConnected) b.setAttribute('aria-expanded', 'false');
    if (restore && cur) cur.focus({preventScroll: true});
  }

  async function quitApp(btn) {
    if (!askOut) {                                                    // двухшаговое подтверждение без модального окна
      askOut = 1; btn.classList.add('ask'); btn.querySelector('span').textContent = 'Точно выйти?';
      setTimeout(() => { if (askOut && btn.isConnected) { askOut = 0; btn.classList.remove('ask'); btn.querySelector('span').textContent = 'Выйти'; } }, 3500);
      return;
    }
    close();
    try {
      const r = await fetch('/api/desktop/quit', {method: 'POST'});
      const j = await r.json().catch(() => ({}));
      if (j && j.ok) return;
    } catch {}
    try { window.close(); } catch {}                                  // запуск в браузере: закрываем вкладку или подсказываем
    try { toast('Приложение работает в браузере: закройте эту вкладку'); } catch {}
  }

  function onMenuClick(e) {
    const b = e.target.closest('[data-nx7]'); if (!b) return;
    const a = b.dataset.nx7;
    if (a === 'quit') return quitApp(b);
    if (a === 'admin') { close(); if (window.nxAdminUI) window.nxAdminUI.open(); return; }
    close();
    if (typeof goView === 'function') goView(a);
  }
  function onMenuKey(e) {
    const items = [...menu.querySelectorAll('.nx7-it')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') close();
  }

  function initMenu() {
    // capture: перехватываем клик раньше, чем #nav.onclick откроет «Профиль» напрямую
    document.addEventListener('click', e => {
      const prof = e.target.closest && e.target.closest('#nav .nl.prof');
      if (prof) {
        e.preventDefault(); e.stopPropagation();
        if (menu && !menu.hidden && menu.classList.contains('on')) close(); else open(prof);
        return;
      }
      if (menu && !menu.hidden && !e.target.closest('#nx7-menu')) close();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu && !menu.hidden) { e.preventDefault(); close(true); } });
    addEventListener('resize', () => { if (menu && !menu.hidden) { const cur = document.querySelector('#nav .nl.prof'); if (cur) { anchor = cur; place(); } } });
    addEventListener('scroll', () => close(), true);
    // подпись кнопки в боковой панели обновляется вместе с nav(): держим aria актуальными
    const nav = $('#nav');
    if (nav) new MutationObserver(() => {
      const b = nav.querySelector('.nl.prof'); if (!b) return;
      b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-controls', 'nx7-menu');
      b.setAttribute('aria-expanded', menu && !menu.hidden && menu.classList.contains('on') ? 'true' : 'false');
      if (anchor) anchor = b;
    }).observe(nav, {childList: true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMenu); else initMenu();
})();
