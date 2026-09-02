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
  },
  // Agent tool loop (Step 1+2): onEvent receives {type,...} events; returns final {ok, content, usage, rounds}.
  aiAgent: (provider, model, messages, thinking, onEvent) => {
    const listener = (e, data) => { if (typeof onEvent === 'function') onEvent(data); };
    ipcRenderer.on('ai:agent-event', listener);
    return ipcRenderer.invoke('ai:agent', provider, model, messages, thinking).finally(function () {
      ipcRenderer.removeListener('ai:agent-event', listener);
    });
  },
  aiParse: (text, pro) => ipcRenderer.invoke('ai:parse', text, pro),
  aiDetect: (messages) => ipcRenderer.invoke('ai:detect', messages),
  aiDictLoad: () => ipcRenderer.invoke('ai:dict-load'),
  aiDictSave: (dict) => ipcRenderer.invoke('ai:dict-save', dict),
  aiDictClear: () => ipcRenderer.invoke('ai:dict-clear'),
  aiConfirmDraft: (draft) => ipcRenderer.invoke('ai:confirm-draft', draft),
  // Subject-AI conversations (M3)
  convList: () => ipcRenderer.invoke('conv:list'),
  convCreate: (subject, title) => ipcRenderer.invoke('conv:create', subject, title),
  convOpen: (id) => ipcRenderer.invoke('conv:open', id),
  convRename: (id, title) => ipcRenderer.invoke('conv:rename', id, title),
  convClear: (id) => ipcRenderer.invoke('conv:clear', id),
  convSearch: (q) => ipcRenderer.invoke('conv:search', q),
  convSend: (id, provider, model, text, thinking, onChunk) => {
    const listener = (e, data) => { if (typeof onChunk === 'function') onChunk(data); };
    ipcRenderer.on('conv:chunk', listener);
    return ipcRenderer.invoke('conv:send', id, provider, model, text, thinking).finally(function () {
      ipcRenderer.removeListener('conv:chunk', listener);
    });
  },
  // L3 fact memory (M4)
  memExtract: (messages) => ipcRenderer.invoke('mem:extract', messages),
  memAdd: (payload) => ipcRenderer.invoke('mem:add', payload),
  memConfirm: (payload) => ipcRenderer.invoke('mem:confirm', payload),
  memList: () => ipcRenderer.invoke('mem:list'),
  memDelete: (id) => ipcRenderer.invoke('mem:delete', id),
  // G2 skill library (M4)
  skillList: () => ipcRenderer.invoke('skill:list'),
  skillSave: (payload) => ipcRenderer.invoke('skill:save', payload),
  skillDelete: (id) => ipcRenderer.invoke('skill:delete', id),
  skillToggle: (id) => ipcRenderer.invoke('skill:toggle', id),
  skillExtract: (conversation, toolTrace) => ipcRenderer.invoke('skill:extract', conversation, toolTrace)
});
