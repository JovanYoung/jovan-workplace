// skills.js — G2 auto skill distillation + skill library (main process, M4).
// Each skill is a structured JSON document under {DATA_DIR}/skills/{id}.json so it
// is human-readable, editable, exportable, and version-controllable (unlike facts,
// which live in SQLite). Skills are distilled by the flash model after a multi-step
// Agent task (>=3 tool rounds or >=1 user correction) and matched by simple
// scenario-keyword overlap before a task starts.
'use strict';

const fs = require('fs');
const path = require('path');
const data = require('./data.js');
const ai = require('./ai.js');
const parse = require('./parse.js');

// ---- storage ----
function skillsDir() { return path.join(data.getDataDir(), 'skills'); }
function ensureDir() {
  const d = skillsDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}
function skillPath(id) { return path.join(skillsDir(), String(id) + '.json'); }
function genId() { return 's_' + Date.now() + '_' + Math.floor(Math.random() * 9999); }

function listSkills() {
  ensureDir();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(skillsDir()).filter(function (f) { return f.endsWith('.json'); }); } catch (e) {}
  files.forEach(function (f) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(skillsDir(), f), 'utf8'));
      if (s && s.id && s.name) out.push(s);
    } catch (e) {}
  });
  out.sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); });
  return out;
}

function getSkill(id) {
  try { return JSON.parse(fs.readFileSync(skillPath(id), 'utf8')); } catch (e) { return null; }
}

function saveSkill(payload) {
  ensureDir();
  const id = (payload && payload.id) || genId();
  const name = String((payload && payload.name) || '').trim();
  if (!name) return { ok: false, error: '技能名不能为空' };
  const steps = Array.isArray(payload && payload.步骤) ? payload.步骤 : String(payload && payload.步骤 || '').split(/[,\n，、]/).map(function (x) { return x.trim(); }).filter(Boolean);
  const pits = Array.isArray(payload && payload.坑) ? payload.坑 : String(payload && payload.坑 || '').split(/[,\n，、]/).map(function (x) { return x.trim(); }).filter(Boolean);
  const skill = {
    id: id,
    name: name,
    场景: String((payload && payload.场景) || '').trim(),
    步骤: steps,
    坑: pits,
    验证: String((payload && payload.验证) || '').trim(),
    category: String((payload && payload.category) || '通用').trim() || '通用',
    hits: (payload && payload.hits) || 0,
    disabled: !!(payload && payload.disabled),
    created_at: (payload && payload.created_at) || Date.now()
  };
  fs.writeFileSync(skillPath(id), JSON.stringify(skill, null, 2), 'utf8');
  return { ok: true, skill: skill };
}

function deleteSkill(id) {
  ensureDir();
  try { fs.unlinkSync(skillPath(id)); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function toggleSkill(id) {
  ensureDir();
  const s = getSkill(id);
  if (!s) return { ok: false, error: '技能不存在' };
  s.disabled = !s.disabled;
  fs.writeFileSync(skillPath(id), JSON.stringify(s, null, 2), 'utf8');
  return { ok: true, skill: s };
}

function bumpHits(id) {
  const s = getSkill(id);
  if (!s) return;
  s.hits = (s.hits || 0) + 1;
  try { fs.writeFileSync(skillPath(id), JSON.stringify(s, null, 2), 'utf8'); } catch (e) {}
}

// ---- hit matching (simple scenario/keyword overlap, no vector) ----
function grams(text) {
  const s = String(text || '');
  const g = [];
  for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2));
  return g;
}
function hitSkills(text) {
  const list = listSkills().filter(function (s) { return !s.disabled; });
  const t = String(text || '');
  if (!t) return [];
  const tg = grams(t);
  const scored = list.map(function (s) {
    const hay = (s.name || '') + ' ' + (s.场景 || '') + ' ' + ((s.步骤 || []).join(' '));
    const hg = grams(hay);
    let score = 0;
    hg.forEach(function (g) { if (tg.indexOf(g) >= 0) score++; });
    if (s.name && t.indexOf(s.name) >= 0) score += 5;  // full name hit is strong
    return { s: s, score: score };
  }).filter(function (x) { return x.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, 3).map(function (x) { return x.s; });
}

// ---- skill distillation via flash ----
async function extractSkill(conversation, toolTrace) {
  const def = parse.pickDefaultModel();
  if (!def) return { ok: false, error: '未配置任何 AI 模型' };
  const r = await ai.jsonOutput({
    provider: def.provider, model: def.model,
    messages: [
      {
        role: 'system',
        content: '你是技能提炼助手。从一次 Agent 任务的对话与工具调用轨迹中，提炼出一条可复用的操作技能。' +
          '只输出一个 JSON 对象：{"有技能": true/false, "name": "技能名(2-8字)", "场景": "什么情况下用(一句话)", "步骤": ["步骤1","步骤2"], "坑": ["容易错在哪"], "验证": "怎么确认做对(一句话)", "category": "学习/日程/备忘/亲友/通用"}。' +
          '若这次任务没有可复用的经验，输出 {"有技能": false}。'
      },
      {
        role: 'user',
        content: '对话：\n' + JSON.stringify(conversation).slice(0, 3000) +
          '\n\n工具调用轨迹：\n' + JSON.stringify(toolTrace).slice(0, 2000)
      }
    ],
    validate: function (obj) {
      if (!obj || typeof obj !== 'object') return { ok: false, error: '不是对象' };
      if (typeof obj.有技能 !== 'boolean') return { ok: false, error: '缺少 有技能 字段' };
      if (obj.有技能 && (!obj.name || !String(obj.name).trim())) return { ok: false, error: '缺少技能名' };
      return { ok: true };
    }
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: r.data };
}

module.exports = {
  listSkills, saveSkill, deleteSkill, toggleSkill, getSkill, bumpHits, hitSkills, extractSkill, skillsDir
};
