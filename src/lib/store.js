'use strict';
// Хранилище данных в JSON-файлах (атомарная запись + резервная копия)
const fs = require('fs'), path = require('path');
const DEFAULTS = () => ({
  library: {},
  config: {
    keys: {steamgriddb: '', rawg: '', steamKey: '', steamId: '', deepl: ''},
    tracker: {enabled: true, autoAdd: true, autoStatus: true, folders: [], ignore: []},
    launch: {fullscreen: true},                                        // эмуляторы запускают игру сразу на весь экран
    mobile: {enabled: false, port: 8787, token: ''},                   // доступ с телефона по Wi-Fi (выключен по умолчанию)
    ui: {accent: '', libraryTab: 'all', gridFill: true, gridStyle: 'wide', gameScroll: 'independent'}, // оформление и раскладка
    emulators: {},                                                     // id эмулятора → путь к его exe (запоминается сам, когда эмулятор запущен)
    switch: {                                                          // Nintendo Switch: сейвы эмуляторов, консоль по USB (MTP) и FTP
      enabled: true,
      autoScan: true,
      emulatorDirs: [],
      ftp: {host: '', port: 21, user: '', pass: '', path: 'nand/user/save'},
      companion: {enabled: true, port: 8788, code: '', lastAt: ''},
      lastScan: '',
      lastSync: ''
    }
  },
  covers: {},
  meta: {},
  translations: {},                                                    // кэш автоперевода описаний
  profile: {name: '', bio: '', avatar: '', cover: '', coverY: 50},   // профиль: имя, о себе, аватар, обложка
  folders: {}                                                         // папки библиотеки: id → {name, created}
});
function createStore(dir) {
  fs.mkdirSync(path.join(dir, 'uploads'), {recursive: true});
  const names = {library: 'library.json', config: 'config.json', covers: 'covers.json', meta: 'meta.json', translations: 'translations.json', profile: 'profile.json', folders: 'folders.json'};
  const data = DEFAULTS(), timers = {};
  const file = k => path.join(dir, names[k]);
  const UNI = path.join(dir, 'nexus_user_data.json'), loaded = {};
  for (const k of Object.keys(names)) {
    try {
      const j = JSON.parse(fs.readFileSync(file(k), 'utf8'));
      data[k] = k === 'config' ? {keys: {...data.config.keys, ...j.keys}, tracker: {...data.config.tracker, ...j.tracker}, emulators: {...data.config.emulators, ...j.emulators}, launch: {...data.config.launch, ...j.launch}, mobile: {...data.config.mobile, ...j.mobile}, ui: {...data.config.ui, ...j.ui}, switch: {...data.config.switch, ...j.switch, ftp: {...data.config.switch.ftp, ...(j.switch || {}).ftp}, companion: {...data.config.switch.companion, ...(j.switch || {}).companion}}} : k === 'profile' ? {...data.profile, ...j} : j;
      loaded[k] = true;
      if (k === 'library') fs.copyFileSync(file(k), file(k) + '.bak');
    } catch {}
  }
  // «Все пути, папки, сессии и настройки лежат в одном JSON-файле data/nexus_user_data.json». Если основные файлы потеряны, данные восстанавливаются из него.
  function unified() { const c = data.config; return {app: 'NEXUS', schema: 1, savedAt: new Date().toISOString(), library: data.library, folders: data.folders, profile: data.profile, settings: {tracker: c.tracker, emulators: c.emulators, ui: c.ui, launch: c.launch}}; }
  function writeUnified() { const tmp = UNI + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(unified())); fs.renameSync(tmp, UNI); } catch (e) { console.error('save failed unified', e.message); } }
  try {
    if (fs.existsSync(UNI)) {
      const u = JSON.parse(fs.readFileSync(UNI, 'utf8')); let n = 0;
      if (!loaded.library && u.library && typeof u.library === 'object') { data.library = u.library; n++; }
      if (!loaded.folders && u.folders && typeof u.folders === 'object') { data.folders = u.folders; n++; }
      if (!loaded.profile && u.profile && typeof u.profile === 'object') { data.profile = {...data.profile, ...u.profile}; n++; }
      if (!loaded.config && u.settings) { data.config.tracker = {...data.config.tracker, ...u.settings.tracker}; data.config.emulators = {...data.config.emulators, ...u.settings.emulators}; data.config.ui = {...data.config.ui, ...(u.settings.ui || {})}; data.config.launch = {...data.config.launch, ...(u.settings.launch || {})}; n++; }
      if (n) console.log('NEXUS: данные восстановлены из nexus_user_data.json');
    }
  } catch {}
  let uT = null;
  const schedUnified = () => { clearTimeout(uT); uT = setTimeout(writeUnified, 1500); if (uT.unref) uT.unref(); };
  function write(k) {
    const f = file(k), tmp = f + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data[k], null, k === 'covers' || k === 'meta' || k === 'translations' ? 0 : 2)); fs.renameSync(tmp, f); }
    catch (e) { console.error('save failed', k, e.message); }
    if (k === 'library' || k === 'folders' || k === 'profile' || k === 'config') schedUnified();
  }
  function save(k) { clearTimeout(timers[k]); timers[k] = setTimeout(() => write(k), 400); }
  function flush() { for (const k of Object.keys(timers)) { clearTimeout(timers[k]); write(k); } clearTimeout(uT); writeUnified(); }
  return {dir, data, save, flush, unifiedFile: UNI, backups: path.join(dir, 'backups'), uploads: path.join(dir, 'uploads')};
}
module.exports = {createStore};
