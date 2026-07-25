const { contextBridge, ipcRenderer } = require('electron')

// همه API‌هایی که renderer می‌تونه استفاده کنه
contextBridge.exposeInMainWorld('electron', {
  // Window controls
  minimize:    () => ipcRenderer.send('window:minimize'),
  maximize:    () => ipcRenderer.send('window:maximize'),
  close:       () => ipcRenderer.send('window:close'),
  fullscreen:  () => ipcRenderer.send('window:fullscreen'),

  // App info
  getVersion:  () => ipcRenderer.invoke('app:version'),
  getPort:     () => ipcRenderer.invoke('app:port'),

  // Shell
  openExternal:(url) => ipcRenderer.invoke('shell:open', url),
})