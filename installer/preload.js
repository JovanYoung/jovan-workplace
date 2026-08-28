// preload.js — expose installer API to the renderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  selectDir: () => ipcRenderer.invoke('select-dir'),
  checkLegacy: () => ipcRenderer.invoke('check-legacy'),
  defaults: () => ipcRenderer.invoke('defaults'),
  install: (opts) => ipcRenderer.invoke('install', opts),
  onProgress: (cb) => ipcRenderer.on('progress', (e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (e, m) => cb(m))
});
