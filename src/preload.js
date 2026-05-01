'use strict';
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', Object.freeze({
  // M2 wires onUsage / refreshNow / hide / quit / reportHeight here.
  __preloadVersion: '0.1.0'
}));
