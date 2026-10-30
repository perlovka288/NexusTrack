'use strict';
// NEXUS: Nintendo Switch — настройки и действия. Платформа одна, эмуляторы и Atmosphere в интерфейсе не называются.
(function () {
  const num = n => +n || 0;
  const bytes = n => typeof fmtBytes === 'function' ? fmtBytes(n) : (num(n) ? Math.round(num(n) / 1048576) + ' МБ' : '0');
  const when = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? '' : (typeof dateRu === 'function' ? dateRu(d.toISOString()) : d.toLocaleString('ru-RU')); };
  const on = v => v !== false;

  function nxSwitchSettings(c) {
    const s = (c && c.switch) || {}, f = s.ftp || {}, cp = s.companion || {};
    const cpOn = cp.enabled !== false;
    setTimeout(swLoad, 30);
    return `<section class="scard" id="swcard"><h2>${ic('handheld', 20)} Nintendo Switch</h2>
  <p class="mut sdesc">Сохранения эмуляторов, бэкапы JKSV/Checkpoint и консоль по USB (MTP) или FTP. В библиотеке Nintendo Switch — одна платформа: названия эмуляторов и Atmosphere нигде не показываются.</p>
  <div class="srow"><div><b>Следить за сохранениями Switch</b><p class="mut">NEXUS смотрит папки сохранений Yuzu/Sudachi и Ryujinx, находит игры по Title ID и названию и обновляет время игры и статус.</p></div>
    <button class="tg${on(s.enabled) ? ' on' : ''}" role="switch" aria-checked="${on(s.enabled)}" aria-label="Следить за сохранениями Switch" data-act="sw-tog" data-k="enabled"><i></i></button></div>
  <div class="srow"><div><b>Проверять каждые 5 минут</b><p class="mut">Первый запуск только запоминает состояние, чтобы не отметить всю библиотеку сыгранной. Дальше изменения обновляют «последний запуск».</p></div>
    <button class="tg${on(s.autoScan) ? ' on' : ''}" role="switch" aria-checked="${on(s.autoScan)}" aria-label="Проверять каждые 5 минут" data-act="sw-tog" data-k="autoScan"><i></i></button></div>
  <div id="sw-status" class="swstat"><span class="mut">Проверяю консоль и сохранения…</span></div>
  <div class="sbtns"><button class="ib wide" data-act="sw-scan">${ic('refresh', 16)} Проверить сохранения</button><button class="ib wide" data-act="sw-sync">${ic('handheld', 16)} Синхронизировать Switch</button></div>
  <div class="srow col"><div><b>Импорт JKSV / Checkpoint</b><p class="mut">Папка с бэкапами на карте памяти или на компьютере. Архивы находятся по названию игры и Title ID.</p></div>
    <div class="covctl"><input id="sw-import-dir" placeholder="D:\\switch\\JKSV" aria-label="Папка с бэкапами JKSV или Checkpoint" spellcheck="false"><button class="ib" data-act="sw-import-pick" title="Выбрать папку" aria-label="Выбрать папку">${ic('folder', 16)}</button><button class="ib" data-act="sw-import" title="Импортировать" aria-label="Импортировать">${ic('check', 16)}</button></div>
    <div id="sw-import-res" class="hint l"></div></div>
  <div class="srow col"><div><b>Свои папки сохранений эмуляторов</b><p class="mut">По одной на строку. Нужно, если эмулятор хранит сохранения в нестандартном месте.</p></div>
    <textarea id="sw-dirs" class="mini" placeholder="D:\\Emu\\yuzu\\nand\\user\\save">${esc((s.emulatorDirs || []).join('\n'))}</textarea>
    <div class="sbtns"><button class="ib wide" data-act="sw-dirs-save">${ic('check', 16)} Сохранить папки</button></div></div>
  <h3 class="swh">Консоль по FTP</h3>
  <p class="mut">Если консоль подключена по USB, FTP не нужен: NEXUS читает раздел «Сохранения» напрямую. FTP пригодится, когда консоль в той же Wi-Fi-сети (sys-ftpd).</p>
  <div class="swftp">
    <label>Адрес<input id="sw-ftp-host" value="${esc(f.host || '')}" placeholder="192.168.1.50" aria-label="Адрес FTP" spellcheck="false"></label>
    <label>Порт<input id="sw-ftp-port" type="number" min="1" max="65535" value="${esc(String(f.port || 21))}" aria-label="Порт FTP"></label>
    <label>Пользователь<input id="sw-ftp-user" value="${esc(f.user || '')}" placeholder="обычно пусто" aria-label="Пользователь FTP" spellcheck="false"></label>
    <label>Пароль<input id="sw-ftp-pass" type="password" autocomplete="off" placeholder="${f.passSet ? '•••• сохранён' : 'обычно пусто'}" aria-label="Пароль FTP"></label>
    <label>Папка<input id="sw-ftp-path" value="${esc(f.path || 'nand/user/save')}" aria-label="Папка сохранений на FTP" spellcheck="false"></label>
  </div>
  <div class="sbtns"><button class="ib wide" data-act="sw-ftp-save">${ic('check', 16)} Сохранить FTP</button><button class="ib wide" data-act="sw-ftp-test">${ic('play', 16)} Проверить FTP</button></div>
  <h3 class="swh">Приложение NEXUS Switch</h3>
  <p class="mut">Установите NEXUS Switch на консоль и откройте его: приложение прочитает системный журнал игрового времени и отправит часы на компьютер по Wi-Fi. Кабель не нужен. Обычное приложение не работает в фоне — синхронизация идёт, когда вы его открываете.</p>
  <div id="sw-comp" class="swcomp">
    <div class="swrow"><span class="swdot ${cpOn ? 'ok' : 'off'}"></span>Приём данных: <b>${cpOn ? 'включён' : 'выключен'}</b> · порт <b>${num(cp.port) || 8788}</b></div>
    <div class="swrow">Код сопряжения: <b class="swcode" id="sw-comp-code">${esc(cp.code || '······')}</b></div>
    <div class="swrow">Адрес для консоли: <b id="sw-comp-url">${esc((cp.urls || [])[0] || '—')}</b></div>
    <div class="swrow mut" id="sw-comp-last">${cp.lastAt ? 'Последняя синхронизация: ' + esc(when(cp.lastAt)) : 'Консоль ещё не отправляла данные'}</div>
  </div>
  <div class="swftp"><label>Порт приёма<input id="sw-comp-port" type="number" min="1024" max="65535" value="${num(cp.port) || 8788}" aria-label="Порт приёма данных с консоли"></label></div>
  <div class="sbtns"><button class="ib wide" data-act="sw-comp-toggle">${ic(cpOn ? 'x' : 'play', 16)} ${cpOn ? 'Выключить приём' : 'Включить приём'}</button><button class="ib wide" data-act="sw-comp-save">${ic('check', 16)} Сохранить порт</button><button class="ib wide" data-act="sw-comp-new">${ic('refresh', 16)} Новый код</button></div>
</section>`;
  }

  async function swLoad() {
    const box = document.getElementById('sw-status'); if (!box || typeof online === 'undefined' || !online) return;
    let r = null; try { r = await jf('/api/switch/status'); } catch { r = null; }
    const box2 = document.getElementById('sw-status'); if (!box2) return;
    if (!r || r.error) { box2.innerHTML = '<span class="mut">Не удалось получить состояние. Проверьте, что NEXUS запущен.</span>'; return; }
    const rows = (r.saves || []).map(s => `<li><span>${s.gameId ? `<a href="#game=${esc(s.gameId)}">${esc(s.gameName)}</a>` : `<span class="mut">${esc(s.titleId)}</span>`}</span><b>${s.files} файл(ов) · ${bytes(s.bytes)}</b></li>`).join('');
    box2.innerHTML = `
      <div class="swrow"><span class="swdot ${r.mtp && r.mtp.present ? 'ok' : 'off'}"></span>Консоль по USB: <b>${r.mtp && r.mtp.present ? 'подключена' : 'не найдена'}</b></div>
      <div class="swrow">Сохранений эмуляторов: <b>${(r.saves || []).length}</b> · совпало с библиотекой: <b>${r.matched || 0}</b>${r.linked ? ` · с сохранением Switch: <b>${r.linked}</b>` : ''}${r.unmatched && r.unmatched.length ? ` · без игры: <b>${r.unmatched.length}</b>` : ''}</div>
      ${r.lastScan ? `<div class="swrow mut">Последняя проверка: ${esc(when(r.lastScan))}${r.lastSync ? ` · синхронизация с консолью: ${esc(when(r.lastSync))}` : ''}</div>` : (r.lastSync ? `<div class="swrow mut">Синхронизация с консолью: ${esc(when(r.lastSync))}</div>` : '')}
      ${rows ? `<ul class="swlist">${rows}</ul>` : '<p class="hint l">Сохранений пока нет. Запустите игру в эмуляторе или подключите консоль и нажмите «Синхронизировать Switch».</p>'}`;
    swCompRender(r.companion);
  }

  // блок приёма данных от приложения на консоли
  function swCompRender(cp) {
    const box = document.getElementById('sw-comp'); if (!cp || !box) return;
    const on = cp.enabled !== false;
    box.innerHTML = `
      <div class="swrow"><span class="swdot ${on ? 'ok' : 'off'}"></span>Приём данных: <b>${on ? 'включён' : 'выключен'}</b> · порт <b>${num(cp.port) || 8788}</b></div>
      <div class="swrow">Код сопряжения: <b class="swcode" id="sw-comp-code">${esc(cp.code || '······')}</b></div>
      <div class="swrow">Адрес для консоли: <b id="sw-comp-url">${esc((cp.urls || [])[0] || '—')}</b></div>
      <div class="swrow mut" id="sw-comp-last">${cp.error ? `Ошибка: ${esc(cp.error)}` : cp.lastAt ? `Последняя синхронизация: ${esc(when(cp.lastAt))}` : 'Консоль ещё не отправляла данные'}</div>`;
    const btn = document.querySelector('[data-act="sw-comp-toggle"]');
    if (btn) btn.innerHTML = `${ic(on ? 'x' : 'play', 16)} ${on ? 'Выключить приём' : 'Включить приём'}`;
    const port = document.getElementById('sw-comp-port');
    if (port && document.activeElement !== port) port.value = num(cp.port) || 8788;
  }

  const busy = async (b, text, fn) => {
    const old = b.innerHTML; b.disabled = true; b.innerHTML = `${ic('clock', 16)} ${text}`;
    try { return await fn(); } finally { b.disabled = false; b.innerHTML = old; }
  };

  function nxSwitchAct(act, b) {
    const A = {
      'sw-tog': async () => {
        const k = b.dataset.k, v = !b.classList.contains('on');
        b.classList.toggle('on', v); b.setAttribute('aria-checked', v);
        await jf('/api/config', 'PUT', {switch: {[k]: v}}).catch(() => toast('Не удалось сохранить'));
      },
      'sw-scan': async () => {
        const r = await busy(b, 'Проверяю…', () => jf('/api/switch/scan', 'POST').catch(() => ({ok: false, error: 'Нет связи с сервером'})));
        if (!r.ok) return toast(r.error || 'Не удалось проверить сохранения');
        toast(`Найдено сохранений: ${(r.saves || []).length}, совпало с библиотекой: ${r.matched || 0}${r.updated ? `, обновлено: ${r.updated}` : ''}`);
        swLoad(); if (r.updated && typeof syncLib === 'function') syncLib();
      },
      'sw-sync': async () => {
        const r = await busy(b, 'Синхронизирую…', () => jf('/api/switch/sync', 'POST').catch(() => ({ok: false, error: 'Нет связи с сервером'})));
        if (!r.ok) return toast(r.message || (r.error === 'no-source' ? 'Подключите консоль по USB или укажите FTP' : (r.error || 'Не удалось синхронизировать')));
        toast(r.via === 'ftp' ? `FTP: игр найдено ${r.found || 0}, совпало ${r.matched || 0}, скачано файлов ${r.files || 0}` : `Консоль: игр ${r.found || 0}, совпало ${r.matched || 0}, скопировано ${r.copied || 0}${r.updated ? `, обновлено ${r.updated}` : ''}`);
        swLoad(); if (r.updated && typeof syncLib === 'function') syncLib();
      },
      'sw-import-pick': async () => {
        const r = await jf('/api/pick', 'POST', {kind: 'folder', title: 'Папка с бэкапами JKSV или Checkpoint'}).catch(() => ({}));
        if (r.error === 'unavailable') return toast('Выбор папки доступен в приложении NEXUS. Вставьте путь вручную');
        if (r.path) { const i = document.getElementById('sw-import-dir'); if (i) i.value = r.path; }
      },
      'sw-import': async () => {
        const dir = (document.getElementById('sw-import-dir') || {}).value || '';
        if (!dir.trim()) return toast('Укажите папку с бэкапами');
        const r = await busy(b, 'Импортирую…', () => jf('/api/switch/import', 'POST', {dir: dir.trim()}).catch(() => ({ok: false, error: 'Нет связи с сервером'})));
        const out = document.getElementById('sw-import-res');
        if (!r.ok) { if (out) out.textContent = r.error || 'Не удалось импортировать'; return toast(r.error || 'Не удалось импортировать'); }
        const msg = `Найдено бэкапов: ${r.found || 0}, совпало с библиотекой: ${r.matched || 0}`;
        if (out) out.textContent = msg + (r.items && r.items.length ? ' · ' + r.items.slice(0, 4).map(i => i.name).join(', ') : '');
        toast(msg); swLoad(); if (r.updated && typeof syncLib === 'function') syncLib();
      },
      'sw-dirs-save': async () => {
        const v = ((document.getElementById('sw-dirs') || {}).value || '').split('\n').map(s => s.trim()).filter(Boolean);
        await jf('/api/config', 'PUT', {switch: {emulatorDirs: v}}).catch(() => toast('Не удалось сохранить'));
        toast('Папки сохранены'); swLoad();
      },
      'sw-ftp-save': async () => {
        const val = id => (document.getElementById(id) || {}).value || '';
        await jf('/api/config', 'PUT', {switch: {ftp: {host: val('sw-ftp-host').trim(), port: +val('sw-ftp-port') || 21, user: val('sw-ftp-user').trim(), pass: val('sw-ftp-pass'), path: val('sw-ftp-path').trim() || 'nand/user/save'}}}).catch(() => toast('Не удалось сохранить'));
        const p = document.getElementById('sw-ftp-pass'); if (p) { p.value = ''; p.placeholder = '•••• сохранён'; }
        toast('FTP сохранён');
      },
      'sw-ftp-test': async () => {
        const val = id => (document.getElementById(id) || {}).value || '';
        const r = await busy(b, 'Подключаюсь…', () => jf('/api/switch/ftp', 'POST', {host: val('sw-ftp-host').trim(), port: +val('sw-ftp-port') || 21, user: val('sw-ftp-user').trim(), pass: val('sw-ftp-pass'), path: val('sw-ftp-path').trim() || 'nand/user/save'}).catch(() => ({ok: false, error: 'Нет связи с сервером'})));
        if (!r.ok) return toast(r.error || 'FTP не ответил');
        toast(`FTP: игр найдено ${r.found || 0}, совпало ${r.matched || 0}, скачано файлов ${r.files || 0}`);
        swLoad(); if (r.updated && typeof syncLib === 'function') syncLib();
      },
      'sw-comp-toggle': async () => {
        const cur = await jf('/api/switch/companion').catch(() => null);
        if (!cur) return toast('Нет связи с сервером');
        const r = await jf('/api/switch/companion', 'PUT', {enabled: cur.enabled === false}).catch(() => null);
        if (!r) return toast('Не удалось изменить приём данных');
        toast(r.enabled === false ? 'Приём данных выключен' : 'Приём данных включён');
        swCompRender(r);
      },
      'sw-comp-save': async () => {
        const v = +((document.getElementById('sw-comp-port') || {}).value || 0) || 8788;
        if (v < 1024 || v > 65535) return toast('Порт должен быть от 1024 до 65535');
        const r = await jf('/api/switch/companion', 'PUT', {port: v}).catch(() => null);
        if (!r) return toast('Не удалось сохранить порт');
        if (r.error) return toast(r.error);
        toast(`Порт ${r.port} сохранён`);
        swCompRender(r);
      },
      'sw-comp-new': async () => {
        const r = await jf('/api/switch/companion', 'PUT', {regenerate: true}).catch(() => null);
        if (!r) return toast('Не удалось создать новый код');
        swCompRender(r); toast(`Новый код: ${r.code}`);
      }
    };
    const fn = A[act]; if (!fn) return false; fn(); return true;
  }

  window.nxSwitchSettings = nxSwitchSettings;
  window.nxSwitchAct = nxSwitchAct;
  window.swLoad = swLoad;
})();
