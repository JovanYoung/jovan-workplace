// conv.js — Subject-AI conversation manager + history search (main process, M3).
// Persists conversations + messages in SQLite ({DATA_DIR}/conversations.db) via
// node:sqlite (DatabaseSync). Each subject keeps an isolated context. Long sessions
// are window-compressed (oldest rounds summarized by the LLM). Search uses FTS5
// (trigram) + LIKE fallback so 2-char Chinese keywords also hit.
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const data = require('./data.js');
const ai = require('./ai.js');
const skills = require('./skills.js');

// Window compression thresholds (rounds = user+assistant pair = 2 messages).
const WINDOW_MAX = 20;      // compress once total messages exceed 20 rounds
const COMPRESS_OLD = 10;    // summarize the oldest 10 rounds
const INJECT_TOP = 5;       // max study materials injected into system prompt
const MATERIAL_TAGS = ['笔记', 'tut', 'lect']; // study content rows (exclude 学期/科目)

let db = null;

function dbPath() { return path.join(data.getDataDir(), 'conversations.db'); }

// Kept for isolated regression scripts. The desktop app keeps its database open
// for its full lifetime and does not call this during ordinary use.
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

// ---- open + schema ----
function init() {
  if (db) return db;
  const p = dbPath();
  db = new DatabaseSync(p);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conv_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, tokenize='trigram');
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      fact TEXT NOT NULL,              -- fact content ("用户雅思备考中")
      category TEXT DEFAULT 'pref',    -- pref=偏好 / correct=纠正 / habit=习惯 / background=背景
      source_conv TEXT,                -- evidence: source conversation id (null = manual/Agent)
      source_ts INTEGER,               -- evidence: timestamp
      status TEXT DEFAULT 'active',    -- active / dismissed (soft delete)
      created_at INTEGER
    );
  `);
  ensureMessageColumn('message_uid', 'TEXT');
  ensureMessageColumn('is_current', 'INTEGER NOT NULL DEFAULT 1');
  ensureMessageColumn('is_archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureMessageColumn('replaces_message_id', 'INTEGER');
  ensureMessageColumn('metadata_json', 'TEXT');
  ensureConversationColumn('parent_conv_id', 'TEXT');
  ensureConversationColumn('fork_message_id', 'INTEGER');
  ensureConversationColumn('branch_label', 'TEXT');
  db.prepare("UPDATE messages SET message_uid = 'm_' || id WHERE message_uid IS NULL OR message_uid = ''").run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uid ON messages(message_uid);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_active ON messages(conv_id, is_current, is_archived, ts, id);');
  return db;
}

function ensureMessageColumn(name, declaration) {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  if (!cols.some(function (c) { return c.name === name; })) db.exec('ALTER TABLE messages ADD COLUMN ' + name + ' ' + declaration);
}
function ensureConversationColumn(name, declaration) {
  const cols = db.prepare('PRAGMA table_info(conversations)').all();
  if (!cols.some(function (c) { return c.name === name; })) db.exec('ALTER TABLE conversations ADD COLUMN ' + name + ' ' + declaration);
}

function now() { return Date.now(); }
function genId(prefix) { return prefix + '_' + now() + '_' + Math.floor(Math.random() * 9999); }

// ---- conversations ----
function createConversation(subject, title) {
  init();
  const id = genId('c');
  const t = now();
  const s = String(subject || '').trim() || '未命名';
  const ti = String(title || '').trim() || s;
  db.prepare('INSERT INTO conversations (id, subject, title, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, s, ti, t, t);
  return { id: id, subject: s, title: ti, created_at: t, updated_at: t };
}

// A branch owns a private copy of its ancestor chain, so sibling context never
// reaches later model calls while the original history remains intact.
function createBranch(sourceId, forkMessageId, label) {
  init();
  const source = getConversation(sourceId);
  if (!source) return { ok: false, error: '源会话不存在' };
  const fork = db.prepare('SELECT id, ts FROM messages WHERE id = ? AND conv_id = ?').get(forkMessageId, sourceId);
  if (!fork) return { ok: false, error: '分叉节点不存在' };
  const id = genId('c');
  const t = now();
  const branchLabel = String(label || '').trim() || ('分支 ' + new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  db.prepare('INSERT INTO conversations (id, subject, title, created_at, updated_at, parent_conv_id, fork_message_id, branch_label) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, source.subject, branchLabel, t, t, sourceId, forkMessageId, branchLabel);
  const ancestors = db.prepare('SELECT role, content, ts, is_archived, metadata_json FROM messages WHERE conv_id = ? AND is_current = 1 AND (ts < ? OR (ts = ? AND id <= ?)) ORDER BY ts ASC, id ASC')
    .all(sourceId, fork.ts, fork.ts, forkMessageId);
  const insert = db.prepare('INSERT INTO messages (message_uid, conv_id, role, content, ts, is_archived, metadata_json) VALUES (?,?,?,?,?,?,?)');
  const insertFts = db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?,?)');
  try {
    db.exec('BEGIN IMMEDIATE');
    ancestors.forEach(function (m) {
      const r = insert.run(genId('m'), id, m.role, m.content, m.ts, m.is_archived || 0, m.metadata_json || null);
      insertFts.run(r.lastInsertRowid, m.content);
    });
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) {}
    return { ok: false, error: String(err.message || err) };
  }
  return { ok: true, branch: { id: id, subject: source.subject, title: branchLabel, parent_conv_id: sourceId, fork_message_id: forkMessageId, branch_label: branchLabel, created_at: t, updated_at: t }, copied_messages: ancestors.length };
}

function listConversations() {
  init();
  const convs = db.prepare('SELECT id, subject, title, created_at, updated_at, parent_conv_id, fork_message_id, branch_label FROM conversations ORDER BY updated_at DESC').all();
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?');
  return convs.map(function (c) {
    const row = countStmt.get(c.id);
    return { id: c.id, subject: c.subject, title: c.title, created_at: c.created_at, updated_at: c.updated_at, parent_conv_id: c.parent_conv_id || null, fork_message_id: c.fork_message_id || null, branch_label: c.branch_label || null, msg_count: row ? row.n : 0 };
  });
}

function getConversation(id) {
  init();
  return db.prepare('SELECT id, subject, title, created_at, updated_at, parent_conv_id, fork_message_id, branch_label FROM conversations WHERE id = ?').get(id) || null;
}

function renameConversation(id, title) {
  init();
  const ti = String(title || '').trim();
  if (!ti) return { ok: false, error: '标题不能为空' };
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(ti, now(), id);
  return { ok: true, title: ti };
}

function clearConversation(id) {
  init();
  db.prepare('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE conv_id = ?)').run(id);
  db.prepare('DELETE FROM messages WHERE conv_id = ?').run(id);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id);
  return { ok: true };
}

function touchConversation(id) {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id);
}

function deleteConversation(id) {
  init();
  const conv = getConversation(id);
  if (!conv) return { ok: false, error: '会话不存在' };
  // delete messages + their FTS rows (messages_fts has no FK cascade)
  db.prepare('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE conv_id = ?)').run(id);
  db.prepare('DELETE FROM messages WHERE conv_id = ?').run(id);
  // detach facts that cite this conversation as evidence — keep the fact, drop the backlink
  db.prepare('UPDATE facts SET source_conv = NULL WHERE source_conv = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  return { ok: true };
}

// ---- messages ----
function parseMetadata(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function appendMessage(id, role, content, metadata) {
  init();
  const ts = now();
  const messageUid = genId('m');
  const r = db.prepare('INSERT INTO messages (message_uid, conv_id, role, content, ts, metadata_json) VALUES (?,?,?,?,?,?)')
    .run(messageUid, id, role, String(content || ''), ts, metadata ? JSON.stringify(metadata) : null);
  // keep FTS index in sync (manual double-write)
  db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?,?)').run(r.lastInsertRowid, String(content || ''));
  touchConversation(id);
  return { id: Number(r.lastInsertRowid), message_uid: messageUid, ts: ts };
}

function replaceAssistantMessage(convId, replacesMessageId, content, metadata) {
  init();
  const previous = db.prepare('SELECT id FROM messages WHERE id = ? AND conv_id = ? AND role = ? AND is_current = 1')
    .get(replacesMessageId, convId, 'assistant');
  if (!previous) return { ok: false, error: '待替换消息不存在或已过期' };
  const ts = now();
  const messageUid = genId('m');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE messages SET is_current = 0 WHERE id = ?').run(replacesMessageId);
    const r = db.prepare('INSERT INTO messages (message_uid, conv_id, role, content, ts, replaces_message_id, metadata_json) VALUES (?,?,?,?,?,?,?)')
      .run(messageUid, convId, 'assistant', String(content || ''), ts, replacesMessageId, metadata ? JSON.stringify(metadata) : null);
    db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?,?)').run(r.lastInsertRowid, String(content || ''));
    touchConversation(convId);
    db.exec('COMMIT');
    return { ok: true, message: { id: Number(r.lastInsertRowid), message_uid: messageUid, ts: ts } };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) {}
    return { ok: false, error: String(err.message || err) };
  }
}

function getMessages(id, options) {
  init();
  const includeArchived = !!(options && options.includeArchived);
  const sql = 'SELECT id, message_uid, role, content, ts, is_current, is_archived, replaces_message_id, metadata_json FROM messages WHERE conv_id = ? AND is_current = 1' +
    (includeArchived ? '' : ' AND is_archived = 0') + ' ORDER BY ts ASC, id ASC';
  return db.prepare(sql).all(id);
}

function loadConversation(id) {
  init();
  const conv = getConversation(id);
  if (!conv) return { ok: false, error: '会话不存在' };
  const msgs = getMessages(id).map(function (m) {
    return { id: m.id, message_uid: m.message_uid, role: m.role, content: m.content, ts: m.ts, metadata: parseMetadata(m.metadata_json) };
  });
  return { ok: true, conv: conv, messages: msgs };
}

// ---- window compression (L1) ----
async function summarize(messages, provider, model) {
  const text = messages.map(function (m) {
    return (m.role === 'assistant' ? '助手：' : '用户：') + m.content;
  }).join('\n');
  const r = await ai.chatOnce({
    provider: provider, model: model, thinking: 'off',
    messages: [
      { role: 'system', content: '你是会话摘要助手。把下面的对话压缩成一段简洁摘要，保留关键事实、结论和用户偏好，200 字以内，用中文。' },
      { role: 'user', content: text }
    ]
  });
  return (r.message && r.message.content) ? r.message.content : '';
}

// Compress oldest rounds into a summary message. Returns true if compressed.
async function compressIfNeeded(id, provider, model) {
  init();
  const msgs = getMessages(id);
  const contentMsgs = msgs.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
  if (contentMsgs.length <= WINDOW_MAX * 2) return false;

  const old = contentMsgs.slice(0, COMPRESS_OLD * 2);
  const summary = await summarize(old, provider, model);
  if (!summary) return false;

  // Archive summarized messages instead of deleting them. This preserves original
  // nodes for branching and audit while excluding them from the default context.
  const oldIds = old.map(function (m) { return m.id; });
  const placeholders = oldIds.map(function () { return '?'; }).join(',');
  db.prepare('UPDATE messages SET is_archived = 1 WHERE id IN (' + placeholders + ')').run(...oldIds);

  // insert summary as a special message, timestamped at the front of the window
  const firstTs = old[0] ? old[0].ts : now();
  const r = db.prepare('INSERT INTO messages (message_uid, conv_id, role, content, ts, metadata_json) VALUES (?,?,?,?,?,?)')
    .run(genId('m'), id, 'summary', summary, firstTs, JSON.stringify({ archived_message_ids: oldIds }));
  db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?,?)').run(r.lastInsertRowid, summary);
  return true;
}

// ---- study material injection (L4 prototype) ----
// Score the subject's study notes by n-gram overlap with the question; top N.
function studyMaterials(subject, question) {
  const rows = data.rows().filter(function (r) {
    return (r['类型'] || '') === '学习'
      && MATERIAL_TAGS.indexOf(r['标签'] || '') >= 0
      && String(r['科目'] || '').trim() === String(subject || '').trim();
  });
  if (!rows.length) return [];
  const q = String(question || '').trim();
  const grams = [];
  if (q) {
    for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
  }
  const scored = rows.map(function (r) {
    const text = (r['标题'] || '') + ' ' + (r['详情'] || '');
    let score = 0;
    grams.forEach(function (g) { if (text.indexOf(g) >= 0) score++; });
    return { r: r, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, INJECT_TOP).map(function (s) {
    return { 标题: s.r['标题'] || '', 详情: s.r['详情'] || '' };
  });
}

// ---- L3 fact memory (facts table in the same SQLite db) ----
const FACT_CATEGORIES = ['pref', 'correct', 'habit', 'background'];
const FACT_CATEGORY_LABEL = { pref: '偏好', correct: '纠正', habit: '习惯', background: '背景' };
const FACTS_INJECT_MAX = 30;  // defensive cap for active facts injected into system prompt

function normCategory(c) {
  const s = String(c || '').trim();
  return FACT_CATEGORIES.indexOf(s) >= 0 ? s : 'pref';
}

function addFact(payload) {
  init();
  const fact = String((payload && payload.fact) || '').trim();
  if (!fact) return { ok: false, error: '事实内容不能为空' };
  const id = genId('f');
  const t = now();
  const row = {
    id: id,
    fact: fact,
    category: normCategory(payload.category),
    source_conv: (payload && payload.source_conv) || null,
    source_ts: (payload && payload.source_ts) || t,
    status: 'active',
    created_at: t
  };
  db.prepare('INSERT INTO facts (id, fact, category, source_conv, source_ts, status, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(row.id, row.fact, row.category, row.source_conv, row.source_ts, row.status, row.created_at);
  return { ok: true, fact: row };
}

function listFacts() {
  init();
  return db.prepare('SELECT * FROM facts ORDER BY created_at DESC').all();
}

function activeFacts() {
  init();
  return db.prepare("SELECT * FROM facts WHERE status = 'active' ORDER BY created_at DESC").all();
}

function deleteFact(id) {
  init();
  // Soft delete: keep the row (traceable) but mark dismissed so it stops being injected.
  db.prepare("UPDATE facts SET status = 'dismissed' WHERE id = ?").run(id);
  return { ok: true };
}

function confirmFact(payload) {
  // Confirm-card write-back: same as addFact, keeps the IPC surface explicit.
  return addFact(payload || {});
}

// Build the memory-injection block (facts + matched skills) for the system prompt.
// subject/question are used to match skills and (optionally) order facts; facts are
// grouped by category for readability and capped at FACTS_INJECT_MAX newest-first.
function buildMemoryInjection(subject, question) {
  let out = '';
  const facts = activeFacts().slice(0, FACTS_INJECT_MAX);
  if (facts.length) {
    const byCat = {};
    facts.forEach(function (f) { (byCat[f.category] = byCat[f.category] || []).push(f); });
    const lines = [];
    FACT_CATEGORIES.forEach(function (cat) {
      (byCat[cat] || []).forEach(function (f) {
        lines.push('· [' + (FACT_CATEGORY_LABEL[cat] || cat) + '] ' + f.fact);
      });
    });
    out += '\n\n【关于 Jovan 的记忆】（以下是你已知的关于用户的持久事实，回答时自然运用，不要刻意复述）：\n' + lines.join('\n');
  }
  const hits = skills.hitSkills((subject ? subject + ' ' : '') + (question || ''));
  if (hits.length) {
    out += '\n\n以下技能可能适用（按其步骤执行，注意坑）：\n' + hits.map(function (s) {
      return '· ' + s.name + '：' + s.场景;
    }).join('\n');
  }
  return out;
}

function buildSystemPrompt(subject, question) {
  let base = ai.SYSTEM_PROMPT;
  const mats = studyMaterials(subject, question);
  if (mats.length) {
    const block = mats.map(function (m, i) {
      return (i + 1) + '. ' + (m.标题 || '(无标题)') + '\n' + String(m.详情 || '').slice(0, 800);
    }).join('\n');
    base += '\n\n以下是你的「' + subject + '」学科资料摘要（来自该学科的笔记/课件）。回答优先基于这些资料，资料没有覆盖的内容再用你的知识补充：\n' + block;
  }
  base += buildMemoryInjection(subject, question);
  return base;
}

// ---- send a message inside a subject conversation (streaming) ----
async function sendMessage(id, provider, model, text, thinking, onChunk) {
  init();
  const conv = getConversation(id);
  if (!conv) throw new Error('会话不存在');
  const question = String(text || '').trim();
  if (!question) throw new Error('消息为空');

  // window compress first (oldest 10 rounds -> summary)
  await compressIfNeeded(id, provider, model);

  const history = getMessages(id);
  const context = history.map(function (m) {
    if (m.role === 'summary') return { role: 'user', content: '（更早对话的摘要）' + m.content };
    return { role: m.role, content: m.content };
  });
  const messages = [{ role: 'system', content: buildSystemPrompt(conv.subject, question) }]
    .concat(context)
    .concat([{ role: 'user', content: question }]);

  const r = await ai.chat({
    provider: provider, model: model, messages: messages,
    thinking: thinking, onChunk: onChunk
  });

  const userMessage = appendMessage(id, 'user', question, { provider: provider, model: model });
  const assistantMessage = appendMessage(id, 'assistant', r.content || '', { provider: r.provider || provider, model: r.model || model, usage: r.usage, cost: r.cost });
  return { content: r.content, usage: r.usage, cost: r.cost, user_message: userMessage, assistant_message: assistantMessage };
}

// ---- history search (FTS5 trigram + LIKE fallback) ----
function search(q) {
  init();
  const kw = String(q || '').trim();
  if (!kw) return { ok: true, hits: [] };
  const like = '%' + kw + '%';
  const rows = db.prepare(
    'SELECT m.id, m.conv_id, m.role, m.content, m.ts, c.subject, c.title ' +
    'FROM messages m LEFT JOIN conversations c ON m.conv_id = c.id ' +
    'WHERE m.content LIKE ? ORDER BY m.ts DESC LIMIT 50'
  ).all(like);
  return {
    ok: true,
    hits: rows.map(function (m) {
      return {
        msg_id: m.id, conv_id: m.conv_id, role: m.role,
        content: String(m.content || '').slice(0, 120),
        ts: m.ts, subject: m.subject || '', title: m.title || ''
      };
    })
  };
}

module.exports = {
  init,
  close,
  createConversation,
  createBranch,
  listConversations,
  loadConversation,
  getConversation,
  appendMessage,
  replaceAssistantMessage,
  renameConversation,
  clearConversation,
  deleteConversation,
  sendMessage,
  search,
  compressIfNeeded,
  studyMaterials,
  addFact,
  listFacts,
  activeFacts,
  deleteFact,
  confirmFact,
  buildMemoryInjection,
  dbPath
};
