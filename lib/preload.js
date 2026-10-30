'use strict';
// Мост между интерфейсом и окном Electron: кнопки окна, изменение размера, админ-панель и обновления.
// nxAdmin / nxUpdate существуют только в приложении: в браузере и на телефоне их нет, админка там не появляется.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('nxWin', {
  min: () => ipcRenderer.send('nxwin:min'),
  max: () => ipcRenderer.send('nxwin:max'),
  close: () => ipcRenderer.send('nxwin:close'),
  rs: () => ipcRenderer.send('nxwin:rs'),
  rb: edge => ipcRenderer.send('nxwin:rb', String(edge)),
  re: () => ipcRenderer.send('nxwin:re'),
  state: () => ipcRenderer.invoke('nxwin:get'),
  onState: cb => { ipcRenderer.on('nxwin:state', (_e, s) => { try { cb(s); } catch {} }); }
});

// Все вызовы возвращают {ok, data|error}; здесь превращаем ошибку обратно в исключение с понятным текстом.
const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Ошибка');
  return r.data;
};
contextBridge.exposeInMainWorld('nxAdmin', {
  state: () => call('nxadmin:state'),
  canShow: login => call('nxadmin:canshow', String(login)),
  login: (username, password) => call('nxadmin:login', String(username), String(password)),
  logout: () => call('nxadmin:logout'),
  stats: () => call('nxadmin:stats'),
  getProvider: () => call('nxadmin:provider:get'),
  setProvider: list => call('nxadmin:provider:set', (Array.isArray(list) ? list : [list]).map(String)),
  changePassword: (oldPass, newPass) => call('nxadmin:password', String(oldPass), String(newPass)),
  listAdmins: () => call('nxadmin:admins:list'),
  createAdmin: (username, password, role) => call('nxadmin:admins:create', String(username), String(password), String(role)),
  deleteAdmin: id => call('nxadmin:admins:delete', String(id)),
  listReleases: () => call('nxadmin:releases:list'),
  publishRelease: r => call('nxadmin:releases:publish', {version: String(r.version), changelog: String(r.changelog || ''), url: String(r.url), sha256: String(r.sha256 || ''), activate: !!r.activate}),
  activateRelease: v => call('nxadmin:releases:activate', String(v || '')),
  deleteRelease: v => call('nxadmin:releases:delete', String(v)),
  pickRelease: mode => call('nxadmin:release:pick', mode === 'folder' ? 'folder' : 'file'),
  uploadRelease: o => call('nxadmin:release:upload', {version: String(o.version || ''), changelog: String(o.changelog || ''), activate: o.activate !== false}),
  cancelRelease: () => call('nxadmin:release:cancel'),
  onProgress: cb => { ipcRenderer.on('nxadmin:progress', (_e, p) => { try { cb(p); } catch {} }); }
});
contextBridge.exposeInMainWorld('nxUpdate', {
  info: () => call('nxupd:info'),
  start: () => call('nxupd:start'),
  later: () => call('nxupd:later'),
  onProgress: cb => { ipcRenderer.on('nxupd:progress', (_e, s) => { try { cb(s); } catch {} }); }
});
