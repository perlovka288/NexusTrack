'use strict';
// NEXUS: профиль, папки библиотеки, любимые игры, редактор обложек, блок «Похожие игры». Здесь же запуск приложения.

async function loadMisc() {
  try { [profile, folders] = await Promise.all([jf('/api/profile'), jf('/api/folders')]); } catch { profile = profile || {}; folders = folders || {}; }
  if (!profile || profile.error) profile = {}; if (!folders || folders.error) folders = {};
}
const folderIds = () => Object.entries(folders).sort((a, b) => String(a[1].created).localeCompare(String(b[1].created))).map(e => e[0]);
const inFolder = fid => Object.values(lib).filter(g => (g.folders || []).includes(fid)).length;
const needServer = () => { if (online) return false; toast('Эта функция работает, когда приложение запущено через NEXUS.exe или server.js'); return true; };
// после изменения игры в библиотеке: счётчики, карточки, страница игры
function afterLibChange(id) {
  nav(); stats(); chips();
  if (!$('#home').hidden) { if (state.view === 'library' || state.view === 'profile') render(); else patchCards(id); }
  refreshPage(id);
}

// ===== избранное, папки и платформы на странице игры =====
function libSide(id, g) {
  const ids = folderIds(), mine = g.folders || [];
  return `<button class="favbtn${g.fav ? ' on' : ''}" data-act="fav" aria-pressed="${!!g.fav}">${g.fav ? icf('heart', 16) : ic('heart', 16)}<span>${g.fav ? 'В любимых' : 'Добавить в любимые'}</span></button>
  <div class="lbl"><span class="li">${ic('folder', 14)}Папки</span><button class="lnk" data-act="folder-new" data-assign="1">${ic('plus', 13)} Новая</button></div>
  ${ids.length ? `<div class="fchips">${ids.map(f => `<button class="fc sm${mine.includes(f) ? ' on' : ''}" data-act="gfolder" data-fid="${f}" aria-pressed="${mine.includes(f)}">${ic('folder', 13)}${esc(folders[f].name)}</button>`).join('')}</div>` : '<p class="hint l">Папок пока нет. Создайте, например, «Пройдено на 100%» или «Бэклог».</p>'}
  <div class="lbl"><span class="li">${ic('pad', 14)}Играл на</span></div>
  <div class="fchips pickplat">${D.GROUPS.map(gr => { const ps = D.PLATFORMS.filter(p => p.group === gr.id && (p.id !== 'deck' || (g.playedOn || []).includes('deck'))); return `<div class="pgroup"><span class="pgl">${esc(gr.label)}</span>${ps.map(p => `<button class="fc sm${(g.playedOn || []).includes(p.id) ? ' on' : ''}" data-act="gplat" data-p="${p.id}" aria-pressed="${(g.playedOn || []).includes(p.id)}">${platIcon(p.id)}${esc(p.label)}</button>`).join('')}</div>`; }).join('')}</div>
  <p class="hint l">Платформа ставится сама, когда игра запущена на этом компьютере. Консоли и телефон отметьте вручную.</p>`;
}

// ===== панель папок над библиотекой =====
function folderBar() {
  const bar = $('#folderbar'); if (!bar || state.view !== 'library') return;
  // перерисовываем только если что-то изменилось: открытая папка остаётся открытой, рисунки не мигают
  const sig = JSON.stringify([state.lf.folder, Object.keys(lib).length, Object.values(lib).filter(g => g.fav).length, folderIds().map(id => [id, folders[id].name, Object.entries(lib).filter(([, g]) => (g.folders || []).includes(id)).map(([i, g]) => i + (g.cover || '') + (g.hours || '')).join(',')])]);
  if (bar.dataset.sig === sig) return; bar.dataset.sig = sig;
  bar.innerHTML = glassFolders({width: 240}); paintFolders(bar);
}

// ===== всплывающие окна =====
const mbox = (title, body, wide) => { modal().innerHTML = `<div class="mbox${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><h2>${esc(title)}</h2><button class="ib" data-act="ng-close" aria-label="Закрыть">${ic('x', 18)}</button></div>${body}</div>`; modal().hidden = false; document.body.classList.add('lock'); };

// --- папка: создать, переименовать, удалить ---
let fdAssign = '';
function openFolderEdit(fid, assignId) {
  if (needServer()) return;
  fdAssign = assignId || ''; const f = fid ? folders[fid] : null;
  mbox(f ? 'Папка' : 'Новая папка', `<div class="mform"><label>Название<input id="fd-name" class="tin" maxlength="40" value="${esc(f ? f.name : '')}" placeholder="Например, «Любимый кооператив»" autocomplete="off"></label>
    <p class="hint l">Подойдут «Пройдено на 100%», «Бэклог», «Любимый кооператив». Игру можно положить в несколько папок.</p>
    <div class="sbtns"><button class="btn" data-act="fd-save" data-fid="${fid || ''}">${ic('check', 16)} ${f ? 'Сохранить' : 'Создать'}</button>${f ? `<button class="ib wide" data-act="fd-del" data-fid="${fid}">${ic('trash', 16)} Удалить папку</button>` : ''}</div></div>`);
  const i = $('#fd-name'); i.focus(); i.select(); i.onkeydown = e => { if (e.key === 'Enter') $('[data-act=fd-save]').click(); };
}
async function saveFolder(fid) {
  const name = $('#fd-name').value.trim(); if (!name) { $('#fd-name').focus(); return toast('Введите название папки'); }
  const r = await jf(fid ? '/api/folders/' + fid : '/api/folders', fid ? 'PUT' : 'POST', {name}).catch(() => ({error: 'Нет связи с сервером'}));
  if (r.error) return toast(r.error);
  folders[r.id] = {name: r.name, created: r.created || folders[r.id]?.created};
  if (!fid && fdAssign && lib[fdAssign]) { const g = lib[fdAssign]; g.folders = [...(g.folders || []), r.id]; push(fdAssign, {folders: g.folders}); }
  const a = fdAssign; closeNew(); toast(fid ? 'Папка сохранена' : `Папка «${name}» создана`); render(); if (a) refreshPage(a);
}

// --- «в какие папки положить игру» (кнопка на карточке) ---
function openAssign(id) {
  if (!lib[id]) return; renderAssign(id);
}
function renderAssign(id) {
  const g = lib[id], mine = g.folders || [], ids = folderIds();
  mbox(g.name, `<div class="aslist">
    <button class="asrow${g.fav ? ' on' : ''}" data-act="as-fav" data-id="${esc(id)}">${g.fav ? icf('heart', 18) : ic('heart', 18)}<span>Любимые</span>${g.fav ? ic('check', 16) : ''}</button>
    ${ids.map(f => `<button class="asrow${mine.includes(f) ? ' on' : ''}" data-act="as-toggle" data-id="${esc(id)}" data-fid="${f}">${ic('folder', 18)}<span>${esc(folders[f].name)}</span>${mine.includes(f) ? ic('check', 16) : ''}</button>`).join('')}
    ${ids.length ? '' : '<p class="mut" style="padding:8px 4px">Папок пока нет. Создайте первую ниже.</p>'}
  </div>
  <div class="covctl" style="margin-top:14px"><input id="as-new" maxlength="40" placeholder="Новая папка" aria-label="Название новой папки"><button class="ib" data-act="as-new" data-id="${esc(id)}" title="Создать и добавить" aria-label="Создать и добавить">${ic('plus', 16)}</button></div>`);
  const i = $('#as-new'); i.onkeydown = e => { if (e.key === 'Enter') $('[data-act=as-new]').click(); };
}

// --- редактор обложки (карандаш на карточке): как у Tomb Raider II на всю карточку или баннером ---
function openCoverEdit(id) {
  const g = lib[id]; if (!g) return;
  const src = g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
  mbox('Обложка', `<div class="mgrid ce"><div class="gc cepv" data-id="${esc(id)}" data-name="${esc(g.name)}"><span class="gc-link"><img id="ce-img" src="${esc(src)}" alt="" data-id="${esc(id)}" data-name="${esc(g.name)}"><span class="gc-shade"></span><span class="gc-txt"><span class="gc-cat">${esc(yearGenre(id) || 'Предпросмотр')}</span><span class="gc-title">${esc(g.name)}</span></span></span></div>
    <div class="mform"><div><div class="lbl" style="margin-top:0"><span class="li">${ic('image', 14)}Как показывать</span></div>
      <div class="seg3" role="radiogroup" aria-label="Режим обложки">${[['', 'Авто'], ['fill', 'На всю карточку'], ['banner', 'Баннер']].map(([v, t]) => `<button class="${(g.coverFit || '') === v ? 'on' : ''}" role="radio" aria-checked="${(g.coverFit || '') === v}" data-act="ce-fit" data-v="${v}">${t}</button>`).join('')}</div>
      <p class="hint l" style="margin-top:8px">«На всю карточку»: постер заполняет карточку целиком. «Баннер»: горизонтальная картинка на размытом фоне.</p></div>
    <label>Ссылка на картинку<span class="covctl"><input id="ce-url" value="${esc(g.cover || '')}" placeholder="https://…" autocomplete="off"><button class="ib" data-act="ce-url" title="Применить ссылку" aria-label="Применить ссылку">${ic('check', 16)}</button></span></label>
    <div class="sbtns" style="margin-top:0"><button class="ib wide" data-act="ce-up">${ic('upload', 16)} Загрузить файл</button><button class="ib wide" data-act="ce-auto">${ic('wand', 16)} Подобрать</button><button class="ib wide" data-act="ce-reset">${ic('x', 16)} Сбросить</button></div>
    <button class="btn" data-act="ng-close" style="justify-self:start">${ic('check', 16)} Готово</button></div></div>`, true);
  const im = $('#ce-img'), c = im.closest('.gc'); if (im.complete && im.naturalWidth) applyFit(c, im);
  $('#ce-url').onkeydown = e => { if (e.key === 'Enter') $('[data-act=ce-url]').click(); };
}
function cePreview(id) {
  const g = lib[id], im = $('#ce-img'); if (!g || !im) return;
  const src = g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png'), c = im.closest('.gc');
  const fit = () => applyFit(c, im);
  if (im.getAttribute('src') !== src) { im.dataset.st = 0; im.onload = fit; im.src = src; } else fit();
  const u = $('#ce-url'); if (u && document.activeElement !== u) u.value = g.cover || '';
  document.querySelectorAll('.seg3 button').forEach(b => { const on = b.dataset.v === (g.coverFit || ''); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}

// ===== профиль =====
let pfDraft = null;
let pfTab = 'main';
const initials = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
// готовые арты для баннера: обложки любимых и самых заметных игр библиотеки, затем известные тайтлы
function bannerPresets() {
  const rows = Object.entries(lib).map(([id, g]) => ({id, g, s: (g.fav ? 100 : 0) + (+g.rating || 0) * 4 + Math.min(20, +g.hours || 0) / 10})).sort((a, b) => b.s - a.s);
  const seen = new Set(), out = [];
  const push = (id, name) => { const u = /^\d+$/.test(id) ? CDN + id + '/library_hero.jpg' : (lib[id]?.cover || ''); if (!u || seen.has(u)) return; seen.add(u); out.push({u, n: name}); };
  for (const r of rows) { push(r.id, r.g.name); if (out.length >= 8) break; }
  if (out.length < 8) for (const [id, name] of FEATURED) { push(id, name); if (out.length >= 8) break; }
  return out;
}
// строка в списке «Пройденные игры»: обложка, дата, время, платформа, оценка
const doneRowHtml = (c, thumb) => `<li data-id="${esc(c.id)}"><a href="#game=${esc(c.id)}" class="dn"><img src="${esc(thumb(c.id, c.g))}" alt="" loading="lazy" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-hero="1"><span>${esc(c.name)}</span></a>
  <span class="dm">${c.finished ? `<span class="gm">${ic('calendar', 13)}${esc(dRu(c.finished))}</span>` : ''}${c.hours ? `<span class="gm">${ic('clock', 13)}${esc(fmtHM(c.hours))}</span>` : ''}${c.platforms.length ? `<span class="gm pis">${platIcons(c.platforms)}${esc(c.platforms.map(p => (D.PLATFORM_BY_ID[p] || {}).label).filter(Boolean).join(', '))}</span>` : ''}${c.g.rating ? `<span class="gm">${icf('star', 13)}${esc(c.g.rating)}</span>` : ''}</span></li>`;
// пройденные игры: плитка или список без страниц
function doneView(comp, years, thumb) {
  if (getMode('done') === 'grid') return `<div class="grid fgrid2">${comp.years.flatMap(y => comp.byYear[y]).map(c => card(c.id, c.g.name, '', esc([c.finished ? c.finished.slice(0, 4) : '', c.platforms.length ? c.platforms.map(p => (D.PLATFORM_BY_ID[p] || {label: p}).label).join(', ') : ''].filter(Boolean).join(' · ')))).join('')}</div>`;
  const flat = comp.years.flatMap(y => comp.byYear[y].map(c => ({y, c})));
  const ys = [...new Set(flat.map(x => x.y))];
  return ys.map(y => { const rows = flat.filter(x => x.y === y).map(x => x.c); return `<div class="yr-blk"><h3>${y ? y : 'Год не указан'}<i>${comp.byYear[y].length}</i></h3><ul class="donelist">${rows.map(c => doneRowHtml(c, thumb)).join('')}</ul></div>`; }).join('');
}
function renderProfile() {
  const box = $('#profileBox'); if (!box) return;
  const all = Object.entries(lib), favs = all.filter(([, g]) => g.fav).sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru'));
  const comp = F.completed(lib, rmeta), total = all.reduce((a, [, g]) => a + (+g.hours || 0), 0);
  const pen = (focus, label, cls = '') => `<button class="pen ${cls}" data-act="pf-edit" data-focus="${focus}" title="${label}" aria-label="${label}">${ic('pencil', 15)}</button>`;
  const cov = profile.cover ? `background-image:url('${esc(profile.cover)}');background-position:50% ${+profile.coverY >= 0 ? +profile.coverY : 50}%` : '';
  const thumb = (id, g) => g.cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png');
  const platSum = Object.entries(comp.byPlat).filter(([p]) => p).sort((a, b) => b[1] - a[1]);
  const momN = typeof moments === 'function' ? moments().length : 0;
  const overview = `<div class="stats pfstats"><div><b>${all.length}</b><small>Игр в библиотеке</small></div><div><b>${comp.list.length}</b><small>Пройдено</small></div><div><b>${esc(fmtHM(total, '0 мин'))}</b><small>Всего времени</small></div><div><b>${favs.length}</b><small>Любимых</small></div></div>
  ${typeof rewindHtml === 'function' ? rewindHtml() : ''}
  <section class="pfsec"><h2>${ic('heart', 20)} Любимые игры<i>${favs.length}</i></h2>${favCarousel(favs)}</section>
  <section class="pfsec" id="donesec"><div class="sech"><h2>${ic('trophy', 20)} Пройденные игры<i>${comp.list.length}</i></h2>${comp.list.length ? modeSwitch('done') : ''}</div>
    ${platSum.length ? `<div class="fchips psum">${platSum.map(([p, n]) => `<span class="chip">${platIcon(p)} ${esc((D.PLATFORM_BY_ID[p] || {label: p}).label)}<b>${n}</b></span>`).join('')}</div>` : ''}
    ${comp.list.length ? doneView(comp, null, thumb) : '<p class="mut">Когда вы отметите игру статусом «Прошёл», она появится здесь с годом прохождения и платформой.</p>'}</section>
  <section class="pfsec"><h2>${ic('folder', 20)} Папки<i>${folderIds().length}</i></h2>${glassFolders({chips: false, width: 250})}</section>`;
  const gallery = `<section class="pfsec momsec"><h2>${ic('image', 20)} Мои лучшие моменты<i>${momN}</i></h2>${typeof shotsGallery === 'function' ? shotsGallery() : ''}</section>`;
  // Компактная кнопка в шапке профиля вместо широкой вкладки: галерея не
  // отнимает место у обзора и не спорит с аватаром и обложкой.
  const momOn = pfTab === 'shots';
  const momLabel = momOn ? 'Обзор профиля' : 'Мои лучшие моменты';
  const momBtn = `<button class="pfmom${momOn ? ' on' : ''}" data-act="pf-tab" data-v="${momOn ? 'main' : 'shots'}" aria-pressed="${momOn}" title="${momLabel}">${ic(momOn ? 'grid' : 'image', 15)}<span>${momLabel}</span><i>${momN}</i></button>`;
  box.innerHTML = `<div class="pfcover hv${profile.cover ? '' : ' empty'}" style="${cov}">${pen('cover', 'Изменить обложку')}</div>
  <div class="pfhead"><div class="pfav hv">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="">` : (profile.name ? `<span>${esc(initials(profile.name))}</span>` : ic('user', 44))}${pen('avatar', 'Изменить аватар')}</div>
    <div class="pfinfo hv"><h2 class="pfname">${esc(profile.name || 'Мой профиль')}</h2><p class="pfbio${profile.bio ? '' : ' mut'}">${profile.bio ? esc(profile.bio) : 'Расскажите о себе: во что любите играть и что ждёте.'}</p>${momBtn}${pen('name', 'Изменить имя и описание', 'inline')}</div></div>
  ${pfTab === 'shots' ? gallery : overview}`;
  requestAnimationFrame(updRows);
}
function setPfTab(v) { pfTab = v === 'shots' ? 'shots' : 'main'; renderProfile(); scrollTo({top: 0, behavior: 'smooth'}); }

function openProfileEdit(focus) {
  if (needServer()) return;
  pfDraft = {name: profile.name || '', login: profile.login || '', bio: profile.bio || '', avatar: profile.avatar || '', cover: profile.cover || '', coverY: profile.coverY >= 0 ? +profile.coverY : 50};
  mbox('Профиль', `<div class="mform pfedit">
    <div class="pfe-cover" id="pfe-cover"><span class="pfe-drophint">${ic('upload', 18)} Перетащите картинку сюда</span></div>
    <div class="sbtns" style="margin-top:-4px"><button class="ib wide" data-act="pf-cover-up">${ic('image', 16)} Обложка</button><button class="ib wide" data-act="pf-cover-del" title="Убрать обложку">${ic('x', 16)}</button>
      <label class="pfy"><span class="mut">Положение</span><input id="pfe-y" type="range" min="0" max="100" value="${pfDraft.coverY}" aria-label="Положение обложки по вертикали"></label></div>
    <div class="pfe-presets" id="pfe-presets" aria-label="Готовые арты для баннера">${bannerPresets().map(p => `<button class="pfep" data-act="pf-cover-preset" data-url="${esc(p.u)}" title="${esc(p.n)}" aria-label="${esc(p.n)}"><img src="${esc(p.u)}" alt="" loading="lazy"></button>`).join('')}</div>
    <div class="covctl"><input id="pfe-cover-url" placeholder="Ссылка на баннер (https://…)" aria-label="Ссылка на баннер" autocomplete="off"><button class="ib" data-act="pf-cover-url" title="Применить ссылку" aria-label="Применить ссылку">${ic('check', 16)}</button></div>
    <div class="pfe-row"><div class="pfe-av" id="pfe-av"></div><div class="sbtns" style="margin:0"><button class="ib wide" data-act="pf-avatar-up">${ic('upload', 16)} Аватар</button><button class="ib wide" data-act="pf-avatar-del" title="Убрать аватар">${ic('x', 16)}</button></div></div>
    <label>Имя<input id="pfe-name" class="tin" maxlength="60" value="${esc(pfDraft.name)}" placeholder="Как вас зовут" autocomplete="off"></label>
    ${window.nxAdmin ? `<label>Логин<input id="pfe-login" class="tin" maxlength="32" value="${esc(pfDraft.login)}" placeholder="Необязательно" autocomplete="off" spellcheck="false"></label>` : ''}
    <label>О себе<textarea id="pfe-bio" class="mini" maxlength="600" placeholder="Во что любите играть, любимые жанры, чего ждёте">${esc(pfDraft.bio)}</textarea></label>
    <div class="sbtns"><button class="btn" data-act="pf-save">${ic('check', 16)} Сохранить</button><button class="ib wide" data-act="ng-close">Отмена</button></div></div>`, true);
  pfePreview();
  $('#pfe-y').oninput = e => { pfDraft.coverY = +e.target.value; pfePreview(); };
  const cv = $('#pfe-cover');
  if (cv) {
    const over = on => e => { e.preventDefault(); cv.classList.toggle('over', on); };
    cv.addEventListener('dragover', over(true)); cv.addEventListener('dragenter', over(true)); cv.addEventListener('dragleave', over(false));
    cv.addEventListener('drop', async e => {
      e.preventDefault(); cv.classList.remove('over');
      const f = e.dataTransfer?.files?.[0]; if (!f) return;
      if (!/^image\//i.test(f.type)) return toast('Нужна картинка PNG, JPG, WEBP или GIF');
      try { pfDraft.cover = await uploadFile(f); pfePreview(); toast('Баннер загружен'); } catch (er) { toast(er.message); }
    });
  }
  const u = $('#pfe-cover-url'); if (u) u.onkeydown = e => { if (e.key === 'Enter') $('[data-act=pf-cover-url]').click(); };
  const f = {cover: '#pfe-y', avatar: '#pfe-av', name: '#pfe-name', bio: '#pfe-bio'}[focus]; if (f) { const el = $(f); (focus === 'name' ? $('#pfe-name') : el).focus?.(); }
}
function pfePreview() {
  const c = $('#pfe-cover'), a = $('#pfe-av'); if (!c || !a || !pfDraft) return;
  c.style.backgroundImage = pfDraft.cover ? `url('${pfDraft.cover}')` : ''; c.style.backgroundPosition = `50% ${pfDraft.coverY}%`; c.classList.toggle('empty', !pfDraft.cover);
  document.querySelectorAll('.pfep').forEach(b => b.classList.toggle('on', b.dataset.url === pfDraft.cover));
  const u = $('#pfe-cover-url'); if (u && document.activeElement !== u) u.value = pfDraft.cover || '';
  a.innerHTML = pfDraft.avatar ? `<img src="${esc(pfDraft.avatar)}" alt="">` : ic('user', 34);
}
async function saveProfile() {
  const lg = $('#pfe-login'), body = {name: $('#pfe-name').value, ...(lg ? {login: lg.value} : {}), bio: $('#pfe-bio').value, avatar: pfDraft.avatar, cover: pfDraft.cover, coverY: pfDraft.coverY};
  const r = await jf('/api/profile', 'PUT', body).catch(() => ({error: 'Нет связи с сервером'}));
  if (r.error) return toast(r.error);
  profile = r; closeNew(); toast('Профиль сохранён'); render();
  try { window.nxAdminUI && window.nxAdminUI.recheck(); } catch {}
}

// ===== «Похожие игры»: по жанрам и тегам =====
const simCache = {};
async function loadSimilar(id, name) {
  if (!online) return;
  if (simCache[id]) return renderSim(id);
  simCache[id] = {busy: true}; renderSim(id);
  try { const r = await jf(`/api/similar/${encodeURIComponent(id)}?name=${encodeURIComponent(name || '')}`); simCache[id] = r && Array.isArray(r.results) ? r : {results: [], err: true}; }
  catch { simCache[id] = {results: [], err: true}; }
  if (simCache[id].err) setTimeout(() => delete simCache[id], 30000);
  renderSim(id);
}
function renderSim(id) {
  const box = $('#simbox'); if (!box || curId() !== id) return;
  const s = simCache[id];
  if (!online || !s) { box.innerHTML = ''; return; }
  if (s.busy) { box.innerHTML = '<h2 class="sth2">Похожие игры</h2><p class="mut">Подбираем по жанрам и тегам…</p>'; return; }
  if (!s.results.length) { box.innerHTML = s.err ? '' : '<h2 class="sth2">Похожие игры</h2><p class="mut">Пока нечего посоветовать: у этой игры нет данных о жанрах и тегах.</p>'; return; }
  const b = s.basis || {}, basis = [...(b.genres || []).slice(0, 2).map(x => genreRu((D.GENRES.find(g => g[0] === x) || [0, 0, x])[2])), ...(b.tags || []).slice(0, 3).map(tagLabel)];
  box.innerHTML = `<section class="row sim"><div class="row-h"><h2 class="sth2">Похожие игры</h2><div class="arrows"><button class="rb" data-car="-1" aria-label="Назад">${ic('chevL')}</button><button class="rb" data-car="1" aria-label="Вперёд">${ic('chevR')}</button></div></div>
    ${basis.length ? `<p class="mut simbasis">${ic('tag', 13)} Подобрано по: ${esc(basis.join(', '))}</p>` : ''}
    <div class="track">${s.results.map(it => { rgInfo[it.id] = rgInfo[it.id] || it; return card(it.id, it.name, it.img, (it.tags || []).map(tagLabel).join(' · ') || yearGenre(it.id) || 'Похожая игра'); }).join('')}</div></section>`;
  requestAnimationFrame(updRows);
}

// ===== действия =====
function profAct(act, b, e) {
  const host = b.closest('[data-id]'), id = b.dataset.id || host?.dataset.id, pid = state.pid;
  const A = {
    fav: () => { const gid = id || pid, g = lib[gid]; if (!g) return; g.fav = !g.fav; push(gid, {fav: g.fav}); toast(g.fav ? `«${g.name}» в любимых` : `«${g.name}» убрана из любимых`); afterLibChange(gid); if (document.querySelector('.aslist')) renderAssign(gid); },
    'as-fav': () => A.fav(),
    gfolder: () => { const g = lib[pid]; if (!g) return; const f = b.dataset.fid, a = g.folders || []; g.folders = a.includes(f) ? a.filter(x => x !== f) : [...a, f]; push(pid, {folders: g.folders}); afterLibChange(pid); },
    'as-toggle': () => { const g = lib[id]; if (!g) return; const f = b.dataset.fid, a = g.folders || []; g.folders = a.includes(f) ? a.filter(x => x !== f) : [...a, f]; push(id, {folders: g.folders}); renderAssign(id); afterLibChange(id); },
    'as-new': async () => { const name = $('#as-new').value.trim(); if (!name) return $('#as-new').focus(); const r = await jf('/api/folders', 'POST', {name}).catch(() => ({error: 'Нет связи с сервером'})); if (r.error) return toast(r.error);
      folders[r.id] = {name: r.name, created: r.created}; const g = lib[id]; if (g) { g.folders = [...(g.folders || []), r.id]; push(id, {folders: g.folders}); } renderAssign(id); afterLibChange(id); },
    gplat: () => { const g = lib[pid]; if (!g) return; const p = b.dataset.p, a = g.playedOn || []; g.playedOn = a.includes(p) ? a.filter(x => x !== p) : [...a, p]; push(pid, {playedOn: g.playedOn}); afterLibChange(pid); },
    ffilter: () => { state.lf.folder = b.dataset.v; render(); },
    'open-folder': () => { closeNew(); state.lf = {...state.lf, folder: b.dataset.fid, status: 'all'}; goView('library'); },
    'folder-new': () => openFolderEdit('', b.dataset.assign ? pid : ''),
    'folder-edit': () => openFolderEdit(b.dataset.fid),
    'fd-save': () => saveFolder(b.dataset.fid),
    'fd-del': async () => { const fid = b.dataset.fid, n = inFolder(fid); if (!confirm(`Удалить папку «${folders[fid].name}»? Игры (${n}) останутся в библиотеке.`)) return; await jf('/api/folders/' + fid, 'DELETE').catch(() => {}); delete folders[fid]; for (const g of Object.values(lib)) if (g.folders) g.folders = g.folders.filter(x => x !== fid); if (state.lf.folder === fid) state.lf.folder = ''; closeNew(); toast('Папка удалена'); render(); if (pid) refreshPage(pid); },
    assign: () => openAssign(id),
    'cover-edit': () => openCoverEdit(id || pid),
    'ce-fit': () => { const cid = cePid(), g = lib[cid]; if (!g) return; g.coverFit = b.dataset.v; push(cid, {coverFit: g.coverFit}); cePreview(cid); applyFitAll(cid); },
    'ce-url': () => { const u = $('#ce-url').value.trim(), cid = cePid(); if (u && !/^(https?:\/\/|\/uploads\/)/i.test(u)) return toast('Нужна ссылка, которая начинается с https://'); setCover(cid, u); cePreview(cid); },
    'ce-up': async () => { const cid = cePid(), f = await pickFile('image/*'); if (!f) return; try { setCover(cid, await uploadFile(f)); cePreview(cid); toast('Обложка загружена'); } catch (er) { toast(er.message); } },
    'ce-auto': async () => { const cid = cePid(), r = await jf(`/api/cover?id=${encodeURIComponent(cid)}&name=${encodeURIComponent(lib[cid].name)}&force=1`).catch(() => ({})); if (r.url) { setCover(cid, r.url); cePreview(cid); toast('Обложка подобрана'); } else toast('Не нашлось. Добавьте ключ обложек в настройках или загрузите свою'); },
    'ce-reset': () => { const cid = cePid(); lib[cid].coverFit = ''; push(cid, {coverFit: ''}); setCover(cid, ''); cePreview(cid); toast('Стандартная обложка'); },
    'pf-edit': () => openProfileEdit(b.dataset.focus),
    'pf-save': saveProfile,
    'pf-cover-up': async () => { const f = await pickFile('image/*'); if (!f) return; try { pfDraft.cover = await uploadFile(f); pfePreview(); } catch (er) { toast(er.message); } },
    'pf-cover-preset': () => { pfDraft.cover = b.dataset.url; pfePreview(); },
    'pf-cover-url': () => { const u = $('#pfe-cover-url').value.trim(); if (!/^(https?:\/\/|\/uploads\/)/i.test(u)) return toast('Нужна ссылка на картинку (https://…)'); pfDraft.cover = u; pfePreview(); },
    'pf-cover-del': () => { pfDraft.cover = ''; pfePreview(); },
    'pf-avatar-up': async () => { const f = await pickFile('image/*'); if (!f) return; try { pfDraft.avatar = await uploadFile(f); pfePreview(); } catch (er) { toast(er.message); } },
    'pf-avatar-del': () => { pfDraft.avatar = ''; pfePreview(); }
  };
  const fn = A[act]; if (!fn) return false; fn(); return true;
}
const cePid = () => $('.cepv')?.dataset.id || state.pid;
const applyFitAll = id => document.querySelectorAll(`.gc[data-id="${CSS.escape(id)}"] img`).forEach(i => { const c = i.closest('.gc'); if (i.complete && i.naturalWidth) applyFit(c, i); });

async function boot() {
  await loadLib(); await Promise.all([loadRmeta(), loadMisc(), typeof loadInst === 'function' ? loadInst() : Promise.resolve(), typeof nxLoadPrefs === 'function' ? nxLoadPrefs() : Promise.resolve()]);
  if (typeof nxMountCatalogUi === 'function') nxMountCatalogUi();
  libSig = sigOf(); live(); nav(); route(); addEventListener('hashchange', route); loadTags();
  if (typeof loadShowcase === 'function') loadShowcase();
}
// ждём все скрипты (nexus-more.js определяет loadInst), иначе профиль падает при загрузке
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
