// mem.js — L3 fact-memory distillation (main process, M4).
// After a conversation turn, a lightweight flash call inspects the recent dialog
// and returns candidate facts ("things worth remembering across sessions"). The
// renderer shows a confirm card; only when the user clicks "remember" is the fact
// written to the facts table (via conv.addFact). This module only DISTILLS — the
// persistence + injection live in conv.js (same SQLite db, no second connection).
'use strict';

const ai = require('./ai.js');
const parse = require('./parse.js');

// ---- fact distillation via flash (returns candidates, never writes) ----
async function extractFacts(messages) {
  const def = parse.pickDefaultModel();
  if (!def) return { ok: false, error: '未配置任何 AI 模型' };
  const r = await ai.jsonOutput({
    provider: def.provider, model: def.model,
    messages: [
      {
        role: 'system',
        content: '你是事实记忆提炼助手。从用户最近的对话中，提取「值得跨会话长期记住的关于用户的稳定信息」。' +
          '只输出一个 JSON 对象：{"事实": [{"fact": "一句话事实（如：用户雅思备考中）", "category": "pref/correct/habit/background"}]}。' +
          '类别说明：pref=用户表达的偏好，correct=用户纠正过的错误认知，habit=用户的生活/工作习惯，background=用户背景信息。' +
          '没有值得记的就输出 {"事实": []}。宁缺毋滥，只记稳定且未来可能用到的信息，不要记一次性任务。'
      },
      { role: 'user', content: '最近对话：\n' + JSON.stringify(messages).slice(0, 3000) }
    ],
    validate: function (obj) {
      if (!obj || typeof obj !== 'object') return { ok: false, error: '不是对象' };
      if (!Array.isArray(obj.事实)) return { ok: false, error: '缺少 事实 数组' };
      return { ok: true };
    }
  });
  if (!r.ok) return { ok: false, error: r.error };
  const facts = (r.data.事实 || []).map(function (f) {
    return {
      fact: String((f && f.fact) || '').trim(),
      category: String((f && f.category) || 'pref').trim()
    };
  }).filter(function (f) { return f.fact; });
  return { ok: true, candidates: facts };
}

module.exports = { extractFacts };
