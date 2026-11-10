// 画面（app/）から使える Mac 版の機能。これがあると app.js は GitHub API ではなくローカルのフォルダを使う
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdws', {
  desktop: true,
  status: () => ipcRenderer.invoke('mdws:status'),
  chooseFolder: () => ipcRenderer.invoke('mdws:chooseFolder'),
  forget: () => ipcRenderer.invoke('mdws:forget'),
  setAuto: on => ipcRenderer.invoke('mdws:setAuto', on),
  scan: () => ipcRenderer.invoke('mdws:scan'),
  write: (rel, text, sha, message) => ipcRenderer.invoke('mdws:write', rel, text, sha, message),
  sync: () => ipcRenderer.invoke('mdws:sync'),
  openFolder: () => ipcRenderer.invoke('mdws:openFolder'),
  openExternal: url => ipcRenderer.invoke('mdws:openExternal', url),
  onChanged: cb => ipcRenderer.on('mdws:changed', () => cb()),
  onStatus: cb => ipcRenderer.on('mdws:status', (e, s) => cb(s)),
  onToast: cb => ipcRenderer.on('mdws:toast', (e, m) => cb(m)),
});
