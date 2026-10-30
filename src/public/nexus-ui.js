'use strict';
// NEXUS: интерфейс запуска игр (проверка пути), бэкапа сейвов, эмуляторов в настройках и аналитики «NEXUS Rewind» в профиле
Object.assign(IC, {
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  dot: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>', alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>', copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
});
const RW = NexusRewind;
const fmtBytes = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' ГБ' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';

// ===== проверка пути и запуск =====
const pathSt = {};                                   // id:поле → {path, exists, type, error}
const stKey = (id, f) => id + ':' + f;
async function nxCheck(id, field) {
  const g = lib[id]; if (!g || !online) return;
  const p = String(g[field] || '').trim(), k = stKey(id, field);
  if (!p) { pathSt[k] = {path: '', exists: false, error: 'empty'}; return nxPaint(id, field); }
  if (pathSt[k] && pathSt[k].path === p && pathSt[k].done) return nxPaint(id, field);
  pathSt[k] = {path: p, exists: false, done: false}; nxPaint(id, field);
  try { const r = await jf('/api/path/check', 'POST', {path: p}); if ((lib[id] || {})[field] !== p) return; pathSt[k] = {path: p, ...r, done: true}; } catch { pathSt[k] = {path: p, exists: false, error: 'net', done: true}; }
  nxPaint(id, field);
}
function nxStatHtml(id, field) {
  const st = pathSt[stKey(id, field)], isSave = field === 'savePath';
  if (!st || !st.path) return `<span class="ps mut">${ic('alert', 14)}${isSave ? 'Укажите папку с сохранениями' : 'Укажите путь к игре или образу'}</span>`;
  if (!st.done) return `<span class="ps mut">${ic('clock', 14)}Проверяю путь…</span>`;
  if (st.exists) {
    if (isSave) return st.kind === 'dir' ? `<span class="ps ok">${ic('dot', 12)}Папка найдена</span>` : `<span class="ps bad">${ic('x', 14)}Это файл, нужна папка</span>`;
    if (st.type === 'exe' || st.type === 'image') return `<span class="ps ok">${ic('dot', 12)}Файл найден: игра есть на устройстве${st.type === 'image' ? '<small>образ, запустится через эмулятор</small>' : ''}</span>`;
    if (st.type === 'folder' && (lib[id] || {}).emu) return `<span class="ps ok">${ic('dot', 12)}Папка образа найдена<small>запустится через эмулятор</small></span>`;
    return `<span class="ps bad">${ic('x', 14)}Это не файл запуска. Нужен .exe или образ игры</span>`;
  }
  return `<span class="ps bad">${ic('x', 14)}${isSave ? 'Папка не найдена' : 'Игры нет на устройстве: проверьте путь'}</span>`;
}
// Состояние «на устройстве»: только реальный файл запуска (exe/образ) или Steam. Одна папка без файла не считается установкой.
function devState(id, g) {
  const st = pathSt[stKey(id, 'launch')], chk = !!(st && st.done);
  const viaPath = !!(chk && st.exists && (st.type === 'exe' || st.type === 'image' || (st.type === 'folder' && g.emu))), via = g.installedVia || '';
  const installed = viaPath || (!chk && via === 'path') || via === 'steam', can = installed;
  const text = viaPath ? 'Файл найден: игра есть на устройстве' : via === 'steam' ? 'Игра установлена на устройстве'
    : installed ? 'Игра установлена на устройстве' : 'Не установлено. Укажите файл запуска';
  return {installed, can, text};
}
const nxOk = id => devState(id, lib[id] || {}).can;
function nxPaint(id, field) {
  if (typeof curId !== 'function' || curId() != id) return;
  const el = $(field === 'launch' ? '#pstat' : '#sstat'); if (el) el.innerHTML = nxStatHtml(id, field);
  const g = lib[id] || {}, d = devState(id, g), dv = $('#devst');
  if (dv) { dv.className = 'devst ' + (d.installed ? 'ok' : 'off'); dv.querySelector('span').textContent = d.text; }
  const b = $('#nxplay'); if (b) { b.disabled = !d.can; b.title = d.can ? '' : 'Укажите корректный путь к файлу'; }
  const sb = $('#nxbackup'), st = pathSt[stKey(id, 'savePath')]; if (sb) sb.disabled = !(st && st.done && st.exists && st.kind === 'dir');
}
function nxSaves(id, g) {
  const sw = (g.playedOn || []).includes('switch'), sv = g.switchSave;
  return `<div class="covctl"><input data-k="savePath" value="${esc(g.savePath)}" placeholder="Папка с сохранениями" aria-label="Папка с сохранениями" spellcheck="false">
    <button class="ib" data-act="nx-pick" data-field="savePath" data-kind="folder" title="Выбрать папку" aria-label="Выбрать папку">${ic('folder', 16)}</button></div>
  <div class="pstat" id="sstat" aria-live="polite">${nxStatHtml(id, 'savePath')}</div>
  <div class="sbtns"><button class="ib wide" id="nxbackup" data-act="nx-backup"${(pathSt[stKey(id, 'savePath')] || {}).exists ? '' : ' disabled'}>${ic('archive', 16)} Создать бэкап сейвов</button><button class="ib" data-act="nx-backups-open" title="Открыть папку backups" aria-label="Открыть папку backups">${ic('folder', 16)}</button></div>
  ${g.lastBackup ? `<p class="hint l">Последний бэкап: ${esc(dateRu(g.lastBackup.at))}, ${g.lastBackup.files} файлов, ${fmtBytes(g.lastBackup.size)}<br><span class="mut">${esc(g.lastBackup.name)}</span></p>` : '<p class="hint l">Файлы сохранений копируются в архив backups/Игра_ГГГГ-ММ-ДД.zip рядом с данными NEXUS.</p>'}
  ${sw ? `<div class="swtid"><label class="mut" for="sw-tid">Title ID на Nintendo Switch</label><input id="sw-tid" data-k="titleId" value="${esc(g.titleId || '')}" placeholder="0100F2C0115B6000" maxlength="16" spellcheck="false" aria-label="Title ID игры на Nintendo Switch"></div>
    <p class="hint l">${sv ? `Сохранение Switch найдено: ${sv.files || 0} файл(ов), ${fmtBytes(sv.bytes || 0)}${sv.at ? ' · ' + esc(dateRu(sv.at)) : ''}.` : 'Title ID помогает точно сопоставить сохранение с игрой. Его можно посмотреть в JKSV или в свойствах игры на консоли.'}</p>` : ''}`;
}
// ВЕРХ карточки: кнопка «Запустить» — строго первой, под ней прогресс и наработка часов, затем статус «на устройстве»
function nxTop(id, g) {
  queueMicrotask(() => { nxCheck(id, 'launch'); nxCheck(id, 'savePath'); nxAutoFind(id); });
  const d = devState(id, g), emu = g.emu && EMU_UI.find(e => e[0] === g.emu);
  const sw = (g.playedOn || []).includes('switch') || !!(emu && emu[2] === 'switch');
  const p = typeof progressOf === 'function' ? progressOf(id) : null;
  const hours = typeof fmtHM === 'function' ? fmtHM(g.hours, '0 мин') : '0 мин';
  return `<div class="nxtop">
  <button class="btn nxplay" id="nxplay" data-act="nx-play"${d.can ? '' : ' disabled'} title="${d.can ? '' : 'Укажите корректный путь к файлу'}">${ic('play', 16)}<span class="nxplay-t">Запустить</span>${emu && !sw ? `<small class="nxplay-emu" title="${esc(emu[1])}">${esc(emu[1])}</small>` : ''}</button>
  <div class="nxstats">
    <div class="tile"><b>${p ? p.pct + '%' : '—'}</b><span>Прогресс</span></div>
    <div class="tile"><b>${esc(hours)}</b><span>Время игры</span></div>
  </div>
  <div class="devst ${d.installed ? 'ok' : 'off'}" id="devst" aria-live="polite">${ic('dot', 12)}<span>${esc(d.text)}</span></div></div>`;
}
// НИЗ карточки: технические группы — файл запуска, эмулятор, сохранения, папка на диске
function nxBottom(id, g) {
  const consoles = (g.playedOn || []).filter(p => !['pc', 'mac', 'linux', 'mobile', 'deck', 'other'].includes(p)), emus = EMU_UI.filter(e => !consoles.length || consoles.includes(e[2]) || (e[0] === 'dolphin' && consoles.some(c => c === 'wii' || c === 'gc')) || (['citra', 'melonds'].includes(e[0]) && consoles.includes('ds')) || (e[0] === 'mgba' && consoles.includes('gb')));
  const emu = emus.find(e => e[0] === g.emu), sw = (g.playedOn || []).includes('switch') || !!(emu && emu[2] === 'switch');
  const launch = acc('launch', 'Файл запуска', `<div class="covctl"><input data-k="launch" value="${esc(g.launch)}" placeholder="Путь к .exe или образу (.iso, .pkg, .xci…)" aria-label="Путь к файлу запуска" spellcheck="false">
    <button class="ib" data-act="nx-pick" data-field="launch" data-kind="file" title="Выбрать файл" aria-label="Выбрать файл">${ic('folder', 16)}</button></div>
  <div class="pstat" id="pstat" aria-live="polite">${nxStatHtml(id, 'launch')}</div>
  ${g.lastLaunch ? `<p class="hint l">Последний запуск: ${esc(dateRu(g.lastLaunch))}</p>` : ''}`, {icon: 'play', open: !g.launch});
  const emuAcc = consoles.length ? acc('emu', sw ? 'Запуск на ПК' : 'Эмулятор', `<select class="tin" data-k="emu" aria-label="Эмулятор для запуска образа"><option value="">Подобрать автоматически</option>${emus.map(e => `<option value="${e[0]}"${g.emu === e[0] ? ' selected' : ''}>${esc(e[1])}</option>`).join('')}</select><p class="hint l">Образ откроется выбранным эмулятором сразу в игре, на весь экран.</p>`, {icon: 'pad', meta: !sw && emu ? emu[1] : ''}) : '';
  const saves = acc('saves', 'Сохранения', nxSaves(id, g), {icon: 'archive', meta: g.lastBackup ? dateRu(g.lastBackup.at) : ''});
  const dir = acc('dir', 'Папка игры на диске', `<div class="covctl"><input data-k="dir" value="${esc(g.dir)}" placeholder="Папка игры (для автоучёта времени)" aria-label="Папка игры"><button class="ib" data-act="bind" title="Выбрать из запущенных программ" aria-label="Выбрать из запущенных программ">${ic('folder', 16)}</button></div>
  <select id="bindsel" hidden aria-label="Запущенные программы"></select>
  ${g.dirs?.length ? `<p class="hint l">Привязано папок: ${1 + g.dirs.length}. Другие версии этой игры (в том числе репаки) считаются в ту же запись.</p>` : ''}
  <div class="sbtns"><button class="ib wide" data-act="nx-find">${ic('search', 16)} Найти файл и сохранения</button></div><div id="findbox"></div>
  ${g.last || g.sessions?.length ? `<p class="hint">${g.last ? 'Последний запуск: ' + esc(dateRu(g.last)) : ''}${g.sessions?.length ? ' · сессий: ' + g.sessions.length : ''}</p>` : ''}`, {icon: 'folder', meta: g.dirs?.length ? `+${g.dirs.length}` : ''});
  return launch + emuAcc + saves + dir;
}
const autoFound = new Set();
async function nxAutoFind(id) {                       // один раз за запуск: заполняем пустые «файл запуска» и «сохранения», если нашли уверенно
  const g = lib[id]; if (!g || !online || autoFound.has(id) || (g.launch && g.savePath)) return; autoFound.add(id);
  const r = await jf('/api/find/' + encodeURIComponent(id) + '/auto', 'POST').catch(() => null);
  if (r && r.set && Object.keys(r.set).length && lib[id]) { Object.assign(lib[id], r.set); for (const k of Object.keys(r.set)) delete pathSt[stKey(id, k)]; refreshPage(id); }
}
// проверка после правки поля: с задержкой, чтобы не спрашивать сервер на каждый символ
let nxT = 0;
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.k; if (k !== 'launch' && k !== 'savePath') return;
  const id = e.target.closest('[data-id]')?.dataset.id; if (!id) return;
  delete pathSt[stKey(id, k)]; clearTimeout(nxT); nxT = setTimeout(() => nxCheck(id, k), 350);
  nxPaint(id, k);
});

// ===== эмуляторы в настройках =====
const EMU_UI = [['duckstation', 'DuckStation', 'ps1'], ['pcsx2', 'PCSX2', 'ps2'], ['rpcs3', 'RPCS3', 'ps3'], ['shadps4', 'shadPS4', 'ps4'], ['ppsspp', 'PPSSPP', 'psp'], ['vita3k', 'Vita3K', 'vita'],
  ['dolphin', 'Dolphin', 'gc'], ['cemu', 'Cemu', 'wiiu'], ['ryujinx', 'Ryujinx', 'switch'], ['yuzu', 'yuzu / Eden / Suyu', 'switch'], ['citra', 'Citra / Azahar / Lime3DS', 'ds'], ['melonds', 'melonDS', 'ds'],
  ['mgba', 'mGBA', 'gb'], ['snes9x', 'Snes9x', 'snes'], ['mesen', 'Mesen', 'nes'], ['project64', 'Project64', 'n64'], ['xenia', 'Xenia', 'x360'], ['xemu', 'xemu', 'xog']];
function nxEmuSettings(c) {
  const em = c.emulators || {};
  return `<section class="scard"><h2>Эмуляторы</h2><p class="mut sdesc">Когда эмулятор запущен, NEXUS видит образ или название игры в окне, находит её в каталоге и считает время. Путь к эмулятору запоминается сам. Здесь его можно указать заранее, чтобы кнопка «Играть» запускала образы.</p>
  ${EMU_UI.map(([id, name, pl]) => `<div class="erow"><div class="en"><b>${esc(name)}</b><small class="mut">${platIcon(pl)} ${esc(D.platLabel(pl))}</small></div>
    <div class="covctl"><input id="emu-${id}" value="${esc(em[id] || '')}" placeholder="Путь к exe, появится сам после запуска" aria-label="Путь к ${esc(name)}" spellcheck="false">
      <button class="ib" data-act="nx-emu-pick" data-emu="${id}" title="Выбрать файл" aria-label="Выбрать файл">${ic('folder', 16)}</button><button class="ib" data-act="nx-emu-save" data-emu="${id}" title="Сохранить" aria-label="Сохранить">${ic('check', 16)}</button></div></div>`).join('')}</section>`;
}

// ===== NEXUS Rewind =====
let rwPeriod = 'week';
function rewindHtml() {
  const d = RW.compute(lib, rmeta, rwPeriod), up = d.delta >= 0;
  const tabs = Object.entries(RW.PERIODS).map(([k, v]) => `<button class="fc${rwPeriod === k ? ' on' : ''}" data-act="nx-rw" data-p="${k}" role="tab" aria-selected="${rwPeriod === k}">${v}</button>`).join('');
  const bars = `<div class="rwbars rw-${d.period}" role="img" aria-label="Игровое время по ${d.period === 'year' ? 'месяцам' : 'дням'}">${d.series.map(s => `<div class="rwb${s.today ? ' today' : ''}" title="${esc(s.label + ': ' + RW.dur(s.sec))}"><em>${s.sec && d.series.length <= 7 ? esc(RW.dur(s.sec)) : ''}</em><i style="height:${s.sec ? Math.max(4, Math.round(s.sec / d.maxSec * 100)) : 0}%"></i><span>${esc(s.label)}</span></div>`).join('')}</div>`;
  const tile = (icn, label, val) => `<div class="rwt">${ic(icn, 16)}<small>${label}</small><b>${val}</b></div>`;
  const list = (rows, fmt) => rows.length ? `<ul class="rwl">${rows.map(fmt).join('')}</ul>` : '<p class="mut">Нет данных</p>';
  const body = !d.total ? `<p class="mut rwempty">За этот период игрового времени пока нет. Оно считается автоматически, пока NEXUS запущен, и копится по дням.</p>` : `
    <div class="rwhead"><div><small class="mut">Всего наиграно</small><div class="rwbig">${esc(RW.dur(d.total))}</div>
      <div class="rwdelta ${up ? 'up' : 'down'}">${ic(up ? 'trendUp' : 'trendDown', 16)}${esc(RW.deltaText(d.delta))} по сравнению с ${RW.PREV_WORD[d.period]}</div></div></div>
    ${bars}
    <div class="rwtiles">${tile('clock', 'Средняя сессия', d.sessions ? esc(RW.dur(d.avgSession)) : '—')}${tile('calendar', 'Среднее за день игры', d.activeDays ? esc(RW.dur(d.avgPerDay)) : '—')}${tile('trophy', 'Пройдено игр', d.completed.length)}</div>
    <div class="rwcols">
      <div class="rwc"><h3>${ic('trophy', 16)}${RW.GAME_OF[d.period]}</h3>${d.topGame ? `<a class="rwgame" href="#game=${esc(d.topGame.id)}"><b>${esc(d.topGame.name)}</b><span>${esc(RW.dur(d.topGame.sec))}</span></a>` : '<p class="mut">Нет данных</p>'}</div>
      <div class="rwc"><h3>${ic('pad', 16)}Топ платформ</h3>${list(d.platforms, p => `<li>${platIcon(p.id)}<span>${esc(p.label)}</span><b>${esc(RW.dur(p.sec))}</b></li>`)}</div>
      <div class="rwc"><h3>${ic('tag', 16)}Топ жанров</h3>${list(d.genres, g => `<li><span>${esc(g.name)}</span><b>${Math.round(g.pct * 100)}%</b></li>`)}</div>
    </div>`;
  return `<section class="pfsec rewind"><h2>${ic('clock', 20)} NEXUS Rewind<i>${esc(d.range.label)}</i></h2>
    <div class="rwtabs" role="tablist"><div class="fchips">${tabs}</div><button class="ib wide" data-act="nx-rw-card"${d.total ? '' : ' disabled'}>${ic('image', 16)} Сформировать карточку</button></div>${body}</section>`;
}
function rwCardModal() {
  const d = RW.compute(lib, rmeta, rwPeriod);
  mbox('Карточка Rewind', `<div class="rwcard">${RW.cardSvg(d)}</div>
    <div class="sbtns"><button class="btn" data-act="nx-rw-png">${ic('download', 16)} Сохранить PNG</button><button class="ib wide" data-act="nx-rw-svg">${ic('download', 16)} Сохранить SVG</button>${navigator.clipboard && window.ClipboardItem ? `<button class="ib wide" data-act="nx-rw-copy">${ic('copy', 16)} Копировать</button>` : ''}</div>
    <p class="hint l">Карточку можно сохранить как картинку и отправить друзьям или выложить в соцсети.</p>`, true);
}
const rwName = ext => `NEXUS-Rewind-${rwPeriod}-${RW.ymd(new Date())}.${ext}`;
function rwDownload(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function rwPng() {
  return new Promise((ok, no) => {
    const svg = RW.cardSvg(RW.compute(lib, rmeta, rwPeriod)), img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; c.getContext('2d').drawImage(img, 0, 0, 1080, 1350); c.toBlob(b => b ? ok(b) : no(new Error('Не удалось создать картинку')), 'image/png'); };
    img.onerror = () => no(new Error('Не удалось отрисовать карточку'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// ===== действия =====
function nxAct(act, b) {
  const pid = state.pid, id = b.closest('[data-id]')?.dataset.id || pid;
  const A = {
    'nx-rw': () => { rwPeriod = b.dataset.p; renderProfile(); },
    'nx-rw-card': () => rwCardModal(),
    'nx-rw-png': async () => { try { rwDownload(await rwPng(), rwName('png')); toast('Карточка сохранена'); } catch (e) { toast(e.message); } },
    'nx-rw-svg': () => { rwDownload(new Blob([RW.cardSvg(RW.compute(lib, rmeta, rwPeriod))], {type: 'image/svg+xml'}), rwName('svg')); toast('Карточка сохранена'); },
    'nx-rw-copy': async () => { try { await navigator.clipboard.write([new ClipboardItem({'image/png': await rwPng()})]); toast('Карточка скопирована'); } catch { toast('Не удалось скопировать. Сохраните файл'); } },
    'nx-pick': async () => {
      if (!online) return toast('Выбор файла доступен в приложении NEXUS. Вставьте путь вручную');
      const f = b.dataset.field, r = await jf('/api/pick', 'POST', {kind: b.dataset.kind, exe: f === 'launch', title: f === 'launch' ? 'Файл запуска игры' : 'Папка с сохранениями'}).catch(() => ({}));
      if (r.error === 'unavailable') return toast('Выбор файла доступен в приложении NEXUS. Вставьте путь вручную');
      if (!r.path || !lib[id]) return;
      lib[id][f] = r.path; push(id, {[f]: r.path}); const inp = document.querySelector(`#pside [data-k="${f}"]`); if (inp) inp.value = r.path; delete pathSt[stKey(id, f)]; nxCheck(id, f);
    },
    'nx-play': async () => {
      const g = lib[id]; if (!g || b.disabled) return; b.disabled = true;
      const r = await jf('/api/launch/' + encodeURIComponent(id), 'POST').catch(() => ({ok: false, message: 'Нет связи с сервером'}));
      toast(r.ok ? `Запускаю «${g.name}»` + (r.how === 'emulator' ? ' в эмуляторе' : '') : (r.message || 'Не удалось запустить'));
      setTimeout(() => { b.disabled = !nxOk(id); }, 1500);
    },
    'nx-find': async () => {
      if (!lib[id]) return; const box = $('#findbox'); box.innerHTML = '<p class="mut">Ищу на этом компьютере…</p>';
      const r = await jf('/api/find/' + encodeURIComponent(id)).catch(() => null); if (!r) { box.innerHTML = '<p class="mut">Не удалось выполнить поиск.</p>'; return; }
      const row = (kind, p, note) => `<div class="frow"><span title="${esc(p)}">${esc(p)}<small>${esc(note)}</small></span><button class="ib" data-act="nx-use" data-field="${kind}" data-path="${esc(p)}" title="Использовать" aria-label="Использовать">${ic('check', 15)}</button></div>`;
      box.innerHTML = (r.exes.length ? `<h4>Файл запуска</h4>${r.exes.map(e => row('launch', e.path, fmtBytes(e.size))).join('')}` : '') +
        (r.saves.length ? `<h4>Сохранения</h4>${r.saves.map(c => row('savePath', c.path, `${c.why} · ${c.files} файлов, ${fmtBytes(c.bytes)}`)).join('')}` : '') || '<p class="mut">Ничего не найдено. Укажите путь вручную.</p>';
    },
    'nx-use': () => { const f = b.dataset.field; if (!lib[id]) return; lib[id][f] = b.dataset.path; push(id, {[f]: b.dataset.path}); const inp = document.querySelector(`#pside [data-k="${f}"]`); if (inp) inp.value = b.dataset.path; delete pathSt[stKey(id, f)]; nxCheck(id, f); toast('Путь сохранён'); },
    'nx-backup': async () => {
      if (b.disabled) return; b.disabled = true; const old = b.innerHTML; b.innerHTML = `${ic('clock', 16)} Создаю архив…`;
      const r = await jf('/api/backup/' + encodeURIComponent(id), 'POST').catch(() => ({ok: false, error: 'Нет связи с сервером'}));
      b.innerHTML = old; toast(r.ok ? `Бэкап создан: ${r.name}` : (r.error || 'Не удалось создать бэкап'));
      if (r.ok && lib[id]) { lib[id].lastBackup = {name: r.name, at: r.at, files: r.files, size: r.size}; refreshPage(id); } else nxPaint(id, 'savePath');
    },
    'nx-backups-open': () => jf('/api/desktop/open-backups', 'POST').then(r => { if (!online || !r.dir) return; if (!r.ok) toast('Не удалось открыть папку'); }).catch(() => toast('Доступно в приложении NEXUS')),
    'nx-emu-pick': async () => { const r = await jf('/api/pick', 'POST', {kind: 'file', exe: false, title: 'Файл эмулятора'}).catch(() => ({})); if (r.error === 'unavailable') return toast('Выбор файла доступен в приложении NEXUS. Вставьте путь вручную'); if (r.path) $('#emu-' + b.dataset.emu).value = r.path; },
    'nx-emu-save': async () => { const e = b.dataset.emu; await jf('/api/config', 'PUT', {emulators: {[e]: $('#emu-' + e).value.trim()}}); toast('Путь к эмулятору сохранён'); }
  };
  const fn = A[act]; if (!fn) return false; fn(); return true;
}
