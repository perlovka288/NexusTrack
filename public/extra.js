'use strict';
// Статистика игры, настройки, добавление своих игр, привязка игры к папке на диске
const modal = () => $('#modal');
async function uploadFile(f) {
  const r = await fetch('/api/upload', {method: 'POST', body: f}), j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Не удалось загрузить'); return j.url;
}
const pickFile = accept => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => ok(i.files[0] || null); i.click(); });
const dateRu = s => { try { return new Date(s).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'}); } catch { return ''; } };

// ===== прогресс, даты, статистика игры =====
const ymdL = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const nDays = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const dRu = s => s ? dateRu(s + 'T12:00:00') : '—';
const dShort = d => d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
const frow = (a, b, icn) => b || b === 0 ? `<div class="fr"><small>${icn ? ic(icn, 13) : ''}${a}</small><div>${b}</div></div>` : '';

// Прогресс: вручную → «Пройдено» = 100% → достижения Steam → сохранения (реальные данные, без оценки по времени)
const progCache = {};
function progressOf(id) {
  const g = lib[id]; if (!g) return null;
  if (g.progress !== '' && g.progress != null && !isNaN(+g.progress)) return {pct: Math.min(100, Math.max(0, Math.round(+g.progress))), kind: 'manual', source: 'manual'};
  if (g.status === 'done') return {pct: 100, kind: 'done', source: 'done'};
  const c = progCache[id];
  return c && c.pct != null ? {...c, kind: c.source} : null;
}
function progLabel(p) {
  if (!p) return '';
  if (p.source === 'achievements') return `Достижения: ${p.unlocked} из ${p.total}`;
  if (p.source === 'save') return `Из сохранения${p.file ? ` · ${p.file}` : ''}`;
  if (p.source === 'manual') return 'Указано вручную';
  if (p.source === 'done') return 'Статус «Пройдено»';
  return 'Прогресс неизвестен';
}
function progressHtml(id) {
  const g = lib[id]; if (!g) return '';
  const p = progressOf(id), pct = p ? p.pct : 0;
  return `<div class="pgr big${p ? '' : ' is-empty'}"><div class="pgr-h"><b>${p ? p.pct + '%' : '—'}</b><span class="mut">${esc(p ? progLabel(p) : 'Отметьте прогресс вручную или включите достижения')}</span></div>
  <div class="rs-bar"><i style="width:${pct}%"></i></div>
  <div class="prog-ctl"><input type="range" min="0" max="100" step="1" value="${pct}" data-prog="${esc(id)}" aria-label="Прогресс прохождения">
    <div class="prog-btns">${[0, 25, 50, 75, 100].map(n => `<button data-act="prog-set" data-v="${n}"${p && p.pct === n ? ' class="on"' : ''}>${n}%</button>`).join('')}${p && p.source === 'manual' ? '<button data-act="prog-auto">Авто</button>' : ''}<button data-act="prog-refresh" title="Обновить прогресс" aria-label="Обновить прогресс">${ic('refresh', 14)}</button></div></div></div>`;
}
function renderProg(id) { const el = $('#progbox'); if (el && curId() === id) el.innerHTML = progressHtml(id); }
function patchProgCards(id) {
  const p = progressOf(id);
  document.querySelectorAll(`.gc[data-id="${CSS.escape(String(id))}"]`).forEach(c => {
    let el = c.querySelector('.gc-prog');
    if (!p) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('span'); el.className = 'gc-prog'; el.innerHTML = '<i></i>'; c.querySelector('.gc-link')?.insertBefore(el, c.querySelector('.gc-txt')); }
    el.title = `Прогресс ${p.pct}%`; const bar = el.querySelector('i'); if (bar) bar.style.width = p.pct + '%';
  });
}
async function loadProgress(id, force) {
  if (!online || !id || !lib[id]) return;
  const c = progCache[id];
  if (!force && c && Date.now() - (c.t || 0) < 600e3) { renderProg(id); return; }
  try {
    const r = await jf('/api/progress/' + encodeURIComponent(id) + (force ? '?force=1' : ''));
    progCache[id] = r && !r.error && r.pct != null ? {...r, t: Date.now()} : {pct: null, source: (r && r.source) || 'none', t: Date.now()};
  } catch { return; }
  if (curId() === id) { renderProg(id); refreshPage(id); patchProgCards(id); }
}
function setProg(id, v) {
  const g = lib[id]; if (!g) return;
  const val = v === '' || v == null ? '' : Math.max(0, Math.min(100, Math.round(+v || 0)));
  g.progress = val; push(id, {progress: val});
  if (val === '') { delete progCache[id]; setTimeout(() => loadProgress(id, true), 600); }
  else progCache[id] = {pct: val, source: 'manual', t: Date.now()};
  renderProg(id); refreshPage(id); patchProgCards(id);
  toast(val === '' ? 'Прогресс снова определяется автоматически' : `Прогресс: ${val}%`);
}
function gameStats(id) {
  const g = lib[id], days = g.days || {}, ss = g.sessions || [], dk = Object.keys(days).filter(k => days[k] >= 60).sort();
  const d2 = v => v ? ymdL(new Date(v)) : '', today = ymdL();
  const start = g.started || d2(g.firstPlayed) || dk[0] || d2(g.added) || '';
  const end = g.finished || (g.status === 'playing' ? today : (d2(g.last) || dk[dk.length - 1] || today));
  const sec = ss.map(x => x.sec || 0);
  return {start, days, dk, span: start ? Math.max(1, dayNum(end) - dayNum(start) + 1) : 0, played: dk.length, tracked: dk.reduce((a, k) => a + days[k], 0),
    n: ss.length, avgSes: sec.length ? sec.reduce((a, b) => a + b, 0) / sec.length : 0, maxSes: sec.length ? Math.max(...sec) : 0};
}
function statsHtml(id) {
  const g = lib[id];
  if (!g) return '<p class="mut">Добавьте игру в библиотеку: здесь появятся прогресс, даты начала и конца, игровые дни и сессии.</p>';
  const s = gameStats(id), p = progressOf(id), m = rmeta[id] || {}, h = +g.hours || 0;
  const prog = p ? `<div class="pgr"><div class="pgr-h"><b>${p.pct}%</b><span class="mut">${esc(progLabel(p))}</span></div><div class="rs-bar"><i style="width:${p.pct}%"></i></div></div>`
    : '<p class="mut">Прогресс пока неизвестен: включите достижения или укажите его вручную на вкладке «Обзор».</p>';
  const endTxt = g.finished ? dRu(g.finished) : g.status === 'playing' ? 'ещё играю' : '—';
  const rawP = (m.platforms || []).join(', '), mine = platIcons(g.playedOn);
  const facts = frow('Начал играть', s.start ? dRu(s.start) : '—', 'calendar') + frow('Закончил', endTxt, 'calendar')
    + frow('Календарный срок', s.span ? nDays(s.span) : '', 'calendar') + frow('Реально играл', s.played ? nDays(s.played) + (s.span ? ` из ${s.span}` : '') : '—', 'calendar')
    + frow('Всего наиграно', h ? esc(fmtHM(h)) : '—', 'clock') + frow('В игровой день в среднем', s.played ? fmtDur(s.tracked / s.played) : '', 'clock')
    + frow('Сессий', s.n || '') + frow('Средняя / самая длинная', s.n ? `${fmtDur(s.avgSes)} / ${fmtDur(s.maxSes)}` : '', 'clock')
    + frow('Последний запуск', g.last ? dateRu(g.last) : '—', 'calendar') + frow('Среднее время прохождения', m.avg ? esc(fmtHM(m.avg)) : '', 'clock')
    + frow('Играл на', mine ? `<span class="pis lg">${mine}</span>` + (g.playedOn || []).map(p => esc((D.PLATFORM_BY_ID[p] || {}).label || p)).join(', ') : '', 'pad')
    + frow('Платформы игры', esc(rawP), 'monitor') + frow('Жанры', esc((m.genres || g.genres || []).map(genreRu).join(', ')), 'layers')
    + frow('Metascore', m.metacritic || '') + frow('Рейтинг игроков', m.rating ? m.rating.toFixed(1) + ' / 5' : '', 'star');
  const arr = []; let max = 0;
  for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const v = s.days[ymdL(d)] || 0; max = Math.max(max, v); arr.push([d, v]); }
  const chart = max ? `<div class="dchart" role="img" aria-label="Время игры по дням за 30 дней">${arr.map(([d, v]) => `<i class="${v ? 'on' : ''}" title="${dShort(d)}: ${v ? fmtDur(v) : 'не играл'}" style="height:${v ? Math.max(5, Math.round(v / max * 100)) : 2}%"></i>`).join('')}</div><div class="dchart-l mut"><span>${dShort(arr[0][0])}</span><span>сегодня</span></div>`
    : '<p class="mut">За последние 30 дней запусков не было.</p>';
  const ses = (g.sessions || []).slice(-8).reverse().map(x => { const d = new Date(x.s); return `<li><span>${dShort(d)}, ${d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</span><b>${fmtDur(x.sec)}</b></li>`; }).join('');
  return `${prog}<div class="facts">${facts}</div><h3 class="sth">Активность за 30 дней</h3>${chart}
  ${ses ? `<h3 class="sth">Последние сессии</h3><ul class="slist">${ses}</ul>` : ''}
  <p class="hint l">Игровые дни и сессии считаются автоматически, пока приложение запущено. Даты начала и конца можно поправить справа.</p>`;
}
function renderStatsBox(id) { const el = $('#statsbox'); if (el && curId() == id) el.innerHTML = statsHtml(id); }

// блок под настройками игры на её странице: отдельные раскрывающиеся группы
function extSide(id, g) {
  const own = !isSteam(id), p = progressOf(id);
  const lib = typeof libSide === 'function' ? acc('lib', 'Папки и платформы', libSide(id, g), {icon: 'folder'}) : '';
  const ownHtml = own ? acc('own', 'Об игре', `<input class="tin" data-k="name" value="${esc(g.name)}" placeholder="Название" aria-label="Название">
  <input class="tin" data-k="released" value="${esc(g.released)}" placeholder="Дата выхода" aria-label="Дата выхода">
  <textarea data-k="desc" class="mini" placeholder="Описание" aria-label="Описание">${esc(g.desc)}</textarea>`, {icon: 'tag'}) : '';
  const dates = acc('dates', 'Даты и прогресс', `<div class="two"><label class="dl">Начало<input type="date" class="tin" data-k="started" value="${esc(g.started)}" aria-label="Дата начала"></label>
    <label class="dl">Конец<input type="date" class="tin" data-k="finished" value="${esc(g.finished)}" aria-label="Дата окончания"></label></div>
  <p class="hint l">Ставятся сами: при первом запуске и при статусе «Прошёл». Можно исправить вручную.</p>
  <div class="lbl"><span>Прогресс, %</span><b>${p ? p.pct + '%' : 'нет'}</b></div>
  <p class="hint l">${p ? esc(progLabel(p)) : 'Данных о прохождении нет'}. Оставьте поле пустым — прогресс возьмётся из достижений или сохранений.</p>
  <input class="tin" type="number" min="0" max="100" step="1" data-k="progress" placeholder="Авто (достижения или сохранения)" value="${g.progress === '' || g.progress == null ? '' : esc(g.progress)}" aria-label="Прогресс в процентах">`, {icon: 'calendar', meta: p ? p.pct + '%' : ''});
  const cover = acc('cover', 'Обложка', `<div class="covctl"><input data-k="cover" value="${esc(g.cover)}" placeholder="Ссылка на картинку" aria-label="Ссылка на обложку">
    <button class="ib" data-act="cover-up" title="Загрузить файл" aria-label="Загрузить файл">${ic('upload', 16)}</button>
    <button class="ib" data-act="cover-auto" title="Подобрать автоматически" aria-label="Подобрать автоматически">${ic('wand', 16)}</button>
    <button class="ib" data-act="cover-reset" title="Сбросить" aria-label="Сбросить обложку">${ic('x', 16)}</button></div>
  <div class="sbtns"><button class="ib wide" data-act="cover-edit">${ic('pencil', 16)} Редактор обложки</button></div>`, {icon: 'image'});
  return lib + ownHtml + dates + cover + (typeof shotsSide === 'function' ? shotsSide(id, g) : '');
}
const setCover = (id, url) => { lib[id].cover = url; push(id, {cover: url}); patchCover(id); refreshPage(id); };
const patchCover = id => document.querySelectorAll(`.gc[data-id="${CSS.escape(id)}"] img`).forEach(i => { i.dataset.st = 0; i.src = lib[id].cover || (isSteam(id) ? CDN + id + '/library_600x900.jpg' : '/uploads/none.png'); });

function extAct(act, b) {
  const pid = state.pid, host = b.closest('[data-id]'), id = host?.dataset.id;
  const A = {
    newgame: () => openNew(),
    'ng-close': () => closeNew(),
    'ng-save': () => saveNew(),
    'ng-up': async () => { const f = await pickFile('image/*'); if (!f) return; try { $('#ng-cover').value = await uploadFile(f); ngPrev(); } catch (e) { toast(e.message); } },
    'ng-auto': async () => { const n = $('#ng-name').value.trim(); if (!n) return toast('Сначала введите название'); const r = await jf(`/api/cover?id=${ngId}&name=${encodeURIComponent(n)}&force=1`).catch(() => ({})); if (r.url) { $('#ng-cover').value = r.url; ngPrev(); } else toast('Не нашлось. Добавьте ключ обложек в настройках или загрузите свою'); },
    'cover-up': async () => { if (!lib[pid]) return; const f = await pickFile('image/*'); if (!f) return; try { setCover(pid, await uploadFile(f)); toast('Обложка загружена'); } catch (e) { toast(e.message); } },
    'cover-auto': async () => { if (!lib[pid]) return; const r = await jf(`/api/cover?id=${encodeURIComponent(pid)}&name=${encodeURIComponent(lib[pid].name)}&force=1`).catch(() => ({})); if (r.url) { setCover(pid, r.url); toast('Обложка подобрана'); } else toast('Не нашлось. Добавьте ключ обложек в настройках или загрузите свою'); },
    'cover-reset': () => { if (lib[pid]) { setCover(pid, ''); toast('Стандартная обложка'); } },
    bind: async () => { const sel = $('#bindsel'); if (!sel) return; const list = await jf('/api/tracker/processes').catch(() => []);
      sel.innerHTML = `<option value="">${list.length ? 'Выберите запущенную игру…' : 'Сейчас ничего подходящего не запущено. Запустите игру и нажмите снова'}</option>` + list.map(p => `<option value="${esc(p.dir)}">${esc(p.name)} — ${esc(p.dir)}</option>`).join(''); sel.hidden = false; },
    tog: async () => { const k = b.dataset.k; if (k === 'autostart') { const on = !b.classList.contains('on'); await jf('/api/desktop/autostart', 'PUT', {on}); return renderSettings(); }
      if (k === 'onlyPlayed') { b.classList.toggle('on'); b.setAttribute('aria-checked', b.classList.contains('on')); return; }
      await jf('/api/config', 'PUT', {tracker: {[k]: !b.classList.contains('on')}}); renderSettings(); },
    savelists: async () => { const l = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean); await jf('/api/config', 'PUT', {tracker: {folders: l('#s-folders'), ignore: l('#s-ignore')}}); await jf('/api/tracker/rescan', 'POST'); toast('Сохранено'); renderSettings(); },
    rescan: async () => { await jf('/api/tracker/rescan', 'POST'); toast('Список установленных игр обновлён'); renderSettings(); },
    savekey: async () => { const p = b.dataset.p, v = $('#k-' + p).value.trim(), body = {};
      if (p === 'steam') { if (v) body.steamKey = v; body.steamId = $('#k-steamid').value.trim(); } else if (v) body[p] = v; else return toast('Поле пустое');
      await jf('/api/config', 'PUT', {keys: body}); toast('Ключ сохранён'); renderSettings(); },
    clearkey: async () => { const p = b.dataset.p; await jf('/api/config', 'PUT', {keys: p === 'steam' ? {steamKey: null, steamId: null} : {[p]: null}}); toast('Ключ удалён'); renderSettings(); },
    testkey: async () => { b.disabled = true; const r = await jf('/api/config/test', 'POST', {provider: b.dataset.p}).catch(() => ({ok: false, msg: 'Нет связи с сервером'})); b.disabled = false; toast((r.ok ? 'Работает. ' : 'Не работает. ') + r.msg); },
    steamimport: async () => { b.disabled = true; toast('Импортирую библиотеку…'); const r = await jf('/api/steam/import', 'POST', {onlyPlayed: $('[data-k=onlyPlayed]').classList.contains('on')}).catch(() => ({error: 'Нет связи с сервером'})); b.disabled = false;
      if (r.error) return toast(r.error); toast(`Готово: добавлено ${r.added}, обновлены часы у ${r.updated} (всего в профиле ${r.total})`); syncLib(); },
    importfile: async () => { const f = await pickFile('.json,application/json'); if (!f) return; try { const j = JSON.parse(await f.text()); const r = await jf('/api/lib/import', 'POST', {lib: j.lib || j, folders: j.folders, profile: j.profile, mode: 'merge'}); if (r.error) throw new Error(r.error); toast(`Импортировано игр: ${r.n}`); await loadMisc(); syncLib(); } catch (e) { toast('Не удалось прочитать файл: ' + e.message); } },
    dedupe: async () => { const r = await jf('/api/lib/dedupe', 'POST').catch(() => ({})); toast(r.merged ? `Объединено дублей: ${r.merged}` : 'Дублей не найдено'); syncLib(); },
    steamsync: async () => { b.disabled = true; const r = await jf('/api/steam/sync', 'POST').catch(() => ({error: 'Нет связи с сервером'})); b.disabled = false;
      if (r.error) return toast(r.error); toast(r.updated ? `Часы обновлены у ${r.updated} игр` : 'Часы уже актуальны'); syncLib(); },
    'prog-set': () => setProg(pid, +b.dataset.v),
    'prog-auto': () => setProg(pid, ''),
    'prog-refresh': async () => { toast('Обновляю прогресс…'); await loadProgress(pid, true); },
    opendata: () => jf('/api/desktop/open-data', 'POST')
  };
  const fn = A[act]; if (!fn) return false; fn(); return true;
}
document.addEventListener('change', e => {
  if (e.target.id !== 'bindsel' || !e.target.value) return;
  const id = state.pid, g = lib[id]; if (!g) return;
  g.dir = e.target.value; push(id, {dir: g.dir}); e.target.hidden = true; refreshPage(id); toast('Папка привязана — часы пойдут автоматически');
});
document.addEventListener('change', e => {
  const rg = e.target.closest?.('[data-prog]'); if (!rg) return;
  setProg(rg.dataset.prog, +rg.value);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal().hidden) closeNew(); });

// ===== добавление своей игры =====
let ngId = '';
function openNew() {
  ngId = 'c' + Date.now().toString(36);
  modal().innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="Новая игра">
  <div class="mh"><h2>Своя игра</h2><button class="ib" data-act="ng-close" aria-label="Закрыть">${ic('x', 18)}</button></div>
  <div class="mgrid"><div class="mcover" id="ng-prev"><span class="mut">Обложка</span></div>
  <div class="mform">
    <label>Название<input id="ng-name" class="tin" placeholder="Например, My Game" autocomplete="off"></label>
    <label>Обложка<span class="covctl"><input id="ng-cover" placeholder="Ссылка на картинку" oninput="ngPrev()">
      <button class="ib" data-act="ng-up" title="Загрузить файл" aria-label="Загрузить файл">${ic('upload', 16)}</button><button class="ib" data-act="ng-auto" title="Подобрать автоматически" aria-label="Подобрать автоматически">${ic('wand', 16)}</button></span></label>
    <div class="two"><label>Статус<select id="ng-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === 'playing' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Наиграно, ч<input id="ng-hours" type="number" min="0" step="0.5" class="tin" placeholder="0"></label></div>
    <label>Папка игры (для автоучёта часов)<input id="ng-dir" class="tin" placeholder="D:\\Games\\MyGame"></label>
    <label>Описание<textarea id="ng-desc" class="mini" placeholder="Необязательно"></textarea></label>
    <p class="hint l">Игры проще найти через поиск вверху, а запущенные на ПК приложение найдёт само.</p>
    <button class="btn" data-act="ng-save">${ic('check', 16)} Добавить</button></div></div></div>`;
  modal().hidden = false; document.body.classList.add('lock'); $('#ng-name').focus();
}
function ngPrev() { const u = $('#ng-cover').value.trim(); $('#ng-prev').innerHTML = u ? `<img src="${esc(u)}" alt="" onerror="this.remove()">` : '<span class="mut">Обложка</span>'; }
function closeNew() { modal().hidden = true; modal().innerHTML = ''; document.body.classList.remove('lock'); }
function saveNew() {
  const name = $('#ng-name').value.trim(); if (!name) { $('#ng-name').focus(); return toast('Введите название'); }
  const h = $('#ng-hours').value;
  lib[ngId] = {name, status: $('#ng-status').value, hours: h === '' ? '' : Math.max(0, +h), rating: '', note: '', cover: $('#ng-cover').value.trim(), desc: $('#ng-desc').value.trim(), dir: $('#ng-dir').value.trim(), src: 'custom', fav: false, folders: [], added: new Date().toISOString()};
  push(ngId); names[ngId] = name; const id = ngId; closeNew(); nav(); toast(`«${name}» добавлена`); location.hash = 'game=' + id;
}

// ===== страница настроек =====
const tg = (k, on, label, hint) => `<div class="srow"><div><b>${label}</b>${hint ? `<p class="mut">${hint}</p>` : ''}</div><button class="tg${on ? ' on' : ''}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-act="tog" data-k="${k}"><i></i></button></div>`;
const chipOf = k => k.set ? `<span class="okc">${ic('check', 12)} ${k.builtin ? 'встроенный ключ' : 'подключён'} · ••••${esc(k.tail)}</span>` : '<span class="mut">не подключён</span>';
const keyRow = (p, title, hint, url, k, extra = '') => `<div class="kcard"><div class="kh"><div><b>${title}</b><p class="mut">${hint} <a href="${url}" target="_blank" rel="noreferrer">Получить ключ</a></p></div>${chipOf(k)}</div>
  <div class="covctl"><input id="k-${p}" type="password" autocomplete="off" placeholder="${k.set ? 'Вставьте новый ключ, чтобы заменить' : 'Вставьте ключ'}" aria-label="${title}">
  <button class="ib" data-act="savekey" data-p="${p}" title="Сохранить" aria-label="Сохранить">${ic('check', 16)}</button>
  <button class="ib" data-act="testkey" data-p="${p}" title="Проверить" aria-label="Проверить">${ic('play', 16)}</button>
  <button class="ib" data-act="clearkey" data-p="${p}" title="Удалить ключ" aria-label="Удалить ключ">${ic('trash', 16)}</button></div>${extra}</div>`;
async function renderSettings() {
  const box = $('#settingsBox'); if (!box) return;
  if (!online) { box.innerHTML = '<p class="mut">Настройки доступны, когда приложение запущено через NEXUS.exe или server.js.</p>'; return; }
  let c, s; try { [c, s] = await Promise.all([jf('/api/config'), jf('/api/tracker/status')]); } catch { box.innerHTML = '<p class="mut">Нет связи с сервером.</p>'; return; }
  if (state.view !== 'settings') return;
  const t = c.tracker, k = c.keys;
  const status = !s.supported ? 'Автоучёт работает в Windows (и Linux). На этой системе он отключён.' : !s.enabled ? 'Отслеживание выключено.' : s.now.length ? `Сейчас играете: <b>${esc(s.now[0].name)}</b>` : 'Слежу за запуском игр. Запустите любую игру, и она появится в библиотеке.';
  box.innerHTML = `
  <section class="scard"><h2>Отслеживание игр</h2><p class="mut sdesc">${status}</p>
    ${tg('enabled', t.enabled, 'Следить за запущенными играми', 'Приложение видит процессы игр, ищет их в каталоге и считает время.')}
    ${tg('autoAdd', t.autoAdd, 'Добавлять найденные игры в библиотеку', 'Новые игры подтягиваются сами, обложка и название берутся из каталога.')}
    ${tg('autoStatus', t.autoStatus, 'Ставить статус «Играю» при запуске', 'Только для игр со статусом «Буду играть» или «Брошено».')}
    ${c.desktop ? tg('autostart', c.autostart, 'Запускать вместе с Windows', 'Приложение сворачивается в трей и считает часы в фоне.') : ''}
    <div class="srow col"><div><b>Дополнительные папки с играми</b><p class="mut">По одной на строку. Установленные игры из популярных лаунчеров и папки «Games» на всех дисках ищутся сами (найдено игр: ${s.steamGames}, папок: ${s.roots}).</p></div>
      <textarea id="s-folders" class="mini" placeholder="D:\\Мои игры">${esc((t.folders || []).join('\n'))}</textarea></div>
    <div class="srow col"><div><b>Не учитывать</b><p class="mut">Название папки, имя .exe или ID игры. Wallpaper Engine и служебные программы уже исключены автоматически.</p></div>
      <textarea id="s-ignore" class="mini" placeholder="wallpaper_engine">${esc((t.ignore || []).join('\n'))}</textarea></div>
    <div class="sbtns"><button class="ib wide" data-act="savelists" title="Сохранить списки">${ic('check', 16)} Сохранить</button><button class="ib" data-act="rescan" title="Пересканировать установленные игры" aria-label="Пересканировать">${ic('upr', 16)}</button></div>
  </section>
  <section class="scard"><h2>Библиотека</h2>
    <div class="srow col"><div><b>Вкладка по умолчанию</b><p class="mut">При входе в библиотеку сразу открывается выбранная категория. Это же значение можно быстро сменить в навигации библиотеки.</p></div>
      <select id="s-libtab" class="fsel" data-libtab="1" aria-label="Вкладка библиотеки по умолчанию">${[['all','Все игры'],['playing','Играю'],['done','Пройдено'],['planned','Буду играть'],['dropped','Брошено'],['manual','Добавлены вручную'],['dev','На устройстве']].map(([k,v]) => `<option value="${k}"${(typeof nxPreferredLibTab === 'function' ? nxPreferredLibTab() : 'all') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
  </section>
  <section class="scard"><h2>Ключи API</h2><p class="mut sdesc">Все необязательно: приложение работает и без них. Ключи хранятся только на вашем компьютере (файл config.json).</p>
    ${keyRow('steamgriddb', 'Ключ обложек', 'Красивые вертикальные постеры 600×900 для любых игр, в том числе тех, у которых есть только баннер.', 'https://www.steamgriddb.com/profile/preferences/api', k.steamgriddb)}
    ${keyRow('rawg', 'Ключ базы игр', 'Каталог с фильтрами по платформам, описания, скриншоты, среднее время прохождения для прогресса. Уже работает со встроенным ключом, свой вставляйте только при желании.', 'https://rawg.io/apidocs', k.rawg)}
    ${keyRow('steam', 'Импорт библиотеки, часов и достижений', 'Подтягивает все ваши игры, сколько вы в них наиграли и открытые достижения для прогресса. Профиль и «Сведения об играх» должны быть открытыми.', 'https://steamcommunity.com/dev/apikey', k.steamKey,
      `<div class="covctl" style="margin-top:8px"><input id="k-steamid" value="${esc(k.steamId)}" placeholder="ID профиля (17 цифр, из ссылки на профиль)" aria-label="ID профиля"></div>
       <div class="srow"><div><b>Только игры, в которые играли</b></div><button class="tg on" role="switch" aria-checked="true" data-act="tog" data-k="onlyPlayed" aria-label="Только сыгранные"><i></i></button></div>
       <div class="sbtns"><button class="ib wide" data-act="steamimport" title="Импортировать">${ic('download', 16)} Импортировать мою библиотеку</button><button class="ib wide" data-act="steamsync" title="Обновить часы из Steam">${ic('refresh', 16)} Обновить часы из Steam</button></div>`)}
    ${keyRow('deepl', 'Перевод описаний (необязательно)', 'Описания игр переводятся на русский сами. Без ключа используется бесплатный перевод с дневным лимитом, с бесплатным ключом перевод стабильнее.', 'https://www.deepl.com/pro-api', k.deepl)}
  </section>
  ${typeof nxSwitchSettings === 'function' ? nxSwitchSettings(c) : ''}
  ${typeof nxEmuSettings === 'function' ? nxEmuSettings(c) : ''}
  ${typeof nxMoreSettings === 'function' ? nxMoreSettings(c) : ''}
  ${typeof nxThemeSettings === 'function' ? nxThemeSettings() : ''}
  <section class="scard"><h2>Данные</h2>
    <p class="mut sdesc">Библиотека лежит в файле library.json (рядом лежит резервная копия .bak), профиль в profile.json, папки в folders.json. Экспорт сохраняет всё вместе.</p>
    <div class="sbtns"><a class="ib wide" href="/api/export" download>${ic('download', 16)} Экспорт</a><button class="ib wide" data-act="importfile">${ic('upload', 16)} Импорт</button><button class="ib wide" data-act="dedupe" title="Склеить дубли «неизвестных игр», оставшиеся от старых версий">${ic('layers', 16)} Объединить дубли</button>${c.desktop ? `<button class="ib wide" data-act="opendata">${ic('folder', 16)} Папка с данными</button>` : ''}</div>
  </section>`;
  if (typeof renderMobile === 'function') renderMobile();
}
