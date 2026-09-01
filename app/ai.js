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
function listProviders() {
  return PROVIDERS.map(function (p) {
    return {
      id: p.id,
      name: p.name,
      remark: p.remark,
      defaultModel: p.defaultModel,
      configured: hasKey(p.id),
      models: p.models.map(function (m) {
        return { name: m.name, vision: !!m.vision, price: m.price };
      })
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
  hasKey,
  setKey,
  test,
  chat,
  SYSTEM_PROMPT
};
