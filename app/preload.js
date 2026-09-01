// preload.js — expose a minimal, safe API to the renderer via contextBridge.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workplace', {
  loadData: () => ipcRenderer.invoke('data:load'),
  mutate: (action, payload) => ipcRenderer.invoke('data:mutate', action, payload),
  birthdays: (year) => ipcRenderer.invoke('data:birthdays', year),
  conv: (mode, params) => ipcRenderer.invoke('data:conv', mode, params),
  backupNow: () => ipcRenderer.invoke('data:backup-now'),
  imaHasKey: () => ipcRenderer.invoke('data:ima-has-key'),
  imaSetKey: (apiKey) => ipcRenderer.invoke('data:ima-set-key', apiKey),
  imaBackup: () => ipcRenderer.invoke('data:ima-backup'),
  exportData: (json, suggestedName) => ipcRenderer.invoke('dialog:export', json, suggestedName),
  importData: () => ipcRenderer.invoke('dialog:import'),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  getDataPath: () => ipcRenderer.invoke('app:get-data-path'),
  aiListProviders: () => ipcRenderer.invoke('ai:list-providers'),
  aiSaveKey: (provider, apiKey) => ipcRenderer.invoke('ai:save-key', provider, apiKey),
  aiTest: (provider) => ipcRenderer.invoke('ai:test', provider),
  aiSetCustomModels: (pid, names) => ipcRenderer.invoke('ai:set-custom-models', pid, names),
  // Streaming chat: onChunk receives {delta} per token; returns final {ok, content, usage, cost}.
  aiChat: (provider, model, messages, onChunk) => {
    const listener = (e, data) => { if (typeof onChunk === 'function') onChunk(data); };
    ipcRenderer.on('ai:chunk', listener);
    return ipcRenderer.invoke('ai:chat', provider, model, messages).finally(function () {
      ipcRenderer.removeListener('ai:chunk', listener);
    });
  }
});
