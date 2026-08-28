// main.js — Installer/bootstrapper main process for Jovan's Workplace.
// Three-step wizard: data dir -> ima backup -> confirm. Then download, SHA256 verify,
// extract to %LOCALAPPDATA%, write config, create desktop shortcut, launch main app.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const extract = require('extract-zip');

// ---- constants (filled in after the main app is built) ----
const DOWNLOAD_URL = '';      // TODO: HTTPS URL of the main app green zip
const EXPECTED_SHA256 = '282fcb66d6acf157ac30682a0078d433a44fab14dcb287c68e131b0d6ccf9715';
const PRODUCT_NAME = "Jovan's Workplace";
const EXE_NAME = "Jovan's Workplace.exe";
const APP_DIR_NAME = "Jovan's Workplace";

const DEFAULT_DATA_DIR = path.join('D:', "Jovan's Workplace", 'data');
const LEGACY_DATA_FILE = path.join('D:', 'dsh-data', 'workspace.json');
const IMA_CLIENT_ID = '9b765523649f5c54ae5fb39619c64137';

let win = null;

function configDir() { return path.join(app.getPath('appData'), APP_DIR_NAME); }

// Install target: %LOCALAPPDATA%\Jovan's Workplace
function targetInstallDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, APP_DIR_NAME);
}

function createWindow() {
  win = new BrowserWindow({
    width: 560, height: 640, resizable: false, minimizable: true,
    title: PRODUCT_NAME + ' 安装向导',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) { if (win) win.webContents.send(channel, payload); }

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return resolve(download(res.headers.location, dest, onProgress));
      }
      if (res.statusCode !== 200) { file.close(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(Math.min(99, Math.round(received / total * 100)), received, total);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', (e) => { file.close(); reject(e); });
    req.setTimeout(60000, () => { req.destroy(new Error('download timeout')); });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

function writeConfig(dataDir) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ dataDir: dataDir }, null, 2), 'utf8');
}

function writeIma(apiKey) {
  if (!apiKey || !apiKey.trim()) return;
  if (!safeStorage.isEncryptionAvailable()) return;
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const enc = safeStorage.encryptString(apiKey.trim()).toString('base64');
  fs.writeFileSync(path.join(dir, 'ima.json'), JSON.stringify({ clientId: IMA_CLIENT_ID, apiKeyEnc: enc }, null, 2), 'utf8');
}

function createShortcut(targetDir) {
  const exe = path.join(targetDir, EXE_NAME);
  const desktop = app.getPath('desktop');
  const lnk = path.join(desktop, PRODUCT_NAME + '.lnk');
  return shell.writeShortcutLink(lnk, 'create', {
    target: exe, cwd: targetDir, description: PRODUCT_NAME, icon: exe, iconIndex: 0
  });
}

function launchApp(targetDir) {
  const exe = path.join(targetDir, EXE_NAME);
  if (!fs.existsSync(exe)) return Promise.reject(new Error('找不到主程序 exe：' + exe));
  const { spawn } = require('child_process');
  const child = spawn(exe, [], { cwd: targetDir, detached: true, stdio: 'ignore' });
  child.unref();
  return Promise.resolve();
}

async function runInstall({ dataDir, imaKey, createShortcut, localZip }) {
  const tmp = path.join(os.tmpdir(), 'jw-installer-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const zipPath = path.join(tmp, 'app.zip');

  try {
    if (localZip) {
      // Use a local zip file directly (no download).
      send('progress', { step: '准备', percent: 0, text: '使用本地 zip：' + localZip });
      fs.copyFileSync(localZip, zipPath);
    } else {
      if (!DOWNLOAD_URL) throw new Error('下载地址未配置，请先在 main.js 填写 DOWNLOAD_URL');
      send('progress', { step: '下载', percent: 0, text: '正在下载主程序…' });
      await download(DOWNLOAD_URL, zipPath, (p, r, t) => {
        send('progress', { step: '下载', percent: p, text: '正在下载主程序… ' + (r / 1048576).toFixed(1) + ' / ' + (t / 1048576).toFixed(1) + ' MB' });
      });
    }

    // SHA256 verify
    send('progress', { step: '校验', percent: 99, text: '正在校验文件完整性…' });
    if (EXPECTED_SHA256) {
      const actual = await sha256File(zipPath);
      if (actual.toLowerCase() !== EXPECTED_SHA256.toLowerCase()) {
        throw new Error('SHA256 校验失败：文件可能损坏或被篡改。\n期望 ' + EXPECTED_SHA256 + '\n实际 ' + actual);
      }
    }

    // Extract
    const target = targetInstallDir();
    send('progress', { step: '解压', percent: 99, text: '正在解压到 ' + target + ' …' });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    await extract(zipPath, { dir: target });

    // Config + ima key
    writeConfig(dataDir);
    writeIma(imaKey);

    // Shortcut
    if (createShortcut) {
      try { createShortcut(target); } catch (e) { send('log', '快捷方式创建失败：' + e.message); }
    }

    // Launch
    await launchApp(target);
    send('progress', { step: '完成', percent: 100, text: '安装完成' });
    return { ok: true, installDir: target };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

ipcMain.handle('select-dir', () => {
  const r = dialog.showOpenDialogSync(win, {
    title: '选择数据存储文件夹',
    defaultPath: DEFAULT_DATA_DIR,
    properties: ['openDirectory', 'createDirectory']
  });
  return r && r[0] ? r[0] : null;
});

ipcMain.handle('check-legacy', () => ({ exists: fs.existsSync(LEGACY_DATA_FILE), path: LEGACY_DATA_FILE }));

ipcMain.handle('defaults', () => ({ defaultDataDir: DEFAULT_DATA_DIR, legacy: LEGACY_DATA_FILE }));

ipcMain.handle('install', async (e, opts) => {
  try {
    const r = await runInstall(opts || {});
    return r;
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
