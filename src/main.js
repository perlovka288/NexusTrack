'use strict';
// Оболочка Electron: окно, значок в трее (область со стрелкой ^), уведомления, автозапуск
const {app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, dialog, screen, ipcMain} = require('electron');
const path = require('path'), fs = require('fs');
const {start} = require('./server');

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

  function makeWin() {
    if (win && !win.isDestroyed()) return win;
    const ws = loadWS();
    win = new BrowserWindow({...startBounds(ws), minWidth: MINW, minHeight: MINH, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, autoHideMenuBar: true, show: !hidden, icon, title: 'NEXUS',
      webPreferences: {preload: path.join(__dirname, 'lib', 'preload.js'), contextIsolation: true, nodeIntegration: false}});
    win.setMenuBarVisibility(false);
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
      hooks: {restart: () => { quitting = true; app.relaunch(); app.exit(0); }, getAutostart: getAuto, setAutostart: on => { setAuto(on); menu(); }, openData: () => shell.openPath(dataDir), openPath: p => shell.openPath(p),
        // системное окно выбора файла/папки для полей «Файл запуска» и «Папка с сохранениями»
        pickPath: async ({kind, title, exe}) => {
          const r = await dialog.showOpenDialog(win, {title: title || undefined, properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
            filters: kind === 'folder' ? undefined : [{name: exe ? 'Игры и образы' : 'Все файлы', extensions: exe ? ['exe', 'bat', 'cmd', 'lnk', 'iso', 'bin', 'cue', 'chd', 'img', 'mdf', 'cso', 'pbp', 'elf', 'pkg', 'xci', 'nsp', 'rvz', 'wbfs', 'gcm', 'wad', 'wua', 'wux', 'wud', 'rpx', 'nds', '3ds', 'cia', 'gba', 'gb', 'gbc', 'sfc', 'smc', 'nes', 'z64', 'n64', 'xex', 'vpk', 'zip', '7z'] : ['*']}, {name: 'Все файлы', extensions: ['*']}]});
          return r.canceled ? '' : r.filePaths[0];
        }}
    });
    win = makeWin();

    makeTray();
    // при автозапуске панель задач может быть ещё не готова: создаём значок повторно, чтобы он точно появился
    if (hidden) { setTimeout(makeTray, 8000); setTimeout(makeTray, 30000); }

    const fmt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
    srv.events.on('event', e => {
      if (e.type === 'start') { nowItem = 'Играете: ' + e.name; setTip('NEXUS: ' + e.name); menu(); notify('Время игры считается', e.name); }
      else if (e.type === 'end') { nowItem = 'Сейчас ничего не запущено'; setTip('NEXUS'); menu(); notify('Сессия окончена', `${e.name}: ${fmt(e.seconds)}`); }
      else if (e.type === 'added') notify('Новая игра в библиотеке', e.name);
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
