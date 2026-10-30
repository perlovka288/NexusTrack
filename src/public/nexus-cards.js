'use strict';
// NEXUS: цвет обложки для карточек. Доминирующий оттенок считается один раз на URL
// (canvas 28×28), затем карточка получает --gc-accent и мягкое верхнее свечение.
(() => {
  const SELECTOR = '.gc,.sc,.cf-shot';
  const cache = new Map();
  const $ = (s, r = document) => r.querySelector(s);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hashHue = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  const inkOf = hex => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return .299 * r + .587 * g + .114 * b > 158 ? '#000000' : '#ffffff';
  };
  const fallback = id => {
    const h = hashHue(id || 'nexus');
    return hslHex(h, 66, 58);
  };
  function remember(url, hex) {
    if (!url) return;
    if (cache.size > 420) cache.delete(cache.keys().next().value);
    cache.set(url, hex);
  }

  // Доминирующий насыщенный оттенок: гистограмма по тону, чтобы закат не превращался
  // в случайный фиолетовый при усреднении оранжевого и синего.
  function extract(img) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const x = c.getContext('2d', {willReadFrequently: true});
      x.drawImage(img, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data;
      const B = 24, buckets = Array.from({length: B}, () => ({w: 0, r: 0, g: 0, b: 0}));
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 160) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = (mx - mn) / 255;
        if (!mx || dl < .12) continue;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum < .06 || lum > .96) continue;
        const rr = r / 255, gg = g / 255, bb = b / 255;
        let h = mx === r ? ((gg - bb) / dl) % 6 : mx === g ? (bb - rr) / dl + 2 : (rr - gg) / dl + 4;
        h = (h * 60 + 360) % 360;
        const q = buckets[(h / 15 | 0) % B];
        const w = (.2 + dl * dl * 1.8) * (.3 + Math.min(1, lum * 1.6));
        q.w += w; q.r += r * w; q.g += g * w; q.b += b * w;
      }
      let best = 0, bi = -1;
      buckets.forEach((q, i) => { if (q.w > best) { best = q.w; bi = i; } });
      if (bi < 0) return null;
      let W = 0, R = 0, G = 0, Bl = 0;              // соседние сектора сглаживают границы оттенков
      for (let o = -1; o <= 1; o++) { const q = buckets[(bi + o + B) % B]; W += q.w; R += q.r; G += q.g; Bl += q.b; }
      const r = R / W / 255, g = G / W / 255, b = Bl / W / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
      if (dl < .04) return null;
      let h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
      const sat = clamp(Math.round(dl / Math.max(.01, 1 - Math.abs(mx + mn - 1)) * 100), 50, 88);
      return hslHex(Math.round((h * 60 + 360) % 360), sat, 57);
    } catch { return null; }
  }

  // Steam CDN стабильно отдаёт CORS: помечаем такие картинки до загрузки, иначе canvas
  // «пачкается» и доминирующий цвет посчитать нельзя. Остальные хосты не трогаем —
  // часть CDN не присылает Access-Control-Allow-Origin, и картинка бы просто не загрузилась.
  const CORS_HOST = /(^|\.)(steamstatic\.com|akamaihd\.net)$/i;
  const needsCors = url => {
    try { const u = new URL(url, location.href); return u.origin !== location.origin && CORS_HOST.test(u.hostname); }
    catch { return false; }
  };

  function apply(el, force) {
    if (!el || el.nodeType !== 1) return;
    const img = $('img', el);
    const raw = img ? (img.getAttribute('src') || '') : '';
    if (img && raw && !img.crossOrigin && needsCors(raw) && !cache.has(raw)) {
      img.crossOrigin = 'anonymous';
      img.src = raw;                                 // перезагрузка с CORS; результат придёт в обработчике load
    }
    const url = img ? (img.currentSrc || raw) : '';
    const key = url || ('id:' + (el.dataset.id || ''));
    if (!force && el.dataset.nxAccentKey === key && el.dataset.nxAccentState === 'done') return;
    let hex = cache.get(key), state = 'done';
    if (!hex) {
      const loaded = !!(img && img.complete && img.naturalWidth);
      if (loaded) {
        hex = extract(img) || '';
        if (hex) remember(key, hex); else state = 'done';
      } else state = 'pending';
      if (!hex) hex = fallback(el.dataset.id || key);
    }
    el.style.setProperty('--gc-accent', hex);
    el.style.setProperty('--gc-accent-soft', hex + '3d');
    el.style.setProperty('--gc-accent-glow', hex + '66');
    el.style.setProperty('--gc-accent-ink', inkOf(hex));
    el.classList.add('has-color');
    el.dataset.nxAccentKey = key;
    el.dataset.nxAccentState = state;
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SELECTOR)) apply(root);
    if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(el => apply(el));
  }

  document.addEventListener('load', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const el = img.closest && img.closest(SELECTOR);
    if (el) apply(el, true);
  }, true);

  document.addEventListener('error', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const el = img.closest && img.closest(SELECTOR);
    if (el && !el.classList.contains('has-color')) apply(el, true);
  }, true);

  let queued = false;
  const added = new Set();
  function flush() {
    queued = false;
    added.forEach(n => { if (n.isConnected) scan(n); });
    added.clear();
  }
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) added.add(n);
    if (!added.size || queued) return;
    queued = true; requestAnimationFrame(flush);
  }).observe(document.body, {childList: true, subtree: true});

  const boot = () => { scan(document); requestAnimationFrame(() => scan(document)); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
  setTimeout(boot, 700);
})();
