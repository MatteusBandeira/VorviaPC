const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vorviaAPI', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
  toggleFullscreen: () => ipcRenderer.send('win-fullscreen'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  netFetch: (url, options) => ipcRenderer.invoke('net-fetch', url, options),
  speedTest: () => ipcRenderer.invoke('speed-test'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, data) => cb(data)),
  onWindowMaximized: (cb) => ipcRenderer.on('window-maximized', (_e, isMax) => cb(isMax))
});
