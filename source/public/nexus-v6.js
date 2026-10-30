'use strict';
// NEXUS v6: «Желаемое» в календаре, уведомления (выход игр, сессии) с вкладкой «Недавно играл»,
// панель фильтров переносится в body, чтобы её не обрезало окно. Подключается последним.
(() => {
  const svg = (d, s = 18, fill) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const HEART = '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>';
  const BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ago = iso => {
    const t = Date.parse(iso); if (!t) return ''; const s = (Date.now() - t) / 1000;
    if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин назад'; if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    const d = Math.floor(s / 86400); if (d < 7) return d + ' дн. назад';
    try { return new Date(t).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'}).replace('.', ''); } catch { return ''; }
  };

  // ===================== Желаемое =====================
  const NW = {wish: {}};
  async function loadWish() {
    try { const w = await jf('/api/wishlist'); NW.wish = w && !w.error && !Array.isArray(w) ? w : {}; } catch {}
    refreshWishUi();
  }
  window.nxWishBtn = id => {
    const on = !!NW.wish[id];
    return `<button class="wish-btn${on ? ' on' : ''}" data-act="wish" aria-pressed="${on}" title="${on ? 'Убрать из желаемого' : 'Добавить в желаемое'}" aria-label="${on ? 'Убрать из желаемого' : 'Добавить в желаемое'}">${svg(HEART, 15, on)}<span>${on ? 'В желаемом' : 'В желаемое'}</span></button>`;
  };
  window.nxWishSection = () => {
    const items = Object.entries(NW.wish).sort((a, b) => String(a[1].released || '9999').localeCompare(String(b[1].released || '9999')));
    if (!items.length) return '';
    const date = it => !it.released ? 'Дата не объявлена' : (it.notified ? 'Уже вышла · ' : '') + (typeof nxCalDate === 'function' ? nxCalDate(it.released) : it.released);
    return `<section class="cal-wish"><h3>${svg(HEART, 16, true)} Моё желаемое <i>${items.length}</i></h3><div class="cw-list">${items.map(([id, it]) => `<a class="cw-card" href="#game=${E(id)}"><span class="cw-img"><img src="${E(it.img || '/uploads/none.png')}" alt="" loading="lazy"></span><span class="cw-t">${E(it.name)}</span><span class="cw-d">${E(date(it))}</span><button class="cw-x" data-act="wish-del" data-id="${E(id)}" title="Убрать из желаемого" aria-label="Убрать из желаемого">${svg('<path d="M6 6l12 12M18 6 6 18"/>', 13)}</button></a>`).join('')}</div></section>`;
  };
  function refreshWishUi() {
    document.querySelectorAll('.cal-act[data-id]').forEach(b => { b.innerHTML = nxWishBtn(b.dataset.id); });
    const box = document.getElementById('calWishBox'); if (box) box.innerHTML = nxWishSection();
  }
  async function wishToggle(id, info, forceDel) {
    if (typeof online !== 'undefined' && !online) return toast('Желаемое работает, когда приложение запущено через NEXUS.exe');
    try {
      if (NW.wish[id] || forceDel) { const r = await jf('/api/wishlist/' + encodeURIComponent(id), 'DELETE'); NW.wish = r && !r.error ? r : NW.wish; toast('Убрано из желаемого'); }
      else {
        const r = await jf('/api/wishlist', 'POST', {id, name: info.name, img: info.img, released: info.released});
        if (r.error) return toast(r.error); NW.wish = r;
        toast(`«${info.name}» в желаемом. Сообщу, когда выйдет`);
      }
    } catch { toast('Нет связи с сервером'); }
    refreshWishUi();
  }
  // capture + stopImmediatePropagation: основной обработчик кликов о «wish» ничего не знает
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-act="wish"], [data-act="wish-del"]'); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (b.dataset.act === 'wish-del') return wishToggle(b.dataset.id, {}, true);
    const box = b.closest('.cal-act'); if (!box) return;
    wishToggle(box.dataset.id, {name: box.dataset.name, img: box.dataset.cover, released: box.dataset.released});
  }, true);

  // ===================== Уведомления и «Недавно играл» =====================
  const NN = {items: [], unread: 0, open: false, tab: 'n'};
  const TYPE_ICO = {
    release: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M8 2v4M16 2v4M3 10h18m-11 5 2 2 4-4"/>',
    session: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    added: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 8h.01M11 12h1v4h1"/>'
  };
  const thumbOf = (id, g) => g.cover || (typeof isSteam === 'function' && isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
  async function loadNotifs() {
    try { const r = await jf('/api/notifs'); if (r && Array.isArray(r.items)) { NN.items = r.items; NN.unread = r.unread | 0; } } catch {}
    paintBell(); if (NN.open) paintPanel();
  }
  window.nxNotifPush = n => {
    if (!n) return; NN.items.unshift(n); NN.unread++; paintBell(); if (NN.open) paintPanel();
    if (n.type === 'release') toast(`${n.title}: ${n.body}`);
  };
  function paintBell() {
    const b = document.getElementById('nxBell'); if (!b) return;
    const n = NN.unread; b.classList.toggle('has', n > 0);
    b.querySelector('.nx-badge').textContent = n > 99 ? '99+' : String(n); b.querySelector('.nx-badge').hidden = !n;
    b.setAttribute('aria-label', n ? `Уведомления: ${n} новых` : 'Уведомления');
  }
  function recentRows() {
    const rows = Object.entries(lib).filter(([, g]) => g.last).sort((a, b) => String(b[1].last).localeCompare(String(a[1].last))).slice(0, 15);
    if (!rows.length) return '<p class="nn-empty">Здесь появятся игры, в которые вы играли. Время считается само, когда игра запущена.</p>';
    return rows.map(([id, g]) => `<a class="nn-row nn-game" href="#game=${E(id)}"><span class="nn-cov"><img src="${E(thumbOf(id, g))}" alt="" loading="lazy" data-id="${E(id)}" data-name="${E(g.name)}"></span><span class="nn-tx"><b>${E(g.name)}</b><small>Играл ${E(ago(g.last))}${g.hours ? ' · всего ' + E(fmtHM(g.hours)) : ''}</small></span></a>`).join('');
  }
  function notifRows() {
    if (!NN.items.length) return '<p class="nn-empty">Пока нет уведомлений. Добавьте игру в «Желаемое» в календаре, и я сообщу, когда она выйдет.</p>';
    return NN.items.slice(0, 60).map(n => `<a class="nn-row${n.read ? '' : ' unread'}" ${n.gid ? `href="#game=${E(n.gid)}"` : 'href="#"'}><span class="nn-ico t-${E(n.type)}">${svg(TYPE_ICO[n.type] || TYPE_ICO.info, 17)}</span><span class="nn-tx"><b>${E(n.title)}</b><small>${E(n.body)}</small></span><time>${E(ago(n.t))}</time></a>`).join('');
  }
  function paintPanel() {
    let p = document.getElementById('nxNotif');
    if (!p) { p = document.createElement('div'); p.id = 'nxNotif'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Уведомления'); document.body.appendChild(p); }
    p.hidden = !NN.open; if (!NN.open) return;
    p.innerHTML = `<div class="nn-h"><div class="nn-tabs" role="tablist"><button role="tab" class="${NN.tab === 'n' ? 'on' : ''}" data-nn="n">Уведомления${NN.unread ? `<i>${NN.unread}</i>` : ''}</button><button role="tab" class="${NN.tab === 'r' ? 'on' : ''}" data-nn="r">Недавно играл</button></div></div>
      <div class="nn-body">${NN.tab === 'n' ? notifRows() : recentRows()}</div>
      ${NN.tab === 'n' && NN.items.length ? '<div class="nn-f"><button data-nn-act="read">Прочитать все</button><button data-nn-act="clear">Очистить</button></div>' : ''}`;
  }
  async function markRead() {
    if (!NN.unread) return; NN.unread = 0; NN.items.forEach(n => n.read = true); paintBell();
    try { await jf('/api/notifs/read', 'POST', {}); } catch {}
  }
  function togglePanel(on) {
    NN.open = on == null ? !NN.open : on; paintPanel();
    document.getElementById('nxBell')?.setAttribute('aria-expanded', NN.open);
    if (NN.open) { loadNotifs(); } else markRead();
  }
  function mountBell() {
    const bar = document.querySelector('.sx-bar'); if (!bar || document.getElementById('nxBell')) return;
    const b = document.createElement('button'); b.id = 'nxBell'; b.className = 'sx-ib nx-bell'; b.type = 'button'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.title = 'Уведомления';
    b.innerHTML = `${svg(BELL, 18)}<i class="nx-badge" hidden>0</i>`;
    bar.appendChild(b); paintBell();
  }
  document.addEventListener('click', e => {
    const bell = e.target.closest && e.target.closest('#nxBell');
    if (bell) { e.preventDefault(); e.stopPropagation(); return togglePanel(); }
    const p = document.getElementById('nxNotif');
    if (!p || p.hidden) return;
    const tab = e.target.closest('[data-nn]'); if (tab) { NN.tab = tab.dataset.nn; return paintPanel(); }
    const act = e.target.closest('[data-nn-act]');
    if (act) {
      if (act.dataset.nnAct === 'read') markRead().then(paintPanel);
      else { NN.items = []; NN.unread = 0; paintBell(); paintPanel(); jf('/api/notifs', 'DELETE').catch(() => {}); }
      return;
    }
    const row = e.target.closest('.nn-row'); if (row) { if (row.getAttribute('href') === '#') e.preventDefault(); togglePanel(false); return; }
    if (!e.target.closest('#nxNotif')) togglePanel(false);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && NN.open) togglePanel(false); });

  // ===================== Панель фильтров: не обрезается окном =====================
  function liftFilters() { const box = document.getElementById('fpanel'); if (box && box.parentElement !== document.body) document.body.appendChild(box); }
  if (typeof window.fpanel === 'function') { const f0 = window.fpanel; window.fpanel = function () { liftFilters(); return f0.apply(this, arguments); }; }
  liftFilters();

  // ===================== запуск =====================
  function boot() {
    mountBell(); loadWish(); loadNotifs();
    setInterval(() => { if (!document.hidden) loadNotifs(); }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
})();
