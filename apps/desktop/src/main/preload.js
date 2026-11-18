const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('livesub', {
  sendCaption: (c) => ipcRenderer.send('caption', c),
  sendStatus: (s) => ipcRenderer.send('status', s),
  setOverlaySettings: (s) => ipcRenderer.send('overlay-settings', s),
  clearOverlay: () => ipcRenderer.send('overlay-clear'),
  setOverlayLocked: (v) => ipcRenderer.send('overlay-lock', v),
  getOverlayLocked: () => ipcRenderer.invoke('overlay-locked'),
  fetch: (url, init) => ipcRenderer.invoke('net-fetch', url, init),
  saveFile: (name, content) => ipcRenderer.invoke('save-file', name, content),
  ensureModels: (specs) => ipcRenderer.invoke('models-ensure', specs),
  onModelProgress: (cb) => ipcRenderer.on('models-progress', (_e, p) => cb(p)),
  modelsInfo: () => ipcRenderer.invoke('models-info'),
  openModels: () => ipcRenderer.invoke('models-open'),
  deleteModels: () => ipcRenderer.invoke('models-delete'),
  autosaveBegin: (label) => ipcRenderer.invoke('autosave-begin', label),
  autosaveAppend: (text) => ipcRenderer.send('autosave-append', text),
  openTranscripts: () => ipcRenderer.invoke('open-transcripts'),
  onToggle: (cb) => ipcRenderer.on('toggle', () => cb()),
  onOverlayLock: (cb) => ipcRenderer.on('overlay-lock', (_e, v) => cb(v)),
  onOverlay: (cb) => ipcRenderer.on('overlay', (_e, m) => cb(m)),
});
