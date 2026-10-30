'use strict';
// NEXUS · оболочка «игровая платформа»: сайдбар, верхняя панель, hero-карусель, витрина карточками.
(() => {
const ST = {key: '', i: 0, n: 0, t: null, home: false};
const svg = (d, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const DICE = '<rect width="18" height="18" x="3" y="3" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/>';
// Определение цвета обложки по пикселям. Если картинка почти бесцветная (белая, серая, чёрно-белая, как Ведьмак или Бэтмен),
// свет делаем белым. Порог NEUTRAL_AT: доля «цветных» пикселей, ниже которой обложка считается белой/серой.
const NEUTRAL_AT = .26;
window.nxPickColor = function (d) {
  let r = 0, g = 0, b = 0, w = 0, col = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue; n++;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), sat = mx ? (mx - mn) / mx : 0;
    if (sat > .42 && mx > 80) col++;
    const wt = sat * sat * (mx / 255) + .01; r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
  }
  if (!n || col / n < NEUTRAL_AT) return {neutral: true};
  r /= w; g /= w; b /= w;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, dl = mx - mn; if (dl < .05) return {neutral: true};
  const h = mx === r / 255 ? ((g - b) / 255 / dl) % 6 : mx === g / 255 ? (b - r) / 255 / dl + 2 : (r - g) / 255 / dl + 4;
  return {h: Math.round((h * 60 + 360) % 360), s: Math.round(Math.min(92, Math.max(58, dl / (1 - Math.abs(mx + mn - 1)) * 100)))};
};
const WHITE = {h: 220, s: 12, l: 90};
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const wide = (id, g) => isSteam(id) ? [CDN + id + '/library_hero.jpg', CDN + id + '/header.jpg'] : [];
const cover = (id, it) => lib[id]?.cover || it?.img || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');

// ---------- каркас: верхняя панель, карточка «добавить» ----------
function shell() {
  const top = document.querySelector('.top'), s = top.querySelector('.search');
  const bar = document.createElement('div'); bar.className = 'sx-bar';
  bar.append(s); bar.insertAdjacentHTML('beforeend', '<span class="sx-sp"></span>');
  const acts = document.querySelector('.spot-actions'); if (acts) bar.append(acts);
  bar.insertAdjacentHTML('beforeend', `<button class="sx-ib" data-sx="rand" title="Случайная игра" aria-label="Случайная игра">${svg(DICE, 17)}</button>`);
  document.body.prepend(bar);
  bar.addEventListener('click', e => {
    if (!e.target.closest('[data-sx="rand"]')) return;
    const ids = Object.keys(lib).length ? Object.keys(lib) : FEATURED.map(f => f[0]);
    if (ids.length) location.hash = '#game=' + ids[Math.floor(Math.random() * ids.length)];
  });
  const h = document.createElement('div'); h.id = 'sxHero'; h.hidden = true;
  document.querySelector('main').prepend(h);
  const sec = document.createElement('div'); sec.id = 'sxHome'; document.getElementById('rows').after(sec);
  h.addEventListener('click', onHero); trackEvents();
}

// ---------- данные для hero ----------
function heroItems() {
  const v = state.view;
  if (v === 'library' && !state.lf.folder && state.lf.status === 'all' && !state.lq?.trim()) {
    const rank = g => (g.status === 'playing' ? 2e15 : 0) + Date.parse(g.last || g.lastPlayed || g.added || 0 || '') || 0;
    return Object.entries(lib).sort((a, b) => rank(b[1]) - rank(a[1])).slice(0, 6).map(([id, g]) => ({id, name: g.name || names[id] || id, inLib: true}));
  }
  if (v === 'catalog' && catHome()) {
    let src = (showcase?.popular?.length ? showcase.popular : FEATURED.slice(0, 8).map(([id, name]) => ({id, name}))).slice(0, 14);
    // окно из 6 игр сдвигается каждые 6 часов (тот же сигнал, что у подборок)
    { const sh = (typeof hash32 === 'function' ? hash32(daySig()) : 0) % Math.max(1, src.length); src = src.slice(sh).concat(src.slice(0, sh)).slice(0, 6); }
    return src.map(it => ({id: String(it.id), name: it.name, img: it.img, year: it.year, genres: it.genres, rating: it.rating, inLib: !!lib[it.id]}));
  }
  return [];
}
function slideHtml(it, k, all) {
  const id = it.id, g = lib[id], m = rmeta[id] || {}, w = wide(id);
  const gen = (g?.genres || m.genres || it.genres || []).slice(0, 4).map(genreRu);
  const p = typeof progressOf === 'function' ? progressOf(id) : null, hrs = g && fmtHM(g.hours);
  const txt = g ? [STATUS[g.status], hrs ? 'Играно: ' + hrs : '', g.rating ? 'Оценка ' + g.rating : ''].filter(Boolean).join(' · ') : [it.year, gen.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
  const note = g?.note ? esc(g.note.slice(0, 160)) : (info[id]?.short_description ? esc(dec(info[id].short_description).slice(0, 180)) : '');
  const plat = g ? platIcons(g.playedOn) : '';
  const nxt = [1, 2].map(d => all[(k + d) % all.length]).filter((x, j, a) => x && x.id !== id && a.findIndex(y => y.id === x.id) === j);
  return `<div class="sx-slide${k === ST.i ? ' on' : ''}" data-k="${k}" data-id="${esc(id)}" data-n="${esc(it.name)}" aria-hidden="${k !== ST.i}">
  <div class="sx-stage${w.length ? '' : ' cov'}">
    <img class="bg" alt="" data-w="${esc(w.join('|'))}" data-c="${esc(cover(id, it))}" ${k === ST.i ? 'data-now="1"' : ''}>
    <img class="sx-poster" alt="" src="${esc(cover(id, it))}"><div class="sx-chips">${gen.map(x => `<span class="sx-chip">${esc(x)}</span>`).join('')}<a class="sx-chip ico" href="#game=${esc(id)}" aria-label="Открыть">${ic('upr', 14)}</a></div>
    ${isSteam(id) ? `<img class="sx-logo" alt="" src="${CDN}${id}/logo.png" onload="this.parentNode.classList.add('hl')" onerror="this.remove()">` : ''}<div class="sx-bigt">${esc(it.name)}</div>
    <div class="sx-meta">${hrs ? `<span>${ic('clock', 13)}${esc(hrs)}</span>` : ''}${g?.rating ? `<span>${icf('star', 13)}${esc(g.rating)}</span>` : ''}${!g && it.rating ? `<span>${icf('star', 13)}${(+it.rating).toFixed(1)}</span>` : ''}</div>
  </div>
  <div class="sx-side"><div class="sx-info"><h3>${esc(it.name)}</h3><p data-desc>${note}</p>${p ? `<div class="sx-prog" title="Прогресс ${p.pct}%"><i style="width:${p.pct}%"></i></div>` : ''}<div class="sx-st">${esc(txt)}</div>
    <div class="sx-act"><button class="sx-btn" data-go="${g ? 'play' : 'open'}">${g ? 'Играть' : 'Открыть'}<span>${plat || ic('monitor', 16)}</span></button>${g ? `<button class="sx-btn sec" data-go="open" aria-label="Страница игры">${ic('upr', 15)}</button>` : `<button class="sx-btn sec" data-go="add" aria-label="В библиотеку">${svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/><path d="M12 7v6M9 10h6"/>', 18)}</button>`}</div></div>
    <div class="sx-thumbs">${nxt.map(x => `<button data-jump="${all.findIndex(y => y.id === x.id)}" aria-label="${esc(x.name)}"><img alt="" loading="lazy" src="${esc(isSteam(x.id) ? CDN + x.id + '/header.jpg' : cover(x.id, x))}"></button>`).join('')}</div></div></div>`;
}

// ---------- цвет под игру ----------
function tint(slide, forceUrl) {
  if (slide.dataset.tint && !forceUrl) return; slide.dataset.tint = '1';
  const id = slide.dataset.id, apply = (h, s, neutral) => {
    let c1, c2, bodyC, hs;
    if (neutral) { c1 = `hsl(${WHITE.h} ${WHITE.s}% ${WHITE.l - 8}%)`; c2 = `hsl(${WHITE.h} 8% 15%)`; bodyC = `hsl(${WHITE.h} ${WHITE.s}% ${WHITE.l}%)`; hs = `${WHITE.h},${WHITE.s},${WHITE.l}`; slide.dataset.neutral = '1'; }
    else { s = Math.max(s, 85); c1 = `hsl(${h} ${Math.min(100, s + 8)}% 52%)`; c2 = `hsl(${h} ${Math.round(s * .75)}% 11%)`; bodyC = `hsl(${h} ${s}% 52%)`; hs = `${h},${s},52`; delete slide.dataset.neutral; }
    slide.style.setProperty('--hc1', c1); slide.style.setProperty('--hc2', c2); slide.dataset.hs = hs;
    if (slide.classList.contains('on') && !document.body.classList.contains('nx-gc')) document.body.style.setProperty('--hc', bodyC);
  };
  apply(hue(id), 70);
  const url = forceUrl || (slide.querySelector('img.bg')?.dataset.w || '').split('|')[0] || slide.querySelector('img.bg')?.dataset.c; if (!url) return;
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => { try {
    const c = document.createElement('canvas'); c.width = c.height = 20; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 20, 20); const d = x.getImageData(0, 0, 20, 20).data;
    const v = window.nxPickColor(d); if (v.neutral) apply(0, 0, true); else apply(v.h, v.s, false);
  } catch {} };
  im.src = url;
}

// ---------- показ слайда ----------
function loadImg(slide) {
  const im = slide.querySelector('img.bg'); if (!im || im.dataset.ld) return; im.dataset.ld = '1';
  const list = [...(im.dataset.w || '').split('|').filter(Boolean), im.dataset.c];
  const next = () => { const u = list.shift(); if (!u) return; im.onerror = () => { if (list.length) { if (list.length === 1) im.closest('.sx-stage').classList.add('cov'); next(); } }; im.src = u; };
  next(); tint(slide);
  if (!(im.dataset.w || '') && online) {
    const id = slide.dataset.id, nm = slide.dataset.n, st = im.closest('.sx-stage');
    jf(`/api/hero?id=${encodeURIComponent(id)}&name=${encodeURIComponent(nm)}`).then(r => {
      if (!r || !r.url) return; const t = new Image();
      t.onload = () => { im.src = r.url; st.classList.remove('cov'); tint(slide, r.url); };
      t.src = r.url;
    }).catch(() => {});
  }
}
function show(i) {
  const sl = document.querySelectorAll('#sxHero .sx-slide'); if (!sl.length) return;
  ST.i = (i + sl.length) % sl.length;
  sl.forEach((s, k) => { const on = k === ST.i; s.classList.toggle('on', on); s.setAttribute('aria-hidden', !on); if (on || k === (ST.i + 1) % sl.length) loadImg(s); });
  const cur = sl[ST.i], hs = (cur.dataset.hs || '').split(','); if (hs[0] && !document.body.classList.contains('nx-gc')) document.body.style.setProperty('--hc', `hsl(${hs[0]} ${hs[1]}% ${hs[2] || 52}%)`);
  document.querySelectorAll('#sxHero .sx-dots button').forEach((d, k) => d.classList.toggle('on', k === ST.i));
}
function play() { clearInterval(ST.t); if (matchMedia('(prefers-reduced-motion:reduce)').matches || ST.n < 2) return; ST.t = setInterval(() => { if (!document.hidden && !document.getElementById('sxHero').hidden && !document.body.classList.contains('nx-gc') && !document.getElementById('sxHero').matches(':hover')) show(ST.i + 1); }, 8000); }
function onHero(e) {
  const j = e.target.closest('[data-jump]'); if (j) { show(+j.dataset.jump); return play(); }
  const d = e.target.closest('[data-dot]'); if (d) { show(+d.dataset.dot); return play(); }
  const b = e.target.closest('[data-go]'); if (!b) return;
  const sl = b.closest('.sx-slide'), id = sl.dataset.id, name = sl.dataset.n, go = b.dataset.go;
  if (go === 'open') location.hash = '#game=' + id;
  else if (go === 'add') { addToLib(id, name, cover(id)); push(id, null); toast(`«${name}» добавлена в библиотеку`); nav(); stats(); render(); }
  else if (go === 'play') {
    b.disabled = true;
    jf('/api/launch/' + encodeURIComponent(id), 'POST').then(r => { toast(r.ok ? `Запускаю «${name}»` : (r.message || 'Не удалось запустить')); if (!r.ok) location.hash = '#game=' + id; }).catch(() => { location.hash = '#game=' + id; }).finally(() => setTimeout(() => b.disabled = false, 1500));
  }
}
function paintHero() {
  const box = document.getElementById('sxHero'), items = heroItems();
  document.body.classList.toggle('has-hero', items.length > 0);
  if (!items.length) { box.hidden = true; clearInterval(ST.t); ST.key = ''; document.body.style.removeProperty('--hc'); return; }
  const key = state.view + '|' + items.map(x => x.id + (x.inLib ? 1 : 0) + (lib[x.id]?.status || '') + (lib[x.id]?.hours || '')).join(',');
  box.hidden = false; if (key === ST.key) return;
  const same = ST.key.split('|')[0] === state.view; ST.key = key; ST.n = items.length; if (!same) ST.i = 0; if (ST.i >= ST.n) ST.i = 0;
  box.innerHTML = items.map((it, k) => slideHtml(it, k, items)).join('') + `<div class="sx-dots">${items.map((_, k) => `<button data-dot="${k}" class="${k === ST.i ? 'on' : ''}" aria-label="Слайд ${k + 1}"></button>`).join('')}</div>`;
  show(ST.i); play();
  if (online || true) items.forEach(it => { if (isSteam(it.id) && !lib[it.id]?.note && !info[it.id]) details(it.id).then(d => { const sd = d?.short_description; const el = box.querySelector(`.sx-slide[data-id="${it.id}"] [data-desc]`); if (sd && el) el.textContent = dec(sd).slice(0, 180); }); });
}

// ---------- витрина каталога: ленты с прокруткой, первая карточка широкая ----------
function paintHome() {
  const host = document.getElementById('sxHome'), home = state.view === 'catalog' && catHome();
  document.getElementById('showcase').hidden = true;
  if (!home) { host.innerHTML = ''; host.dataset.sig = ''; return; }
  document.getElementById('rows').hidden = true;
  const blocks = [];
  if (showcase?.popular?.length) blocks.push(['Популярное', 'popular', null, showcase.popular.map(x => [String(x.id), x.name, x.img])]);
  if (showcase?.fresh?.length) blocks.push(['Новинки', 'fresh', null, showcase.fresh.map(x => [String(x.id), x.name, x.img])]);
  DAILY_ROWS.forEach(([t, ids], ri) => blocks.push([t, 'row', ri, ids.map(id => [id, NAME.get(id), (typeof NX_IMG !== 'undefined' && NX_IMG[id]) || null])]));
  const sig = blocks.map(b => b[0] + b[3].length + (b[3][0] ? b[3][0][0] : '')).join() + Object.keys(lib).length;
  if (host.dataset.sig === sig) return; host.dataset.sig = sig;
  const row = its => {
    its = its.slice(0, 18); const wi = its.findIndex(x => isSteam(x[0])); if (wi > 0) its.unshift(its.splice(wi, 1)[0]);
    return its.map(([id, n, im], k) => { let h = card(id, n, im); if (k === 0 && isSteam(id)) h = h.replace('class="gc', 'class="gc sx-wide').replace('library_600x900.jpg', 'library_hero.jpg'); return h; }).join('');
  };
  host.innerHTML = blocks.map(([t, key, ri, its]) => `<section class="sx-sec"><div class="row-h"><h2>${esc(t)}</h2><div class="sx-rr"><button class="sx-arr" data-dir="-1" aria-label="Назад">${ic('chevL', 16)}</button><button class="sx-arr" data-dir="1" aria-label="Вперёд">${ic('chevR', 16)}</button><button class="row-all" data-showall="${key}"${ri != null ? ` data-row="${ri}"` : ''}><span>Показать все</span>${ic('chevR', 14)}</button></div></div><div class="sx-track">${row(its)}</div></section>`).join('');
}
function trackEvents() {
  // ленты с прокруткой есть и в каталоге (#sxHome), и в профиле («Любимые игры», #profileBox)
  const hosts = ['sxHome', 'profileBox'].map(id => document.getElementById(id)).filter(Boolean); let d = null, moved = 0;
  hosts.forEach(host => {
    host.addEventListener('click', e => {
      const a = e.target.closest('.sx-arr'); if (!a) return;
      const tr = a.closest('.sx-sec').querySelector('.sx-track'); tr.scrollBy({left: a.dataset.dir * tr.clientWidth * .8, behavior: 'smooth'});
    });
    host.addEventListener('pointerdown', e => { const tr = e.target.closest('.sx-track'); if (!tr || e.pointerType !== 'mouse' || e.button) return; d = {tr, x: e.clientX, l: tr.scrollLeft}; moved = 0; });
    host.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
    host.addEventListener('dragstart', e => e.preventDefault());
  });
  addEventListener('pointermove', e => { if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 4) { moved = 1; d.tr.classList.add('drag'); } if (moved) d.tr.scrollLeft = d.l - dx; });
  addEventListener('pointerup', () => { if (d) d.tr.classList.remove('drag'); d = null; });
}

function mountFav() {
  const tr = document.querySelector('.favrow .sx-track'); if (!tr || !window.NexusCoverflow) return;
  const slides = [...tr.children].filter(c => c.classList.contains('gc')).map(c => ({title: c.dataset.name, html: c.outerHTML}));
  if (!slides.length) return;
  const host = document.createElement('div'); host.className = 'cf-host'; tr.replaceWith(host);
  NexusCoverflow.create(host, {slides, rotate: 42, depth: .58, perspective: 3.1, falloff: .56, fade: .09, cardWidth: 'clamp(150px,13vw,210px)', gap: .06, loop: slides.length > 2, showCaption: false, showNavigation: slides.length > 1, showPagination: false, label: 'Любимые игры', className: 'cf-row cf-fav'});
}
function after() { mountFav(); try { document.querySelector('.sx-bar').classList.toggle('noact', !(state.view === 'catalog' || state.view === 'library') || document.getElementById('home').hidden); paintHero(); paintHome(); } catch (e) { console.warn('sx', e); } }
function closeFilters() { const fb = document.getElementById('fbtn'), fp = document.getElementById('fpanel'); if (fp && !fp.hidden && fb) fb.click(); }
function boot() {
  document.addEventListener('mousedown', e => { const fp = document.getElementById('fpanel'); if (!fp || fp.hidden) return; if (e.target.closest('#fpanel,#fbtn,.sx-bar,.top')) return; closeFilters(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilters(); });
  shell();
  window.__nxAfterRender = after;
  const r0 = window.render; window.render = function () { const out = r0.apply(this, arguments); after(); return out; };
  window.mountDailyCoverflows = window.mountShowcaseCoverflows = () => {};
  after();
}
boot();
const pb = document.getElementById('profileBox'); if (pb) new MutationObserver(() => mountFav()).observe(pb, {childList: true});
})();
