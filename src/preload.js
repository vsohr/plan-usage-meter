'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height',
  WIN_MODE_SET:  'window:set-mode',
  WIN_MODE:      'window:mode'
});

contextBridge.exposeInMainWorld('api', Object.freeze({
  onUsage(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, usage) => cb(usage);
    ipcRenderer.on(CH.USAGE_UPDATE, handler);
    return () => ipcRenderer.removeListener(CH.USAGE_UPDATE, handler);
  },
  onMode(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, mode) => cb(mode);
    ipcRenderer.on(CH.WIN_MODE, handler);
    return () => ipcRenderer.removeListener(CH.WIN_MODE, handler);
  },
  refreshNow() { return ipcRenderer.invoke(CH.USAGE_REFRESH); },
  setMode(mode) { ipcRenderer.send(CH.WIN_MODE_SET, mode); },
  hide()       { ipcRenderer.send(CH.WIN_HIDE); },
  quit()       { ipcRenderer.send(CH.APP_QUIT); },
  reportHeight(px) { ipcRenderer.send(CH.WIN_HEIGHT, px); }
}));
