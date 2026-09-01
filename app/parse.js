// parse.js — Step 3 one-shot natural-language parse + Step 4 proactive intent
// detection. Both use the built-in LLM (deepseek-v4-flash preferred) with JSON
// output + schema validation. Also owns the learning dictionary, migrated from
// renderer localStorage (wb_parse_dict) to data/dict.json for cross-device sync.
'use strict';

const path = require('path');
const fs = require('fs');
const ai = require('./ai.js');
const data = require('./data.js');
const tools = require('./tools.js');

// ---- learning dictionary (data/dict.json) ----
function dictPath() { return path.join(data.getDataDir(), 'dict.json'); }
function dictLoad() {
  try { return JSON.parse(fs.readFileSync(dictPath(), 'utf8')); } catch (e) { return {}; }
}
function dictSave(d) {
  try { fs.writeFileSync(dictPath(), JSON.stringify(d, null, 2), 'utf8'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function dictClear() {
  try { fs.writeFileSync(dictPath(), '{}', 'utf8'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---- default model selection (prefer deepseek-v4-flash, fall back to any configured) ----
function pickDefaultModel() {
  const providers = ai.listProviders();
  const deepseek = providers.find(function (p) { return p.id === 'deepseek'; });
  if (deepseek && deepseek.configured) {
    const flash = (deepseek.models || []).find(function (m) { return m.name === 'deepseek-v4-flash'; });
    if (flash) return { provider: 'deepseek', model: 'deepseek-v4-flash' };
    if (deepseek.models && deepseek.models.length) return { provider: 'deepseek', model: deepseek.models[0].name };
  }
  for (const p of providers) {
    if (p.configured && p.models && p.models.length) return { provider: p.id, model: p.models[0].name };
  }
  return null;
}
function hasAnyModel() { return !!pickDefaultModel(); }

// ---- Step 3: one-shot natural-language parse ----
// Current date injected into prompts so the model can resolve relative dates
// (明天/周五/下周X) into YYYY-MM-DD — the model does not know "today" otherwise.
function todayCN() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  return '今天是' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（周' + week[d.getDay()] + '）。';
}
const PARSE_SCHEMA_HINT =
  '只输出一个 JSON 对象，字段：{类型, 标题, 日期, 时间, 地点, 优先级, 标签, 详情}。' +
  '类型 ∈ [日程, 任务, 备忘, 亲友, 学习, 备考]；' +
  '优先级 ∈ [紧急且重要, 重要但不紧急, 紧急但不重要, 不重要也不紧急]，可留空；' +
  '日期用 YYYY-MM-DD，相对日期（明天/周五/下周X）请按今天换算成具体日期，无则空字符串；时间用 HH:MM，无则空字符串。';

async function parse(text) {
  const def = pickDefaultModel();
  if (!def) return { ok: false, error: '未配置任何 AI 模型', parsed: null, confidence: 0 };
  const messages = [
    { role: 'system', content: '你是中文日程解析助手。把用户的一句话解析为结构化事项。' + todayCN() + PARSE_SCHEMA_HINT },
    { role: 'user', content: String(text || '') }
  ];
  const r = await ai.jsonOutput({
    provider: def.provider, model: def.model, messages: messages,
    validate: function (obj) {
      if (!obj || typeof obj !== 'object') return { ok: false, error: '不是对象' };
      if (!obj.标题 || !String(obj.标题).trim()) return { ok: false, error: '缺少标题' };
      if (obj.类型 && !tools.normType(obj.类型)) return { ok: false, error: '类型非法：' + obj.类型 };
      return { ok: true };
    }
  });
  if (!r.ok) return { ok: false, error: r.error, parsed: null, confidence: 0 };
  const p = r.data;
  // Normalize + confidence.
  const type = tools.normType(p.类型) || '任务';
  const pri = tools.normPriority(p.优先级);
  const date = tools.normalizeDate(p.日期) || '';
  let confidence = 0.9;
  if (!tools.normType(p.类型)) confidence = 0.55;         // model guessed type
  if (pri && !tools.normPriority(p.优先级)) confidence = 0.6;
  if (!date && p.日期) confidence = 0.6;                  // date present but unparseable
  const parsed = {
    类型: type,
    标题: String(p.标题 || '').trim(),
    日期: date,
    时间: p.时间 || '',
    地点: p.地点 || '',
    优先级: pri,
    标签: p.标签 || '',
    详情: p.详情 || String(text || '').trim()
  };
  return { ok: true, parsed: parsed, confidence: confidence };
}

// ---- Step 4: proactive intent detection (after a conversation turn) ----
const DETECT_SCHEMA_HINT =
  '只输出一个 JSON 对象：{意图, 草稿}。' +
  '意图 ∈ [日程, 任务, 备忘, 亲友, 学习, 冲突, 逾期, 生日, 无]。' +
  '若意图为"无"，草稿填 null。' +
  '草稿对象字段（按意图）：' +
  '日程/任务/备忘/亲友/学习 → {标题, 日期, 优先级, 详情}（日期 YYYY-MM-DD，相对日期按今天换算，可空；优先级 ∈ [紧急且重要, 重要但不紧急, 紧急但不重要, 不重要也不紧急]）；' +
  '冲突/逾期/生日 → {提示}（一句话提醒，不写入）。';

async function detect(messages) {
  const def = pickDefaultModel();
  if (!def) return { ok: false, error: '未配置任何 AI 模型', hit: false };
  const r = await ai.jsonOutput({
    provider: def.provider, model: def.model,
    messages: [
      { role: 'system', content: '你是意图检测助手。分析用户最近对话，判断是否出现了可执行的生活/学习意图并生成结构化草稿。' + todayCN() + DETECT_SCHEMA_HINT },
      { role: 'user', content: '最近对话：\n' + JSON.stringify(messages).slice(0, 3000) }
    ],
    validate: function (obj) {
      if (!obj || typeof obj !== 'object') return { ok: false, error: '不是对象' };
      if (!obj.意图) return { ok: false, error: '缺少意图' };
      return { ok: true };
    }
  });
  if (!r.ok) return { ok: false, error: r.error, hit: false };
  const intent = r.data.意图;
  if (intent === '无' || !r.data.草稿) return { ok: true, hit: false, intent: null, draft: null };

  const d = r.data.草稿;
  if (intent === '冲突' || intent === '逾期' || intent === '生日') {
    // Reminder-only: no write. Renderer shows a notice, no data.add.
    return { ok: true, hit: true, intent: intent, draft: null, notice: d.提示 || String(intent) };
  }

  // Write-type intents -> build a draft props object (renderer confirms before data.add).
  const props = { 状态: '待处理' };
  if (d.标题) props.标题 = String(d.标题);
  if (d.详情) props.详情 = String(d.详情);
  const pri = tools.normPriority(d.优先级);
  if (pri) props.优先级 = pri;
  const date = tools.normalizeDate(d.日期);
  if (date) props.日期 = date;

  let type = null;
  if (intent === '日程') { type = '日程'; }
  else if (intent === '任务') { type = '任务'; }
  else if (intent === '备忘') { type = '备忘'; if (!props.日期) props.日期 = new Date().toISOString().slice(0, 10); }
  else if (intent === '亲友') { type = '亲友'; props.生日模式 = '隐藏'; }
  else if (intent === '学习') { type = '学习'; if (!props.日期) props.日期 = new Date().toISOString().slice(0, 10); }
  if (!type || !props.标题) return { ok: true, hit: false, intent: null, draft: null };
  props.类型 = type;

  return { ok: true, hit: true, intent: intent, draft: { type: type, props: props, preview: type + '：' + props.标题 } };
}

module.exports = {
  dictLoad, dictSave, dictClear,
  pickDefaultModel, hasAnyModel,
  parse, detect
};
