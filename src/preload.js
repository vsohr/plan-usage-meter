'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});

contextBridge.exposeInMainWorld('api', Object.freeze({
  onUsage(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, usage) => cb(usage);
    ipcRenderer.on(CH.USAGE_UPDATE, handler);
    return () => ipcRenderer.removeListener(CH.USAGE_UPDATE, handler);
  },
  refreshNow() { return ipcRenderer.invoke(CH.USAGE_REFRESH); },
  hide()       { ipcRenderer.send(CH.WIN_HIDE); },
  quit()       { ipcRenderer.send(CH.APP_QUIT); },
  reportHeight(px) { ipcRenderer.send(CH.WIN_HEIGHT, px); }
}));
