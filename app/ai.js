// ai.js — Built-in AI gateway for Jovan's Workplace (main process).
// Replaces the external dsh bridge (127.0.0.1:3080). Talks to any OpenAI-compatible
// /chat/completions endpoint, supports SSE streaming, and stores API keys encrypted
// via safeStorage (Windows DPAPI) — same pattern as the existing ima key in main.js.
'use strict';

const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Vendor template table (all OpenAI-compatible /chat/completions).
// Users only fill in an API key; baseURL + default model are hard-coded here.
//
// PRICING (RMB per 1M tokens, input/output) follows each vendor's official public
// pricing and CHANGES OVER TIME — keep this table at the top for easy updates.
// DeepSeek V4 uses time-of-day + cache-aware pricing (peak = 2x off-peak;
// cache-hit input is far cheaper than cache-miss). Values below use the
// OFF-PEAK, CACHE-MISS baseline as a conservative estimate. Peak hours (Beijing
// time): 09:00-12:00, 14:00-18:00. Verified 2026-09-01 against api-docs.deepseek.com.
// ---------------------------------------------------------------------------
const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    remark: '文本主力（V4 Flash/Pro）',
    models: [
      { name: 'deepseek-v4-flash', vision: false, price: { in: 1.5, out: 4.5 } },
      { name: 'deepseek-v4-pro', vision: false, price: { in: 4.5, out: 13.5 } }
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5-flash',
    remark: '视觉 GLM-4.5V-Flash（免费）',
    models: [
      { name: 'glm-4.5-flash', vision: false, price: { in: 0, out: 0 } },
      { name: 'glm-4.5v-flash', vision: true, price: { in: 0, out: 0 } }
    ]
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    remark: '备选',
    models: [
      { name: 'moonshot-v1-8k', vision: false, price: { in: 12, out: 12 } }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    remark: '备选',
    models: [
      { name: 'gpt-4o-mini', vision: false, price: { in: 1.1, out: 4.3 } }
    ]
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    remark: '备选',
    models: [
      { name: 'qwen-plus', vision: false, price: { in: 0.8, out: 2 } }
    ]
  },
  {
    id: 'volcengine',
    name: '火山方舟',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro',
    remark: '备选',
    models: [
      { name: 'doubao-1-5-pro', vision: false, price: { in: 0.8, out: 2 } }
    ]
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    remark: '免费模型',
    models: [
      { name: 'Qwen/Qwen2.5-7B-Instruct', vision: false, price: { in: 0, out: 0 } }
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3',
    remark: '本地推理',
    models: [
      { name: 'llama3', vision: false, price: { in: 0, out: 0 } }
    ]
  }
];

const SYSTEM_PROMPT = '你是 Jovan 的个人工作台助手，回答简洁专业，中文优先。';

// ---- key storage (safeStorage-encrypted, local only) ----
function aiConfigPath() { return path.join(app.getPath('userData'), 'ai-keys.json'); }
function readAiCfg() { try { return JSON.parse(fs.readFileSync(aiConfigPath(), 'utf8')); } catch (e) { return {}; } }
function writeAiCfg(cfg) { fs.writeFileSync(aiConfigPath(), JSON.stringify(cfg, null, 2), 'utf8'); }

function findProvider(id) {
  for (let i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
  return null;
}
function findModel(provider, model) {
  const p = findProvider(provider);
  if (!p) return null;
  for (let i = 0; i < p.models.length; i++) if (p.models[i].name === model) return p.models[i];
  const cfg = readAiCfg();
  const cus = (cfg.customModels && cfg.customModels[provider]) || [];
  if (cus.indexOf(model) >= 0) {
    return { name: model, vision: false, price: (p.models && p.models[0]) ? p.models[0].price : { in: 0, out: 0 }, custom: true };
  }
  return p.models[0] || null;
}

function hasKey(provider) {
  if (provider === 'ollama') return true; // local, no key required
  const cfg = readAiCfg();
  return !!(cfg[provider] && cfg[provider].apiKeyEnc && safeStorage.isEncryptionAvailable());
}

function getKey(provider) {
  if (provider === 'ollama') return null;
  if (!hasKey(provider)) return null;
  const cfg = readAiCfg();
  try { return safeStorage.decryptString(Buffer.from(cfg[provider].apiKeyEnc, 'base64')); }
  catch (e) { return null; }
}

function setKey(provider, apiKey) {
  const p = findProvider(provider);
  if (!p) return { ok: false, error: '未知厂商：' + provider };
  if (provider === 'ollama') return { ok: true }; // local provider, key ignored
  const cfg = readAiCfg();
  const val = String(apiKey || '').trim();
  if (!val) {
    delete cfg[provider];
    writeAiCfg(cfg);
    return { ok: true };
  }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '系统不支持安全加密' };
  const enc = safeStorage.encryptString(val).toString('base64');
  cfg[provider] = { apiKeyEnc: enc };
  writeAiCfg(cfg);
  return { ok: true };
}

// Public provider list — never returns keys, only configured status.
function setCustomModels(pid, names) {
  const cfg = readAiCfg();
  const list = String(names || '').split(/[,，]/).map(function(x){ return x.trim(); }).filter(Boolean);
  cfg.customModels = cfg.customModels || {};
  cfg.customModels[pid] = list;
  fs.writeFileSync(aiConfigPath(), JSON.stringify(cfg));
  return { ok: true, count: list.length };
}

function listProviders() {
  const cfg = readAiCfg();
  const custom = cfg.customModels || {};
  return PROVIDERS.map(function (p) {
    const models = p.models.map(function (m) {
      return { name: m.name, vision: !!m.vision, price: m.price };
    });
    const basePrice = (p.models && p.models[0]) ? p.models[0].price : { in: 0, out: 0 };
    (custom[p.id] || []).forEach(function (n) {
      if (!models.find(function (m) { return m.name === n; })) {
        models.push({ name: n, vision: false, price: basePrice, custom: true });
      }
    });
    return {
      id: p.id,
      name: p.name,
      remark: p.remark,
      defaultModel: p.defaultModel,
      configured: hasKey(p.id),
      customModels: custom[p.id] || [],
      models: models
    };
  });
}

// ---- cost calc (RMB) ----
function calcCost(price, usage) {
  const input = (usage && usage.prompt_tokens) || 0;
  const output = (usage && usage.completion_tokens) || 0;
  const total = (usage && usage.total_tokens) || (input + output);
  const rmb = (input * price.in + output * price.out) / 1000000;
  return { input: input, output: output, total: total, rmb: rmb };
}

// ---- config (userData/config.json, shared with main.js) ----
function readAgentCfg() {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')); }
  catch (e) { return {}; }
}
// MAX_TOOL_ROUNDS — read from config.json (default 5), key: maxToolRounds.
function maxToolRounds() {
  const cfg = readAgentCfg();
  const v = parseInt(cfg.maxToolRounds, 10);
  return (isNaN(v) || v < 1) ? 5 : v;
}
const TOOL_RESULT_TRUNCATE = 2000;

// ---- deepseek thinking mode params (verified 2026-09-01 against api-docs.deepseek.com) ----
// Toggle : body.thinking = { type: 'enabled' | 'disabled' }   (disabled = non-thinking mode)
// Effort : body.reasoning_effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
//   mapping: low->low, medium/high/xhigh->high, max->max. Thinking ON by default (effort=high).
// Thinking mode ignores temperature/top_p/presence_penalty/frequency_penalty.
const THINKING_LEVELS = {
  off:    { thinking: { type: 'disabled' } },
  shallow:{ thinking: { type: 'enabled' }, reasoning_effort: 'low' },
  normal: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  deep:   { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
};
function thinkingParams(level) {
  return THINKING_LEVELS[level] || null; // null = model default (enabled + high)
}

// ---- core chat() — streaming via SSE ----
async function chat(params) {
  const provider = params.provider;
  const model = params.model;
  const messages = params.messages;
  const onChunk = params.onChunk;

  const p = findProvider(provider);
  if (!p) throw new Error('未知厂商：' + provider);
  const m = findModel(provider, model);
  if (!m) throw new Error('未知模型：' + model);

  const key = getKey(provider);
  if (provider !== 'ollama' && !key) throw new Error('未配置 API Key，请到 设置 → AI 模型 填写');

  const url = p.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (provider !== 'ollama') headers['Authorization'] = 'Bearer ' + key;

  const body = {
    model: m.name,
    messages: messages,
    stream: true,
    stream_options: { include_usage: true }
  };
  // Thinking depth (Step 5): inject thinking/reasoning_effort when provided.
  const think = thinkingParams(params.thinking);
  if (think) {
    body.thinking = think.thinking;
    if (think.reasoning_effort) body.reasoning_effort = think.reasoning_effort;
  }

  let res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  // Some OpenAI-compatible endpoints reject stream_options; retry once without it.
  if (res.status === 400) {
    delete body.stream_options;
    res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  }

  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch (e) {}
    throw new Error('HTTP ' + res.status + ' ' + errText.slice(0, 200));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let usage = null;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      const delta = j.choices && j.choices[0] && j.choices[0].delta;
      if (delta && delta.content) {
        content += delta.content;
        if (onChunk) onChunk(delta.content);
      }
      if (j.usage) usage = j.usage;
    }
  }

  const cost = calcCost(m.price, usage);
  return { content: content, usage: cost, cost: cost, model: m.name, provider: p.id };
}

// ---- non-streaming single completion (for tool loop / JSON output) ----
async function chatOnce(params) {
  const provider = params.provider;
  const model = params.model;
  const messages = params.messages;
  const tools = params.tools;           // optional OpenAI-format tools
  const responseFormat = params.responseFormat; // optional {type:'json_object'}
  const thinking = params.thinking;

  const p = findProvider(provider);
  if (!p) throw new Error('未知厂商：' + provider);
  const m = findModel(provider, model);
  if (!m) throw new Error('未知模型：' + model);
  const key = getKey(provider);
  if (provider !== 'ollama' && !key) throw new Error('未配置 API Key，请到 设置 → AI 模型 填写');

  const url = p.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (provider !== 'ollama') headers['Authorization'] = 'Bearer ' + key;

  const body = { model: m.name, messages: messages, stream: false };
  if (tools && tools.length) body.tools = tools;
  if (responseFormat) body.response_format = responseFormat;
  const think = thinkingParams(thinking);
  if (think) {
    body.thinking = think.thinking;
    if (think.reasoning_effort) body.reasoning_effort = think.reasoning_effort;
  }

  const res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch (e) {}
    throw new Error('HTTP ' + res.status + ' ' + errText.slice(0, 300));
  }
  const j = await res.json();
  const msg = j.choices && j.choices[0] && j.choices[0].message;
  if (!msg) throw new Error('空响应：' + JSON.stringify(j).slice(0, 200));
  const usage = j.usage;
  const cost = calcCost(m.price, usage);
  return {
    message: msg,            // {role, content, tool_calls?, reasoning_content?}
    usage: cost, cost: cost, model: m.name, provider: p.id
  };
}

// ---- one-shot JSON-mode completion with schema validation + 1 retry ----
// Returns {ok:true, data} or {ok:false, error}. Retries once with a correction hint.
async function jsonOutput(params) {
  const provider = params.provider;
  const model = params.model;
  const messages = params.messages.slice();
  const validate = params.validate || function () { return { ok: true }; };

  let usage = null, raw = '';
  for (let attempt = 0; attempt <= 1; attempt++) {
    const resp = await chatOnce({
      provider: provider, model: model, messages: messages,
      responseFormat: { type: 'json_object' }
    });
    usage = resp.usage;
    raw = resp.message.content || '';
    let obj = null;
    try {
      obj = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    } catch (e) { obj = null; }
    const v = validate(obj);
    if (obj && v.ok) return { ok: true, data: obj, usage: usage, raw: raw };
    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content: '你上次的输出不是合法 JSON 或不符合 schema（' + (v.error || 'JSON 解析失败') + '）。请只输出一个符合要求的 JSON 对象，不要输出任何多余文字。'
    });
  }
  return { ok: false, error: 'JSON 输出校验失败', raw: raw, usage: usage };
}

// ---- ask_user bridge (Step 2 / 1.2 B1) ----
// runAgentLoop pauses when the model calls ask_user; the renderer shows a question
// card and the user's answer arrives via answerAsk() (wired to ai:answer IPC).
// A single pending resolver is enough because ask_user calls are handled serially.
const ASK_MAX = 3;
let _askResolve = null;
function waitAsk() {
  return new Promise(function (resolve) { _askResolve = resolve; });
}
function answerAsk(content) {
  if (_askResolve) {
    const r = _askResolve;
    _askResolve = null;
    r(String(content == null ? '' : content));
    return true;
  }
  return false;
}

// ---- plan-then-act bridge (1.2 B2) ----
// Complex delegations first propose a plan; the renderer shows a plan card and the
// user's decision (execute / edit / cancel) arrives via answerPlan().
let _planResolve = null;
function waitPlan() {
  return new Promise(function (resolve) { _planResolve = resolve; });
}
function answerPlan(action, plan) {
  if (_planResolve) {
    const r = _planResolve;
    _planResolve = null;
    r({ action: String(action || 'execute'), plan: plan });
    return true;
  }
  return false;
}

// ---- provider fallback (1.2 C2) ----
// On 401/429/5xx/network errors we switch to the next model of the same vendor,
// then to the next configured vendor, and retry once before surfacing the error.
function fallbackModel(provider, model) {
  const providers = listProviders();
  const p = providers.find(function (x) { return x.id === provider; });
  if (p && p.configured && p.models) {
    const idx = p.models.findIndex(function (m) { return m.name === model; });
    for (let i = idx + 1; i < p.models.length; i++) {
      if (p.models[i] && p.models[i].name !== model) return { provider: provider, model: p.models[i].name };
    }
    if (idx !== 0 && p.models[0] && p.models[0].name !== model) return { provider: provider, model: p.models[0].name };
  }
  for (let i = 0; i < providers.length; i++) {
    const q = providers[i];
    if (q.id === provider) continue;
    if (q.configured && q.models && q.models.length) {
      return { provider: q.id, model: q.defaultModel || q.models[0].name };
    }
  }
  return null;
}

// ---- tool loop engine (Step 1) ----
// Runs the model until it stops calling tools, up to MAX_TOOL_ROUNDS.
//   messages   : working message array (will be extended with tool results)
//   tools      : OpenAI-format tool definitions
//   executeTool: async (name, args) => any result (read tools) or {draft:true,...}
//   onEvent    : ({type, ...}) => void  — status pushed to renderer via ai:agent-event
async function runAgentLoop(params) {
  const provider = params.provider;
  const model = params.model;
  const messages = params.messages.slice();
  const tools = params.tools || [];
  const executeTool = params.executeTool;
  const onEvent = params.onEvent || function () {};
  const thinking = params.thinking;

  const MAX_ROUNDS = maxToolRounds();
  let totalUsage = { input: 0, output: 0, total: 0, rmb: 0 };
  let askCount = 0;
  let curProvider = provider;
  let curModel = model;
  let fallbackUsed = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    onEvent({ type: 'round', round: round + 1, max: MAX_ROUNDS });
    let resp;
    try {
      resp = await chatOnce({ provider: curProvider, model: curModel, messages: messages, tools: tools, thinking: thinking });
    } catch (e) {
      const fb = fallbackModel(curProvider, curModel);
      if (fb && (fb.provider !== curProvider || fb.model !== curModel)) {
        onEvent({ type: 'fallback', from: curProvider + '/' + curModel, to: fb.provider + '/' + fb.model });
        curProvider = fb.provider;
        curModel = fb.model;
        fallbackUsed = true;
        resp = await chatOnce({ provider: curProvider, model: curModel, messages: messages, tools: tools, thinking: thinking });
      } else {
        throw e;
      }
    }
    const msg = resp.message;
    const toolCalls = msg.tool_calls || [];
    // KEEP reasoning_content in history: when a request carries `tools`, DeepSeek
    // REQUIRES the assistant reasoning_content to be passed back, else HTTP 400.
    messages.push({
      role: 'assistant',
      content: msg.content || '',
      reasoning_content: msg.reasoning_content || '',
      tool_calls: toolCalls
    });
    // Accumulate usage across rounds for correct RMB display (Step 5 linkage).
    if (resp.usage) {
      totalUsage.input += resp.usage.input || 0;
      totalUsage.output += resp.usage.output || 0;
      totalUsage.total += resp.usage.total || 0;
      totalUsage.rmb += resp.usage.rmb || 0;
    }

    if (!toolCalls.length) {
      onEvent({ type: 'done', content: msg.content || '', usage: totalUsage, model: curModel, provider: curProvider });
      return { content: msg.content || '', usage: totalUsage, rounds: round + 1, model: curModel, provider: curProvider, fallbackUsed: fallbackUsed };
    }

    onEvent({ type: 'tools', names: toolCalls.map(function (c) { return c.function.name; }) });

    // 1.2 B1: ask_user pauses the loop for a human answer (serial, ≤ ASK_MAX/task).
    const askCalls = toolCalls.filter(function (c) { return c.function.name === 'ask_user'; });
    const otherCalls = toolCalls.filter(function (c) { return c.function.name !== 'ask_user'; });
    for (let a = 0; a < askCalls.length; a++) {
      const tc = askCalls[a];
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
      onEvent({ type: 'tool-start', id: tc.id, name: 'ask_user', args: args });
      let answer = null;
      if (askCount >= ASK_MAX) {
        answer = '（已达提问上限，请按你的合理判断继续，不要再问）';
      } else {
        askCount++;
        onEvent({ type: 'ask', question: String(args.question || ''), options: args.options || [], id: tc.id });
        answer = await waitAsk();
        if (answer == null || String(answer).trim() === '') answer = '（用户未补充信息，请按你的合理判断继续）';
      }
      const text = JSON.stringify({ answer: answer });
      onEvent({ type: 'tool-done', id: tc.id, name: 'ask_user', result: text });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: text });
    }

    // Ordinary tools (parallel, retry-once).
    const results = await Promise.all(otherCalls.map(async function (tc) {
      const name = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
      onEvent({ type: 'tool-start', id: tc.id, name: name, args: args });
      let result = null, err = null;
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          result = await executeTool(name, args, onEvent);
          err = null;
          break;
        } catch (e) {
          err = String(e.message || e);
          if (attempt < 1) onEvent({ type: 'tool-retry', id: tc.id, name: name, attempt: attempt + 1 });
        }
      }
      if (err) result = { error: err };
      let text = JSON.stringify(result);
      if (text.length > TOOL_RESULT_TRUNCATE) text = text.slice(0, TOOL_RESULT_TRUNCATE) + '…（已截断）';
      onEvent({ type: 'tool-done', id: tc.id, name: name, result: text });
      return { tool_call_id: tc.id, content: text };
    }));
    results.forEach(function (r) { messages.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content }); });
  }

  onEvent({ type: 'limit' });
  return { content: '', usage: totalUsage, rounds: MAX_ROUNDS, stopped: true, model: curModel, provider: curProvider, fallbackUsed: fallbackUsed };
}

// ---- connectivity test: send one tiny non-streaming request ----
async function test(provider) {
  const p = findProvider(provider);
  if (!p) return { ok: false, error: '未知厂商：' + provider };

  const key = getKey(provider);
  if (provider !== 'ollama' && !key) return { ok: false, error: '未配置 API Key' };

  const url = p.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (provider !== 'ollama') headers['Authorization'] = 'Bearer ' + key;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: p.defaultModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    });
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch (e) {}
      return { ok: false, error: 'HTTP ' + res.status + ' ' + errText.slice(0, 160) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = {
  listProviders,
  setCustomModels,
  hasKey,
  setKey,
  test,
  chat,
  chatOnce,
  jsonOutput,
  runAgentLoop,
  answerAsk,
  answerPlan,
  waitPlan,
  thinkingParams,
  maxToolRounds,
  SYSTEM_PROMPT
};
