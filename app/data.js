// data.js — Local data layer for Jovan's Workplace.
// Owns workspace.json: fs read/write, atomic write (.tmp + rename), pre-write snapshots,
// daily backups (keep latest 30), ima cloud backup (mirrors dsh-bridge), and lunar/birthday math.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { Lunar, Solar } = require('./lib/lunar.js');

const SNAPSHOT_KEEP = 10;
const BACKUP_KEEP = 30;
const IMA_BASE = 'https://ima.qq.com';

let DATA_DIR = null;

function dataFile() { return path.join(DATA_DIR, 'workspace.json'); }
function backupsDir() { return path.join(DATA_DIR, 'backups'); }
function snapshotsDir() { return path.join(DATA_DIR, 'snapshots'); }

function setDataDir(dir) {
  DATA_DIR = dir;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(backupsDir(), { recursive: true });
  fs.mkdirSync(snapshotsDir(), { recursive: true });
}
function getDataDir() { return DATA_DIR; }

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function readData() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch (e) { return { rows: [] }; }
}

// Pre-write snapshot: copy current file before every mutation, keep latest N.
function snapshot() {
  try {
    const src = dataFile();
    if (!fs.existsSync(src)) return;
    fs.copyFileSync(src, path.join(snapshotsDir(), 'pre-write-' + stamp() + '.json'));
    const files = fs.readdirSync(snapshotsDir()).filter((f) => f.endsWith('.json')).sort();
    while (files.length > SNAPSHOT_KEEP) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(snapshotsDir(), oldest)); } catch (e) {}
    }
  } catch (e) {}
}

// Daily backup: one file per day, keep latest 30.
function ensureDailyBackup() {
  try {
    const src = dataFile();
    if (!fs.existsSync(src)) return;
    const dst = path.join(backupsDir(), 'workspace-' + todayStr() + '.json');
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      const files = fs.readdirSync(backupsDir()).filter((f) => f.endsWith('.json')).sort();
      while (files.length > BACKUP_KEEP) {
        const oldest = files.shift();
        try { fs.unlinkSync(path.join(backupsDir(), oldest)); } catch (e) {}
      }
    }
  } catch (e) {}
}

function writeData(obj) {
  snapshot();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile());
  ensureDailyBackup();
}

function rows() { return (readData().rows) || []; }
function findRow(id) {
  const rs = rows();
  for (let i = 0; i < rs.length; i++) if (rs[i]._id === id) return rs[i];
  return null;
}

// Normalize a smart-page-style property object {text|select|date|...} into a plain value.
function flat(v) {
  if (v && typeof v === 'object') return v.text !== undefined ? v.text : (v.select !== undefined ? v.select : (v.date !== undefined ? v.date : ''));
  return v;
}

function add(props) {
  const data = readData();
  const row = {};
  Object.keys(props || {}).forEach(function (k) { row[k] = flat(props[k]); });
  row._id = 'local_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
  data.rows = data.rows || [];
  data.rows.push(row);
  writeData(data);
  return row;
}

function update(id, props) {
  const data = readData();
  (data.rows || []).forEach(function (r) {
    if (r._id === id) {
      Object.keys(props || {}).forEach(function (k) { r[k] = flat(props[k]); });
    }
  });
  writeData(data);
}

function del(id) {
  const data = readData();
  data.rows = (data.rows || []).filter(function (r) { return r._id !== id; });
  writeData(data);
}

function fullTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function logOp(action, obj, title) {
  try {
    const data = readData();
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ymd = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
    data.rows = data.rows || [];
    data.rows.push({
      _id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
      标题: action + (obj ? ' ' + obj : '') + (title ? '：' + title : ''),
      类型: '日志', 状态: '待处理', 日期: ymd,
      详情: JSON.stringify({ action: action, obj: obj, title: title || '', time: fullTime(), actor: 'web' })
    });
    writeData(data);
  } catch (e) {}
}

// Mutate endpoint — mirrors dsh-bridge /data POST, including auto operation logging.
function mutate(action, payload) {
  const p = payload || {};
  if (action === 'add') {
    const row = add(p.props);
    if ((row['类型'] || '') !== '日志') logOp('添加', row['类型'] || '', row['标题'] || '');
    return { ok: true, row: row, rows: rows() };
  }
  if (action === 'update') {
    const prev = findRow(p.id);
    const prop = p.props || {};
    const tv = prop['删除时间'] && typeof prop['删除时间'] === 'object' ? prop['删除时间'].text : prop['删除时间'];
    update(p.id, p.props);
    if (prev && (prev['类型'] || '') !== '日志') {
      if (tv && !prev['删除时间']) logOp('删除', prev['类型'] || '', prev['标题'] || '');
      else if (!tv && prev['删除时间']) logOp('恢复', prev['类型'] || '', prev['标题'] || '');
      else logOp('修改', prev['类型'] || '', prev['标题'] || '');
    }
    return { ok: true, rows: rows() };
  }
  if (action === 'delete') {
    const prev = findRow(p.id);
    del(p.id);
    if (prev && (prev['类型'] || '') !== '日志' && !prev['删除时间']) logOp('删除', prev['类型'] || '', prev['标题'] || '');
    return { ok: true, rows: rows() };
  }
  return { ok: false, error: 'unknown action' };
}

// ---- lunar & birthday computation (mirrors dsh-bridge) ----
function cnNum(s) {
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const digits = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  if (s === '正' || s === '一') return 1;
  if (s === '十') return 10;
  if (s.startsWith('廿')) return 20 + (digits[s[1]] || 0);
  if (s.startsWith('十')) return 10 + (digits[s[1]] || 0);
  let sum = 0;
  for (const ch of s) { if (digits[ch]) sum = sum * 10 + digits[ch]; }
  return sum || 0;
}

function birthdayDatesOf(r, year) {
  const detail = r['详情'] || '';
  const out = [];
  const d = String(r['日期'] || '').slice(0, 10);
  if (d) {
    const p = d.split('-');
    let dd = new Date(year, parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    if (parseInt(p[1], 10) === 2 && parseInt(p[2], 10) === 29 && dd.getMonth() !== 1) dd = new Date(year, 1, 28);
    out.push({ label: '阳历', date: dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0') });
  }
  const m = detail.match(/农历[：:\s]*([正一二三四五六七八九十廿]+|\d{1,2})月([一二三四五六七八九十廿]+|\d{1,2})[日号]?/);
  if (m) {
    try {
      const s2 = Lunar.fromYmd(year, cnNum(m[1]), cnNum(m[2])).getSolar();
      out.push({ label: '农历', date: s2.toYmd() });
    } catch (e) {}
  }
  return out;
}

function bdayModeOf(r) {
  const t = r['类型'] || '';
  if (t === '生日') return 'all';
  return r['生日模式'] || '隐藏';
}

function filterDatesByMode(r, dates) {
  const mode = bdayModeOf(r);
  if (mode === '隐藏') return [];
  if (mode === '仅农历') return dates.filter((x) => x.label === '农历');
  if (mode === '仅阳历') return dates.filter((x) => x.label === '阳历');
  return dates;
}

function birthdaysOfYear(year) {
  const out = [];
  rows().forEach(function (r) {
    if (!(r['类型'] === '生日' || r['类型'] === '亲友')) return;
    out.push({ id: r._id || '', name: r['标题'] || '', dates: filterDatesByMode(r, birthdayDatesOf(r, year)) });
  });
  return out;
}

function computeBirthdays() {
  const today = new Date();
  const y = today.getFullYear();
  const out = [];
  rows().forEach(function (r) {
    if (!(r['类型'] === '生日' || r['类型'] === '亲友')) return;
    const name = r['标题'] || '';
    const dates = [];
    filterDatesByMode(r, birthdayDatesOf(r, y)).forEach(function (item) {
      let bd = item.date;
      const todayD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let daysLeft = Math.round((new Date(bd + 'T00:00:00') - todayD) / 86400000);
      if (daysLeft < 0) {
        const next = birthdayDatesOf(r, y + 1).filter((x) => x.label === item.label)[0];
        if (next) { bd = next.date; daysLeft = Math.round((new Date(bd + 'T00:00:00') - todayD) / 86400000); }
      }
      dates.push({ label: item.label, date: bd, daysLeft: daysLeft });
    });
    out.push({ id: r._id || '', name: name, dates: dates });
  });
  return out;
}

function conv(mode, params) {
  const p = params || {};
  try {
    if (mode === 'solar2lunar') {
      const d = (p.date || '').split('-');
      const l = Solar.fromYmd(parseInt(d[0], 10), parseInt(d[1], 10), parseInt(d[2], 10)).getLunar();
      return { ok: true, lunarMonth: l.getMonth(), lunarDay: l.getDay(), lunarText: l.getMonth() + '月' + l.getDay() + '日' };
    }
    if (mode === 'lunar2solar') {
      const s = Lunar.fromYmd(parseInt(p.year, 10), parseInt(p.lm, 10), parseInt(p.ld, 10)).getSolar();
      return { ok: true, solarDate: s.toYmd(), solarText: s.getMonth() + '月' + s.getDay() + '日' };
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  return { ok: false, error: 'bad params' };
}

// ---- ima cloud backup (mirrors dsh-bridge backupToIma) ----
function imaReq(clientId, apiKey, apiPath, body) {
  return fetch(IMA_BASE + '/' + apiPath, {
    method: 'POST',
    headers: {
      'ima-openapi-clientid': clientId,
      'ima-openapi-apikey': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).then((r) => r.json()).catch((e) => ({ code: -1, msg: String(e.message || e) }));
}

// COS PUT object upload, implemented inline (no external script / node binary needed).
function cosUpload(cred, fileBuf, contentType) {
  return new Promise((resolve, reject) => {
    const secretId = cred.secret_id;
    const secretKey = cred.secret_key;
    const token = cred.token;
    const bucket = cred.bucket_name;
    const region = cred.region;
    const cosKey = cred.cos_key;

    const startTime = Math.floor(Date.now() / 1000);
    const expiredTime = startTime + 3600;
    const keyTime = startTime + ';' + expiredTime;

    function hmacSha1(key, data) { return crypto.createHmac('sha1', key).update(data).digest('hex'); }
    function sha1(data) { return crypto.createHash('sha1').update(data).digest('hex'); }

    const hostname = bucket + '.cos.' + region + '.myqcloud.com';
    const pathname = '/' + cosKey;
    const signHeaders = { 'content-length': String(fileBuf.length), host: hostname };

    const signKey = hmacSha1(secretKey, keyTime);
    const headerKeys = Object.keys(signHeaders).sort();
    const httpHeaders = headerKeys.map((k) => k.toLowerCase() + '=' + encodeURIComponent(signHeaders[k])).join('&');
    const httpString = 'put\n' + pathname + '\n\n' + httpHeaders + '\n';
    const stringToSign = 'sha1\n' + keyTime + '\n' + sha1(httpString) + '\n';
    const signature = hmacSha1(signKey, stringToSign);
    const headerList = headerKeys.map((k) => k.toLowerCase()).join(';');
    const authorization = [
      'q-sign-algorithm=sha1',
      'q-ak=' + secretId,
      'q-sign-time=' + keyTime,
      'q-key-time=' + keyTime,
      'q-header-list=' + headerList,
      'q-url-param-list=',
      'q-signature=' + signature
    ].join('&');

    const req = https.request({
      hostname, port: 443, path: pathname, method: 'PUT',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': fileBuf.length,
        Authorization: authorization,
        'x-cos-security-token': token
      },
      timeout: 300000
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode });
        else reject(new Error('cos put ' + res.statusCode + ' ' + body.slice(0, 200)));
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(new Error('cos upload timeout')); });
    req.end(fileBuf);
  });
}

async function imaBackup(clientId, apiKey) {
  if (!clientId || !apiKey) return { ok: false, error: 'ima 未配置' };
  const data = readData();
  const kbList = await imaReq(clientId, apiKey, 'openapi/wiki/v1/get_addable_knowledge_base_list', { cursor: '', limit: 20 });
  const list = (kbList.data && kbList.data.addable_knowledge_base_list) || [];
  const kb = list[0];
  if (!kb) throw new Error('no addable ima knowledge base (code ' + kbList.code + ')');
  const text = JSON.stringify(data, null, 2);
  const buf = Buffer.from(text, 'utf8');
  const fileName = 'workspace-backup-' + new Date().toISOString().slice(0, 10) + '.txt';
  const m = await imaReq(clientId, apiKey, 'openapi/wiki/v1/create_media', {
    file_name: fileName, file_size: buf.length,
    content_type: 'text/plain', knowledge_base_id: kb.id, file_ext: 'txt'
  });
  const md = m.data;
  if (!md || !md.cos_credential) throw new Error('create_media failed: ' + JSON.stringify(m).slice(0, 200));
  const cred = md.cos_credential;
  await cosUpload(cred, buf, 'text/plain');
  const a = await imaReq(clientId, apiKey, 'openapi/wiki/v1/add_knowledge', {
    media_type: 13, media_id: md.media_id, title: fileName, knowledge_base_id: kb.id,
    file_info: { cos_key: cred.cos_key, file_size: buf.length, last_modify_time: Math.floor(Date.now() / 1000), file_name: fileName }
  });
  if (a.code !== 0) throw new Error('add_knowledge failed: ' + JSON.stringify(a).slice(0, 200));
  return { ok: true, kb: kb.name, fileName: fileName };
}

module.exports = {
  setDataDir, getDataDir,
  readData, writeData, rows, findRow,
  add, update, del, logOp, mutate,
  birthdaysOfYear, computeBirthdays, conv,
  imaBackup,
  dataFile, backupsDir, snapshotsDir
};
