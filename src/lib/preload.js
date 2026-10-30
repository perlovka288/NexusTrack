'use strict';
// Мост между интерфейсом и окном Electron: кнопки окна и изменение размера.
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
