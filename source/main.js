'use strict';
// Оболочка Electron: окно, значок в трее (область со стрелкой ^), уведомления, автозапуск
const {app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, dialog, screen, ipcMain} = require('electron');
const path = require('path'), fs = require('fs');
const {start} = require('./server');
const cloud = require('./lib/cloud'), updater = require('./lib/updater'), release = require('./lib/release');

if (!app.requestSingleInstanceLock()) app.quit(); else init();

function init() {
  app.setAppUserModelId('com.nexus.app');
  let win, tray, srv, quitting = false, nowItem = 'Сейчас ничего не запущено', tip = 'NEXUS';
  const hidden = process.argv.includes('--hidden');
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  const trayIcon = (() => { const i = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico')); return i.isEmpty() ? icon.resize({width: 20, height: 20}) : i; })();

  // автозапуск: при входе в Windows приложение стартует свёрнутым в трей. Параметры должны совпадать при записи и чтении.
  const LOGIN = () => ({path: process.execPath, args: process.defaultApp ? [path.resolve(process.argv[1] || '.'), '--hidden'] : ['--hidden']});
  const getAuto = () => { try { return app.getLoginItemSettings(LOGIN()).openAtLogin; } catch { return false; } };
  const setAuto = on => { try { app.setLoginItemSettings({openAtLogin: !!on, ...LOGIN()}); } catch {} };

  // ----- безрамочное окно со скруглённой панелью (форму рисует интерфейс), своё изменение размера -----
  const MINW = 900, MINH = 600;
  let maxed = false, normal = null, rs = null, saveT = null;
  const WS_FILE = () => path.join(app.getPath('userData'), 'win-state.json');
  const loadWS = () => { try { return JSON.parse(fs.readFileSync(WS_FILE(), 'utf8')) || {}; } catch { return {}; } };
  function saveWS() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        if (!win || win.isDestroyed()) return;
        const b = maxed && normal ? normal : win.getBounds();
        fs.mkdirSync(path.dirname(WS_FILE()), {recursive: true});
        fs.writeFileSync(WS_FILE(), JSON.stringify({x: b.x, y: b.y, width: b.width, height: b.height, max: maxed}));
      } catch {}
    }, 400);
  }
  function startBounds(ws) {
    const width = Math.max(MINW, Math.round(+ws.width || 1360)), height = Math.max(MINH, Math.round(+ws.height || 860)), r = {width, height};
    if (Number.isFinite(ws.x) && Number.isFinite(ws.y)) {
      const wa = screen.getDisplayMatching({x: ws.x, y: ws.y, width, height}).workArea;
      // окно должно оставаться на экране (например, после отключения монитора)
      if (ws.x < wa.x + wa.width - 120 && ws.x + width > wa.x + 120 && ws.y >= wa.y - 10 && ws.y < wa.y + wa.height - 120) { r.x = Math.round(ws.x); r.y = Math.round(ws.y); }
    }
    return r;
  }
  const sendState = () => { try { if (win && !win.isDestroyed()) win.webContents.send('nxwin:state', {max: maxed}); } catch {} };
  function toggleMax(force) {
    if (!win || win.isDestroyed()) return;
    const want = typeof force === 'boolean' ? force : !maxed;
    if (want === maxed) return;
    if (want) { normal = win.getBounds(); maxed = true; win.setBounds(screen.getDisplayMatching(normal).workArea); }
    else { maxed = false; if (normal) win.setBounds(normal); }
    sendState(); saveWS();
  }
  const fromUi = e => !!(win && !win.isDestroyed() && e.sender === win.webContents);
  ipcMain.on('nxwin:min', e => { if (fromUi(e)) win.minimize(); });
  ipcMain.on('nxwin:max', e => { if (fromUi(e)) toggleMax(); });
  ipcMain.on('nxwin:close', e => { if (fromUi(e)) win.close(); });   // закрытие прячет окно в трей
  ipcMain.handle('nxwin:get', e => ({max: fromUi(e) ? maxed : false}));
  ipcMain.on('nxwin:rs', e => { if (fromUi(e) && !maxed) rs = {b: win.getBounds(), p: screen.getCursorScreenPoint()}; });
  ipcMain.on('nxwin:rb', (e, edge) => {
    if (!rs || !fromUi(e) || maxed || !/^(n|s|e|w|ne|nw|se|sw)$/.test(String(edge))) return;
    const p = screen.getCursorScreenPoint(), dx = p.x - rs.p.x, dy = p.y - rs.p.y;
    let {x, y, width, height} = rs.b;
    if (edge.includes('e')) width = Math.max(MINW, rs.b.width + dx);
    if (edge.includes('s')) height = Math.max(MINH, rs.b.height + dy);
    if (edge.includes('w')) { width = Math.max(MINW, rs.b.width - dx); x = rs.b.x + rs.b.width - width; }
    if (edge.includes('n')) { height = Math.max(MINH, rs.b.height - dy); y = rs.b.y + rs.b.height - height; }
    win.setBounds({x, y, width, height});
  });
  ipcMain.on('nxwin:re', e => { if (fromUi(e)) { rs = null; saveWS(); } });

  // ----- облако (Supabase): админ-панель и OTA. Доступно только окну приложения через IPC, не по HTTP -----
  const handle = (ch, fn, ok = fromUi) => ipcMain.handle(ch, async (e, ...a) => {
    if (!ok(e)) return {ok: false, error: 'Недоступно'};
    try { return {ok: true, data: await fn(...a)}; } catch (err) { return {ok: false, error: String((err && err.message) || err)}; }
  });
  const authed = () => { if (!cloud.state().loggedIn) throw new Error('Сессия истекла. Войдите заново.'); };
  handle('nxadmin:state', async () => { await cloud.restore(); return cloud.state(); });
  handle('nxadmin:canshow', login => cloud.isAdminLogin(login));
  handle('nxadmin:login', (u, p) => cloud.login(u, p));
  handle('nxadmin:logout', () => cloud.logout());
  handle('nxadmin:stats', () => cloud.stats());
  handle('nxadmin:provider:get', async () => { authed(); return {provider: await cloud.refreshProvider(), providers: cloud.PROVIDERS}; });
  handle('nxadmin:provider:set', p => cloud.setProvider(p));
  handle('nxadmin:password', (o, n) => cloud.changePassword(o, n));
  handle('nxadmin:admins:list', () => cloud.listAdmins());
  handle('nxadmin:admins:create', (u, p, r) => cloud.createAdmin(u, p, r));
  handle('nxadmin:admins:delete', id => cloud.deleteAdmin(id));
  handle('nxadmin:releases:list', async () => { authed(); const [releases, active] = await Promise.all([cloud.listReleases(20), cloud.activeVersion()]); return {releases, active}; });
  // ручная публикация по готовой https-ссылке (запасной путь, например для файлов больше 50 МБ)
  handle('nxadmin:releases:publish', async r => { await cloud.publishRelease(r); if (r.activate) await cloud.setActiveRelease(r.version); });
  handle('nxadmin:releases:activate', v => cloud.setActiveRelease(v));
  handle('nxadmin:releases:delete', v => cloud.deleteRelease(v));

  // ----- выпуск обновления из админки: выбираете папку или файл, остальное делает NEXUS -----
  // Путь к файлу хранится только здесь, в основном процессе: интерфейс не может подсунуть произвольный файл.
  let prep = null;
  const MAX_UP = 50 * 1024 * 1024;
  const sendProg = p => { try { if (win && !win.isDestroyed()) win.webContents.send('nxadmin:progress', p); } catch {} };
  const buildDir = () => path.join(app.getPath('userData'), 'release-build');
  const verFromName = n => { const m = /(\d+\.\d+\.\d+)/.exec(String(n || '')); return m ? m[1] : ''; };
  handle('nxadmin:release:pick', async mode => {
    authed(); if (!cloud.isSuper()) throw new Error('Недостаточно прав для этого действия.');
    const folder = mode === 'folder';
    const r = await dialog.showOpenDialog(win, folder
      ? {title: 'Папка с файлами приложения (где лежат package.json и main.js)', properties: ['openDirectory']}
      : {title: 'Готовый файл обновления', properties: ['openFile'], filters: [{name: 'Обновление NEXUS', extensions: ['asar', 'zip', 'exe']}]});
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    fs.rmSync(buildDir(), {recursive: true, force: true}); fs.mkdirSync(buildDir(), {recursive: true});
    let file, kind, version = '', notes = [], from = path.basename(src);
    if (folder) {
      sendProg({stage: 'build'});
      file = path.join(buildDir(), 'app.asar'); kind = 'asar';
      const b = release.buildFromFolder(src, file, {fallbackModules: path.join(app.getAppPath(), 'node_modules')});
      version = b.version;
      notes.push(`Собрал app.asar из ${b.files} файлов.` + (b.usedFallback ? ' Папки node_modules в выбранной папке нет, взял библиотеки из установленного NEXUS.' : ''));
    } else {
      file = src; kind = path.extname(src).slice(1).toLowerCase();
      if (!['asar', 'zip', 'exe'].includes(kind)) throw new Error('Нужен файл .asar, .zip или .exe.');
    }
    if (kind === 'asar') { const i = release.inspectAsar(file); version = i.version; notes.push(...i.notes); notes.push('Проверка пройдена: все обязательные файлы на месте, синтаксис в порядке.'); }
    else if (!folder) { version = verFromName(path.basename(src)); notes.push(kind === 'zip' ? 'ZIP распаковывается поверх папки приложения.' : 'EXE запускается как установщик (тихая установка).'); }
    const size = fs.statSync(file).size;
    if (size > MAX_UP) throw new Error(`Файл ${(size / 1048576).toFixed(1)} МБ, а лимит хранилища Supabase на бесплатном тарифе 50 МБ. Загрузите файл на GitHub Releases и вставьте ссылку в блоке «Вручную по ссылке».`);
    sendProg({stage: 'hash'});
    const sha256 = await release.sha256File(file);
    if (version) { const have = await cloud.listReleases(50); if (have.some(x => x.version === version)) notes.unshift(`⚠ Версия ${version} уже опубликована. Поднимите версию в package.json или удалите старый релиз в списке ниже.`); }
    prep = {file, kind, version, sha256};
    return {kind, version, size, sha256, notes, from, needVersion: !version, duplicate: !!notes.find(n => n.startsWith('⚠'))};
  });
  handle('nxadmin:release:upload', async o => {
    authed(); if (!cloud.isSuper()) throw new Error('Недостаточно прав для этого действия.');
    if (!prep) throw new Error('Сначала выберите папку или файл.');
    const version = prep.version || String(o.version || '').trim();
    if (!release.VER_RE.test(version)) throw new Error('Укажите версию в формате 1.2.3');
    if ((await cloud.listReleases(50)).some(x => x.version === version)) throw new Error(`Версия ${version} уже опубликована. Поднимите версию в package.json или удалите старый релиз.`);
    const sha256 = await release.sha256File(prep.file);                       // файл мог измениться после выбора
    if (sha256 !== prep.sha256) throw new Error('Файл изменился после выбора. Выберите его заново.');
    const url = await cloud.uploadRelease(prep.file, version, prep.kind, p => sendProg({stage: 'upload', ...p}));
    sendProg({stage: 'publish'});
    await cloud.publishRelease({version, changelog: String(o.changelog || ''), url, sha256});
    if (o.activate !== false) await cloud.setActiveRelease(version);
    prep = null;
    return {version, activated: o.activate !== false};
  });
  handle('nxadmin:release:cancel', () => { prep = null; });

  // ----- OTA: окно обновления с кнопкой «Обновить сейчас» -----
  let updWin = null, updRelease = null, updBusy = false, pendingRel = null;
  const dismissed = new Set();
  const fromUpd = e => !!(updWin && !updWin.isDestroyed() && e.sender === updWin.webContents);
  function showUpdate(rel) {
    updRelease = rel;
    if (updWin && !updWin.isDestroyed()) { updWin.show(); updWin.focus(); return; }
    if (!srv) return;
    updWin = new BrowserWindow({width: 480, height: 440, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true, show: false, icon,
      title: 'Обновление NEXUS', backgroundColor: '#0d0e13', alwaysOnTop: true,
      webPreferences: {preload: path.join(__dirname, 'lib', 'preload.js'), contextIsolation: true, nodeIntegration: false}});
    updWin.setMenuBarVisibility(false);
    updWin.loadURL('http://127.0.0.1:' + srv.port + '/update.html');
    updWin.once('ready-to-show', () => { updWin.show(); updWin.focus(); });
    updWin.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    updWin.on('close', e => { if (updBusy) e.preventDefault(); });
    updWin.on('closed', () => { updWin = null; });
  }
  handle('nxupd:info', () => ({current: app.getVersion(), version: updRelease.version, changelog: updRelease.changelog || '', kind: updater.kindOf(updRelease.download_url), downgrade: cloud.cmp(updRelease.version, app.getVersion()) < 0}), fromUpd);
  handle('nxupd:start', async () => {
    if (updBusy || !updRelease) throw new Error('Обновление уже выполняется.');
    updBusy = true;
    try {
      cloud.flag('updTry', {to: updRelease.version, from: app.getVersion()});   // если после установки версия не выросла, повторно это обновление не предлагаем
      const got = await updater.download(updRelease.download_url, path.join(app.getPath('userData'), 'updates'),
        s => { try { if (updWin && !updWin.isDestroyed()) updWin.webContents.send('nxupd:progress', s); } catch {} }, updRelease.sha256);
      // Windows не даёт заменить запущенные файлы: скрипт дожидается выхода, подменяет файлы и сам запускает NEXUS (в режиме разработки: app.relaunch()).
      updater.apply(got, {app, quit: () => { quitting = true; app.exit(0); }});
    } catch (err) { updBusy = false; throw err; }
  }, fromUpd);
  handle('nxupd:later', () => { if (updRelease) dismissed.add(updRelease.version); if (!updBusy && updWin && !updWin.isDestroyed()) updWin.close(); }, fromUpd);
  async function checkUpdate() {
    try {
      if (updBusy) return;
      const rel = await cloud.latestRelease();
      const cur = app.getVersion(), diff = rel ? cloud.cmp(rel.version, cur) : 0;
      // новее установленной: предлагаем всегда; старее: только если админ сам выбрал эту версию (откат)
      if (!rel || diff === 0 || (diff < 0 && !rel.pinned) || dismissed.has(rel.version)) return;
      const tried = cloud.flag('updTry');
      if (tried && tried.to === rel.version && tried.from === cur) return;   // уже ставили, версия не изменилась: в релизе номер не совпадает с package.json внутри файла
      if (hidden && !(win && !win.isDestroyed() && win.isVisible())) {   // автозапуск в трее: окном не выскакиваем, присылаем уведомление
        pendingRel = rel;
        if (Notification.isSupported()) { const n = new Notification({title: cloud.cmp(rel.version, app.getVersion()) < 0 ? 'Доступна другая версия NEXUS' : 'Доступно обновление NEXUS', body: `Версия ${rel.version}. Нажмите, чтобы установить.`, icon}); n.on('click', () => { pendingRel = null; showUpdate(rel); }); n.show(); }
        return;
      }
      showUpdate(rel);
    } catch {}
  }

  function makeWin() {
    if (win && !win.isDestroyed()) return win;
    const ws = loadWS();
    win = new BrowserWindow({...startBounds(ws), minWidth: MINW, minHeight: MINH, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, autoHideMenuBar: true, show: !hidden, icon, title: 'NEXUS',
      webPreferences: {preload: path.join(__dirname, 'lib', 'preload.js'), contextIsolation: true, nodeIntegration: false}});
    win.setMenuBarVisibility(false);
    try { win.setBackgroundColor('#00000000'); } catch {}   // полностью прозрачная подложка: за скруглением панели нет чёрных углов
    win.loadURL('http://127.0.0.1:' + srv.port);
    win.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action: 'deny'}; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://127.0.0.1:' + srv.port)) { e.preventDefault(); shell.openExternal(url); } });
    win.webContents.on('did-finish-load', sendState);
    win.on('move', () => { if (!maxed) saveWS(); });
    maxed = false; normal = null;
    if (ws.max) win.once('ready-to-show', () => toggleMax(true));
    // закрытие окна сворачивает в трей, чтобы часы считались дальше
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
    return win;
  }
  function show() {
    try { if (!win || win.isDestroyed()) { if (!srv) return; makeWin(); } } catch {}
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore(); win.show(); win.focus();
    if (pendingRel) { const r = pendingRel; pendingRel = null; showUpdate(r); }
  }
  function notify(title, body) { try { if (Notification.isSupported()) new Notification({title, body, icon, silent: true}).show(); } catch {} }
  function menu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
      {label: 'Открыть NEXUS', click: show}, {type: 'separator'},
      {label: nowItem, enabled: false}, {type: 'separator'},
      {label: 'Запускать вместе с Windows', type: 'checkbox', checked: getAuto(), click: i => setAuto(i.checked)},
      {label: 'Выход', click: () => { quitting = true; app.quit(); }}
    ]));
  }
  function makeTray() {
    try { tray?.destroy(); } catch {}
    tray = new Tray(trayIcon); tray.setToolTip(tip); tray.on('click', show); tray.on('double-click', show); menu();
  }
  function setTip(t) { tip = t; try { tray?.setToolTip(t); } catch {} }

  app.on('second-instance', show);
  async function boot() {
    const dataDir = path.join(app.getPath('userData'), 'data');
    // переезд со старой версии (Game Tracker): копируем прежние данные, если новой папки ещё нет
    try {
      if (!fs.existsSync(path.join(dataDir, 'library.json'))) {
        for (const old of ['Game Tracker', 'game-tracker']) {
          const from = path.join(app.getPath('appData'), old, 'data');
          if (fs.existsSync(path.join(from, 'library.json'))) { fs.cpSync(from, dataDir, {recursive: true}); break; }
        }
      }
    } catch {}
    // первый запуск установленного приложения: включаем автозапуск (отключается в Настройках или в меню значка)
    try {
      const flag = path.join(app.getPath('userData'), 'first-run.flag');
      if (!process.defaultApp && !fs.existsSync(flag)) { setAuto(true); fs.mkdirSync(path.dirname(flag), {recursive: true}); fs.writeFileSync(flag, new Date().toISOString()); }
    } catch {}
    srv = await start({
      dataDir, port: 0,
      hooks: {quit: () => { quitting = true; app.quit(); }, restart: () => { quitting = true; app.relaunch(); app.exit(0); }, getProvider: () => cloud.cachedProvider(), getAutostart: getAuto, setAutostart: on => { setAuto(on); menu(); }, openData: () => shell.openPath(dataDir), openPath: p => shell.openPath(p),
        // системное окно выбора файла/папки для полей «Файл запуска» и «Папка с сохранениями»
        pickPath: async ({kind, title, exe}) => {
          const r = await dialog.showOpenDialog(win, {title: title || undefined, properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
            filters: kind === 'folder' ? undefined : [{name: exe ? 'Игры и образы' : 'Все файлы', extensions: exe ? ['exe', 'bat', 'cmd', 'lnk', 'iso', 'bin', 'cue', 'chd', 'img', 'mdf', 'cso', 'pbp', 'elf', 'pkg', 'xci', 'nsp', 'rvz', 'wbfs', 'gcm', 'wad', 'wua', 'wux', 'wud', 'rpx', 'nds', '3ds', 'cia', 'gba', 'gb', 'gbc', 'sfc', 'smc', 'nes', 'z64', 'n64', 'xex', 'vpk', 'zip', '7z'] : ['*']}, {name: 'Все файлы', extensions: ['*']}]});
          return r.canceled ? '' : r.filePaths[0];
        }}
    });
    win = makeWin();

    // облако: счётчик установок, автосоздание главного админа kostlim, активный API, проверка обновлений. Без сети NEXUS работает как раньше.
    cloud.startSession(app.getVersion());
    cloud.ensureDefaultAdmin().catch(() => {});
    cloud.refreshProvider();
    setInterval(() => cloud.refreshProvider(), 10 * 60 * 1000).unref();
    setTimeout(checkUpdate, 3000);
    setInterval(checkUpdate, 20 * 60 * 1000).unref();                                                                   // приложение живёт в трее днями: проверяем каждые 20 минут
    let lastChk = 0; app.on('browser-window-focus', () => { if (Date.now() - lastChk > 5 * 60 * 1000) { lastChk = Date.now(); checkUpdate(); } });   // и когда пользователь открывает окно

    makeTray();
    // при автозапуске панель задач может быть ещё не готова: создаём значок повторно, чтобы он точно появился
    if (hidden) { setTimeout(makeTray, 8000); setTimeout(makeTray, 30000); }

    const fmt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
    srv.events.on('event', e => {
      if (e.type === 'start') { nowItem = 'Играете: ' + e.name; setTip('NEXUS: ' + e.name); menu(); notify('Время игры считается', e.name); }
      else if (e.type === 'end') { nowItem = 'Сейчас ничего не запущено'; setTip('NEXUS'); menu(); notify('Сессия окончена', `${e.name}: ${fmt(e.seconds)}`); }
      else if (e.type === 'added') notify('Новая игра в библиотеке', e.name);
      else if (e.type === 'wish-release') notify('Игра вышла', `${e.name} уже доступна`);
    });
  }
  app.whenReady().then(() => boot().catch(e => {
    const msg = String((e && (e.stack || e.message)) || e);
    try { fs.mkdirSync(app.getPath('userData'), {recursive: true}); fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch {}
    try { dialog.showErrorBox('NEXUS не смог запуститься', 'Не удалось открыть библиотеку.\n\n' + msg + '\n\nПопробуйте закрыть другие копии NEXUS и запустить снова.'); } catch {}
    quitting = true; app.quit();
  }));
  app.on('before-quit', () => { quitting = true; try { srv?.close(); } catch {} });
  app.on('window-all-closed', () => {});
}
