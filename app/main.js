// main.js — Electron main process for Jovan's Workplace.
// Single-instance lock, system tray (close = hide to tray), data dir selection,
// ima key management via safeStorage (Windows DPAPI), IPC handlers for the data layer.
'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const data = require('./data.js');
const ai = require('./ai.js');

const APP_NAME = "Jovan's Workplace";
const DEFAULT_DATA_DIR = path.join('D:', "Jovan's Workplace", 'data');
const LEGACY_DATA_FILE = path.join('D:', 'dsh-data', 'workspace.json');
const IMA_CLIENT_ID = '9b765523649f5c54ae5fb39619c64137';

let win = null;
let tray = null;
let isQuitting = false;

// ---- config (userData) ----
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function imaConfigPath() { return path.join(app.getPath('userData'), 'ima.json'); }
function loadConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (e) { return {}; } }
function saveConfig(cfg) { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8'); }

// ---- data dir selection (first run) ----
function chooseDataDir() {
  let cfg = loadConfig();
  if (cfg.dataDir && fs.existsSync(cfg.dataDir)) return cfg.dataDir;

  const legacyExists = fs.existsSync(LEGACY_DATA_FILE);
  if (legacyExists) {
    const r = dialog.showMessageBoxSync({
      type: 'question',
      title: APP_NAME + ' · 首次设置',
      message: '检测到旧数据',
      detail: '在 D:\\dsh-data\\workspace.json 检测到旧版数据。是否一键接管，直接沿用该数据文件？',
      buttons: ['一键接管旧数据', '选择新文件夹'],
      defaultId: 0, cancelId: 1
    });
    if (r === 0) {
      cfg.dataDir = path.dirname(LEGACY_DATA_FILE);
      saveConfig(cfg);
      return cfg.dataDir;
    }
  }

  const chosen = dialog.showOpenDialogSync({
    title: APP_NAME + ' · 选择数据存储文件夹',
    defaultPath: DEFAULT_DATA_DIR,
    properties: ['openDirectory', 'createDirectory']
  });
  if (chosen && chosen[0]) {
    cfg.dataDir = chosen[0];
    saveConfig(cfg);
    return cfg.dataDir;
  }
  // Fallback to default.
  cfg.dataDir = DEFAULT_DATA_DIR;
  saveConfig(cfg);
  return DEFAULT_DATA_DIR;
}

// ---- ima key (safeStorage-encrypted, local only) ----
function readImaCfg() { try { return JSON.parse(fs.readFileSync(imaConfigPath(), 'utf8')); } catch (e) { return {}; } }
function writeImaCfg(cfg) { fs.writeFileSync(imaConfigPath(), JSON.stringify(cfg, null, 2), 'utf8'); }
function imaHasKey() {
  const cfg = readImaCfg();
  return !!(cfg.apiKeyEnc && safeStorage.isEncryptionAvailable());
}
function imaSetKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '系统不支持安全加密' };
  const enc = safeStorage.encryptString(String(apiKey || '')).toString('base64');
  writeImaCfg({ clientId: IMA_CLIENT_ID, apiKeyEnc: enc });
  return { ok: true };
}
function imaGetKey() {
  if (!imaHasKey()) return null;
  const cfg = readImaCfg();
  try { return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64')); } catch (e) { return null; }
}

// ---- window & tray ----
function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 640,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
  tray.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: '打开 ' + APP_NAME, click: () => showWin() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWin());
}

// ---- IPC handlers ----
function registerIpc() {
  ipcMain.handle('data:load', () => ({ rows: data.rows(), birthdays: data.computeBirthdays() }));
  ipcMain.handle('data:mutate', (e, action, payload) => data.mutate(action, payload));
  ipcMain.handle('data:birthdays', (e, year) => ({ year: year, birthdays: data.birthdaysOfYear(year) }));
  ipcMain.handle('data:conv', (e, mode, params) => data.conv(mode, params));
  ipcMain.handle('data:backup-now', () => {
    try { data.writeData(data.readData()); return { ok: true, backups: data.backupsDir() }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('data:ima-has-key', () => ({ has: imaHasKey() }));
  ipcMain.handle('data:ima-set-key', (e, apiKey) => imaSetKey(apiKey));
  ipcMain.handle('data:ima-backup', async () => {
    const key = imaGetKey();
    if (!key) return { ok: false, error: 'ima 未配置，请在设置里填写 API Key' };
    try { return await data.imaBackup(IMA_CLIENT_ID, key); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ---- AI gateway (built-in, replaces dsh bridge) ----
  ipcMain.handle('ai:list-providers', () => ({ providers: ai.listProviders() }));
  ipcMain.handle('ai:save-key', (e, provider, apiKey) => ai.setKey(provider, apiKey));
  ipcMain.handle('ai:test', async (e, provider) => await ai.test(provider));
  ipcMain.handle('ai:set-custom-models', (e, pid, names) => ai.setCustomModels(pid, names));
  ipcMain.handle('ai:chat', async (e, provider, model, messages) => {
    const sender = e.sender;
    const full = [{ role: 'system', content: ai.SYSTEM_PROMPT }].concat(messages || []);
    try {
      const r = await ai.chat({
        provider: provider,
        model: model,
        messages: full,
        onChunk: function (delta) {
          if (sender && !sender.isDestroyed()) sender.send('ai:chunk', { delta: delta });
        }
      });
      return { ok: true, content: r.content, usage: r.usage, cost: r.cost };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('dialog:export', (e, json, suggestedName) => {
    const r = dialog.showSaveDialogSync(win, {
      title: '导出数据备份',
      defaultPath: suggestedName || ('workspace-backup.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!r) return { ok: false, canceled: true };
    try { fs.writeFileSync(r, json, 'utf8'); return { ok: true, path: r }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('dialog:import', () => {
    const r = dialog.showOpenDialogSync(win, {
      title: '导入数据备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!r || !r[0]) return { ok: false, canceled: true };
    try { return { ok: true, path: r[0], content: fs.readFileSync(r[0], 'utf8') }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  });

  ipcMain.handle('app:get-data-path', () => ({ dataDir: data.getDataDir(), dataFile: data.dataFile() }));

  ipcMain.handle('notify', (e, title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title: String(title || ''), body: String(body || ''), icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    }
    return { ok: true };
  });
}

// ---- app lifecycle ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWin());

  app.whenReady().then(() => {
    const dataDir = chooseDataDir();
    data.setDataDir(dataDir);
    registerIpc();
    createWindow();
    createTray();

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showWin(); });
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.on('window-all-closed', () => {
    // Keep running in tray on all platforms for this app.
  });
}
