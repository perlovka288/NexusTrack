'use strict';
// NEXUS: желаемое, уведомления о релизах, колокольчик и быстрое меню профиля.
// Данные живут в localStorage: приложение работает и без сервера, а сервер не хранит лишнего.
const NX_WISH_KEY = 'nx.wishlist.v1', NX_NOTE_KEY = 'nx.notifs.v1';
const nxRead = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch { return def; } };
const nxWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const nxEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nxIc = (n, s = 16) => typeof ic === 'function' ? ic(n, s) : '';
const nxPad = n => String(n).padStart(2, '0');
const nxToday = () => { const d = new Date(); return `${d.getFullYear()}-${nxPad(d.getMonth() + 1)}-${nxPad(d.getDate())}`; };
const nxDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(s + 'T12:00:00') : new Date(s);

let nxWish = (() => { const v = nxRead(NX_WISH_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
let nxNotes = (() => { const v = nxRead(NX_NOTE_KEY, []); return Array.isArray(v) ? v.filter(n => n && n.key) : []; })();
let nxBellOpen = false, nxProfOpen = false;

const nxWishSave = () => nxWrite(NX_WISH_KEY, nxWish);
const nxNoteSave = () => nxWrite(NX_NOTE_KEY, nxNotes);
const nxInWish = id => !!nxWish[String(id)];
const nxNotifCount = () => nxNotes.filter(n => !n.read).length;

// ===== желаемое =====
function nxCalWishBtn(it) {
  const id = String(it.id), on = nxInWish(id);
  const gl = ((it.genreSlugs && it.genreSlugs.length ? it.genreSlugs : it.genres) || []).slice(0, 3).join(',');
  return `<button type="button" class="cal-wish${on ? ' on' : ''}" data-act="nx-wish" data-id="${nxEsc(id)}" data-name="${nxEsc(it.name || '')}" data-cover="${nxEsc(it.img || '')}" data-released="${nxEsc(it.released || '')}" data-genres="${nxEsc(gl)}" data-platforms="${nxEsc((it.platforms || []).slice(0, 4).join(','))}" data-rating="${+it.rating || 0}" data-metacritic="${+it.metacritic || 0}" aria-pressed="${on}" title="${on ? 'Убрать из желаемого' : 'Добавить в желаемое'}">${nxIc(on ? 'check' : 'heart', 15)}<span>${on ? 'В желаемом' : 'Добавить в желаемое'}</span></button>`;
}
function nxWishPaintButtons() {
  document.querySelectorAll('.cal-wish[data-id]').forEach(btn => {
    const on = nxInWish(btn.dataset.id);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Убрать из желаемого' : 'Добавить в желаемое';
    btn.innerHTML = nxIc(on ? 'check' : 'heart', 15) + `<span>${on ? 'В желаемом' : 'Добавить в желаемое'}</span>`;
  });
  if (typeof nav === 'function') nav();
}
function nxWishToggle(b) {
  const id = String(b.dataset.id || ''); if (!id) return;
  const name = b.dataset.name || nxWish[id]?.name || ('Игра ' + id);
  if (nxWish[id]) {
    delete nxWish[id];
    if (typeof toast === 'function') toast(`«${name}» убрана из желаемого`);
  } else {
    nxWish[id] = {
      id, name, img: b.dataset.cover || '', released: b.dataset.released || '',
      genres: b.dataset.genres || '', platforms: b.dataset.platforms || '',
      rating: +b.dataset.rating || 0, metacritic: +b.dataset.metacritic || 0,
      addedAt: new Date().toISOString()
    };
    if (typeof toast === 'function') toast(`«${name}» добавлена в желаемое`);
    nxWishNotifyCheck();
  }
  nxWishSave(); nxWishPaintButtons();
}
// календарь обновился: подтягиваем новые даты/обложки к желаемому
function nxWishSyncCalendar(months) {
  let changed = false;
  for (const m of months || []) for (const it of m.items || []) {
    const id = String(it.id), w = nxWish[id]; if (!w) continue;
    const genres = ((it.genreSlugs && it.genreSlugs.length ? it.genreSlugs : it.genres) || []).slice(0, 3).join(',');
    const next = {
      name: it.name || w.name, img: it.img || w.img || '', released: it.released || w.released || '',
      genres, platforms: (it.platforms || []).slice(0, 4).join(','), rating: +it.rating || 0, metacritic: +it.metacritic || 0
    };
    for (const k of Object.keys(next)) if (String(w[k] ?? '') !== String(next[k] ?? '')) { w[k] = next[k]; changed = true; }
  }
  if (changed) { nxWishSave(); nxWishNotifyCheck(); }
}

// ===== уведомления о релизах =====
function nxWishNotifyCheck() {
  const today = nxToday(); const fresh = [];
  for (const [id, w] of Object.entries(nxWish)) {
    const rel = String(w.released || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rel) || rel > today) continue;            // игра ещё не вышла
    const added = String(w.addedAt || '').slice(0, 10);
    if (added && added > rel) continue;                                          // добавили уже после релиза — не шумим
    const key = 'wish:' + id + ':' + rel;
    if (nxNotes.some(n => n.key === key)) continue;
    fresh.push({key, kind: 'release', id, name: w.name || ('Игра ' + id), img: w.img || '', released: rel,
      genres: w.genres || '', platforms: w.platforms || '', rating: +w.rating || 0, metacritic: +w.metacritic || 0,
      at: Date.now(), read: false});
  }
  if (!fresh.length) return;
  nxNotes = [...fresh, ...nxNotes].slice(0, 60); nxNoteSave(); nxUpdateBell();
  if (fresh.length <= 2 && typeof toast === 'function') fresh.forEach(n => toast(`Релиз из желаемого: «${n.name}» уже вышел`));
}
function nxReadAll() {
  let changed = false;
  nxNotes.forEach(n => { if (!n.read) { n.read = true; changed = true; } });
  if (changed) {
    nxNoteSave(); nxUpdateBell();
    const t = document.querySelector('.nx-bell-panel .nx-panel-title span'); if (t) t.textContent = 'Всё прочитано';
    document.querySelector('.nx-bell-panel .nx-panel-btn[data-act="nx-readall"]')?.remove();
  }
}

// ===== недавние сессии =====
function nxWhen(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const day = same(d, now) ? 'Сегодня' : same(d, y) ? 'Вчера' : d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
  return day + ', ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}
function nxCover(id, g) {
  if (g && g.cover) return g.cover;
  return typeof isSteam === 'function' && isSteam(id) && typeof CDN === 'string' ? CDN + id + '/library_600x900.jpg' : '';
}
function nxRecentSessions(limit = 8) {
  const out = [];
  for (const [id, g] of Object.entries(typeof lib === 'object' && lib ? lib : {})) {
    const ss = Array.isArray(g.sessions) ? g.sessions.slice(-4) : [];
    let found = false;
    for (const s of ss) {
      const at = s.e || s.s; if (!at) continue;
      out.push({id, name: g.name || ('Игра ' + id), cover: nxCover(id, g), at, sec: +s.sec || 0, plat: s.plat || '', fallback: false});
      found = true;
    }
    if (!found && g.last) out.push({id, name: g.name || ('Игра ' + id), cover: nxCover(id, g), at: g.last, sec: (+g.hours || 0) * 3600, plat: (g.playedOn || [])[0] || '', fallback: true});
  }
  return out.filter(x => !isNaN(Date.parse(x.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
function nxDur(sec) {
  if (typeof fmtDur === 'function') return fmtDur(sec);
  const s = Math.round(+sec || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h} ч ${m} мин` : m ? `${m} мин` : `${s} с`;
}
function nxPlatLabel(id) {
  if (!id || typeof D === 'undefined') return '';
  return (D.PLATFORM_BY_ID[id] || {}).label || '';
}
function nxSessionRow(s) {
  const img = s.cover ? `<img src="${nxEsc(s.cover)}" alt="" loading="lazy" onerror="this.remove()">` : nxIc('pad', 17);
  const plat = nxPlatLabel(s.plat);
  return `<a class="nx-sess" href="#game=${nxEsc(s.id)}" data-id="${nxEsc(s.id)}">
    <span class="nx-sess-cov">${img}</span>
    <span class="nx-sess-main"><b>${nxEsc(s.name)}</b><small>${nxEsc(nxWhen(s.at))}${plat ? ' · ' + nxEsc(plat) : ''}</small></span>
    <span class="nx-sess-time">${nxEsc(nxDur(s.sec))}<small>${s.fallback ? 'последний запуск' : 'сессия'}</small></span>
  </a>`;
}
function nxNoteCard(n) {
  const img = n.img || nxCover(n.id, null);
  const date = (() => { const d = nxDay(n.released); return isNaN(d) ? n.released : d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'}); })();
  const gl = String(n.genres || '').split(',').filter(Boolean).slice(0, 2).map(g => typeof genreRu === 'function' ? genreRu(g) : g).join(' · ');
  const pl = String(n.platforms || '').split(',').filter(Boolean).slice(0, 3).join(' · ');
  const meta = [date ? `<span>${nxIc('calendar', 12)}${nxEsc(date)}</span>` : '', n.rating ? `<span class="nx-star">${nxIc('star', 12)}${(+n.rating).toFixed(1)}</span>` : '', n.metacritic ? `<span>MC ${n.metacritic}</span>` : ''].filter(Boolean).join('');
  const tags = [gl, pl].filter(Boolean).map(x => `<span>${nxEsc(x)}</span>`).join('');
  return `<article class="nx-note${n.read ? '' : ' is-new'}" data-key="${nxEsc(n.key)}">
    <a class="nx-note-cov" href="#game=${nxEsc(n.id)}">${img ? `<img src="${nxEsc(img)}" alt="" loading="lazy" onerror="this.remove()">` : nxIc('image', 18)}</a>
    <div class="nx-note-main"><span class="nx-note-k">${nxIc('heart', 12)} Релиз из желаемого</span><a class="nx-note-title" href="#game=${nxEsc(n.id)}">${nxEsc(n.name)}</a>
      <div class="nx-note-meta">${meta}</div>${tags ? `<div class="nx-note-tags">${tags}</div>` : ''}</div>
    <a class="nx-note-go" href="#game=${nxEsc(n.id)}" aria-label="Открыть игру">${nxIc('chevR', 15)}</a>
  </article>`;
}

// ===== панель колокольчика =====
function nxPanelEl() {
  let el = document.querySelector('.nx-bell-panel');
  if (!el) {
    el = document.createElement('section');
    el.className = 'nx-bell-panel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', 'Уведомления'); el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  return el;
}
function nxPaintBell() {
  const el = nxPanelEl();
  const notes = nxNotes.slice(0, 10), sessions = nxRecentSessions(8), unread = nxNotifCount();
  el.innerHTML = `<div class="nx-panel-head">
    <div class="nx-panel-title"><b>Уведомления</b><span>${unread ? `${unread} новых` : 'Всё прочитано'}</span></div>
    <div class="nx-panel-acts">${unread ? `<button type="button" class="nx-panel-btn" data-act="nx-readall">${nxIc('check', 14)}<span>Прочитать</span></button>` : ''}<button type="button" class="nx-panel-x" data-act="nx-bell-close" aria-label="Закрыть">${nxIc('x', 16)}</button></div>
  </div>
  <div class="nx-panel-body">
    <div class="nx-sect-h"><span>Релизы из желаемого</span><i>${nxNotes.length}</i></div>
    ${notes.length ? notes.map(nxNoteCard).join('') : `<p class="nx-empty">${nxIc('heart', 18)}<span>Добавьте игры в желаемое в календаре. Когда наступит дата релиза, здесь появится подробная карточка игры.</span></p>`}
    <div class="nx-sect-h"><span>Недавно играли</span><i>${sessions.length}</i></div>
    ${sessions.length ? sessions.map(nxSessionRow).join('') : `<p class="nx-empty">${nxIc('clock', 18)}<span>Пока нет сессий. Запустите игру, и здесь появится дата, время и длительность.</span></p>`}
  </div>`;
}
function nxUpdateBell() {
  const b = document.querySelector('.nx-bell'); if (!b) return;
  const n = nxNotifCount(), badge = b.querySelector('.nx-badge');
  if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); }
  b.classList.toggle('has-unread', !!n);
  b.setAttribute('aria-label', 'Уведомления' + (n ? ': ' + n + ' новых' : ''));
}
function nxBell(force) {
  const el = nxPanelEl(), next = typeof force === 'boolean' ? force : !nxBellOpen;
  nxBellOpen = next;
  if (next) { nxPaintBell(); nxProf(false); }
  el.classList.toggle('open', next); el.setAttribute('aria-hidden', String(!next));
  const b = document.querySelector('.nx-bell'); if (b) { b.setAttribute('aria-expanded', String(next)); b.classList.toggle('on', next); }
  if (next) setTimeout(() => { if (nxBellOpen) nxReadAll(); }, 900);   // бейдж гаснет, но «новые» карточки ещё видны
}

// ===== меню профиля =====
function nxProf(force) {
  const menu = document.querySelector('[data-nx-menu]'); if (!menu) return;
  const next = typeof force === 'boolean' ? force : !nxProfOpen;
  nxProfOpen = next;
  if (next) nxBell(false);
  menu.classList.toggle('open', next); menu.setAttribute('aria-hidden', String(!next));
  const b = menu.parentElement.querySelector('.nl.prof'); if (b) b.setAttribute('aria-expanded', String(next));
}
function nxCloseUserMenus() { nxBell(false); nxProf(false); }
function nxSyncUserUi() {
  const b = document.querySelector('.nx-bell'); if (b) { b.setAttribute('aria-expanded', String(nxBellOpen)); b.classList.toggle('on', nxBellOpen); }
  const menu = document.querySelector('[data-nx-menu]'); if (menu) {
    menu.classList.toggle('open', nxProfOpen); menu.setAttribute('aria-hidden', String(!nxProfOpen));
    const pb = menu.parentElement.querySelector('.nl.prof'); if (pb) pb.setAttribute('aria-expanded', String(nxProfOpen));
  }
  nxUpdateBell();
}

// ===== действия из общего диспетчера app.js =====
function nxActNotify(act, b) {
  switch (act) {
    case 'nx-bell': nxBell(); return true;
    case 'nx-bell-close': nxBell(false); return true;
    case 'nx-prof': nxProf(); return true;
    case 'nx-readall': nxReadAll(); nxPaintBell(); return true;
    case 'nx-wish': nxWishToggle(b); return true;
  }
  return false;
}

// ===== события =====
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('.nx-user') && !e.target.closest?.('.nx-bell-panel')) nxCloseUserMenus();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') nxCloseUserMenus(); });
document.addEventListener('click', e => {
  if (e.target.closest?.('.nx-bell-panel a[href^="#game="]')) nxCloseUserMenus();
});
addEventListener('hashchange', nxCloseUserMenus);
addEventListener('focus', () => nxWishNotifyCheck());
document.addEventListener('visibilitychange', () => { if (!document.hidden) nxWishNotifyCheck(); });

// ===== запуск =====
function nxNotifyBoot() {
  nxPanelEl(); nxWishNotifyCheck(); nxUpdateBell(); nxSyncUserUi();
  setTimeout(nxWishNotifyCheck, 2500);
  setInterval(nxWishNotifyCheck, 60 * 60 * 1000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nxNotifyBoot, {once: true}); else nxNotifyBoot();
