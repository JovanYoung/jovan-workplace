// tools.js — Workbench tool set for the Agent (main process, Step 2).
// Read tools query data.js directly and return plain results. Write tools DO NOT
// persist — they return a draft ({draft:true, ...}) that the renderer shows in a
// confirm dialog; only after the user confirms does the renderer call data.add.
'use strict';

const data = require('./data.js');

// Canonical priority values used by the UI four-quadrant (QUADS).
const PRIORITIES = ['紧急且重要', '重要但不紧急', '紧急但不重要', '不重要也不紧急'];
// Normalize any natural-language priority wording to the canonical four.
const PRI_ALIAS = {
  '紧急且重要': '紧急且重要', '重要且紧急': '紧急且重要', '又急又重要': '紧急且重要',
  '重要但不紧急': '重要但不紧急', '重要不紧急': '重要但不紧急',
  '紧急但不重要': '紧急但不重要', '紧急不重要': '紧急但不重要', '急但不重要': '紧急但不重要',
  '不重要也不紧急': '不重要也不紧急', '不重要不紧急': '不重要也不紧急', '不紧急也不重要': '不重要也不紧急',
  '都不重要': '不重要也不紧急', '高优先级': '紧急且重要', '高优': '紧急且重要',
  '紧急': '紧急且重要', '重要': '重要但不紧急'
};
function normPriority(v) {
  if (!v) return '';
  return PRI_ALIAS[String(v).trim()] || '';
}

// Type whitelist (matches renderer fType).
const TYPES = ['备考', '日程', '任务', '备忘', '生日', '亲友', '学习'];
function normType(v) {
  const s = String(v || '').trim();
  return TYPES.indexOf(s) >= 0 ? s : '';
}

// ---- date helpers (normalize natural-language dates to YYYY-MM-DD) ----
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}
const WEEK = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
// Returns 'YYYY-MM-DD' or null. Handles: YYYY-MM-DD, M月D日, 今天/明天/后天/大后天,
// 周X / 下周X / 下下周X.
function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = s.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (m) {
    const y = new Date().getFullYear();
    return y + '-' + pad(+m[1]) + '-' + pad(+m[2]);
  }
  const today = new Date();
  if (s.indexOf('今天') >= 0 || s.indexOf('今日') >= 0) return todayStr();
  if (s.indexOf('大后天') >= 0) return addDays(today, 3);
  if (s.indexOf('后天') >= 0) return addDays(today, 2);
  if (s.indexOf('明天') >= 0 || s.indexOf('明日') >= 0) return addDays(today, 1);
  m = s.match(/下下周[周星期]?([日天一二三四五六])/);
  if (m) { const off = 14 + ((WEEK[m[1]] - today.getDay()) + 7) % 7; return addDays(today, off); }
  m = s.match(/下周[周星期]?([日天一二三四五六])/);
  if (m) { const off = 7 + ((WEEK[m[1]] - today.getDay()) + 7) % 7; return addDays(today, off); }
  m = s.match(/[周星期]([日天一二三四五六])/);
  if (m) { const off = ((WEEK[m[1]] - today.getDay()) + 7) % 7; return addDays(today, off); }
  return null;
}

// ---- read helpers ----
function isNotDeleted(r) { return !r['删除时间']; }
function rowsByType(type) {
  return data.rows().filter(function (r) { return isNotDeleted(r) && (r['类型'] || '') === type; });
}
function rowBrief(r) {
  return { id: r._id, 标题: r['标题'] || '', 日期: r['日期'] || '', 优先级: r['优先级'] || '', 状态: r['状态'] || '', 标签: r['标签'] || '', 详情: (r['详情'] || '').slice(0, 120) };
}

// ---- read tools (execute directly) ----
function queryToday() {
  const today = todayStr();
  const rs = data.rows().filter(isNotDeleted);
  const tasks = rs.filter(function (r) { return (r['类型'] === '任务' || r['类型'] === '日程') && r['状态'] !== '已完成'; });
  const todayItems = tasks.filter(function (r) { return (r['日期'] || '').slice(0, 10) === today; });
  const overdue = tasks.filter(function (r) { const d = (r['日期'] || '').slice(0, 10); return d && d < today; });
  const birthdays = data.computeBirthdays().filter(function (b) {
    return b.dates.some(function (d) { return d.daysLeft >= 0 && d.daysLeft <= 7; });
  });
  return {
    今日待办: todayItems.map(rowBrief),
    逾期: overdue.map(rowBrief).slice(0, 20),
    近7天生日: birthdays.map(function (b) { return { 姓名: b.name, 日期: b.dates.map(function (d) { return d.date; }).join('/') }; })
  };
}

function querySchedules(args) {
  const kw = (args && args.keyword) || (args && args.关键字) || '';
  const date = (args && args.date) || (args && args.日期) || '';
  let rs = rowsByType('日程').concat(rowsByType('任务'));
  if (date) { const d = normalizeDate(date); if (d) rs = rs.filter(function (r) { return (r['日期'] || '').slice(0, 10) === d; }); }
  if (kw) rs = rs.filter(function (r) { return (r['标题'] + ' ' + (r['详情'] || '')).indexOf(kw) >= 0; });
  rs.sort(function (a, b) { return (a['日期'] || '').localeCompare(b['日期'] || ''); });
  return { 数量: rs.length, 结果: rs.slice(0, 30).map(rowBrief) };
}

function queryMemos(args) {
  const kw = (args && args.keyword) || (args && args.关键字) || '';
  let rs = rowsByType('备忘');
  if (kw) rs = rs.filter(function (r) { return (r['标题'] + ' ' + (r['详情'] || '')).indexOf(kw) >= 0; });
  return { 数量: rs.length, 结果: rs.slice(0, 30).map(rowBrief) };
}

function queryFamily(args) {
  const kw = (args && args.keyword) || (args && args.姓名) || '';
  let rs = rowsByType('亲友');
  if (kw) rs = rs.filter(function (r) { return (r['标题'] + ' ' + (r['详情'] || '')).indexOf(kw) >= 0; });
  return { 数量: rs.length, 结果: rs.slice(0, 30).map(rowBrief) };
}

function queryStudy(args) {
  const kw = (args && args.keyword) || (args && args.关键字) || '';
  let rs = rowsByType('学习').concat(rowsByType('备考'));
  if (kw) rs = rs.filter(function (r) { return (r['标题'] + ' ' + (r['学期'] || '') + ' ' + (r['科目'] || '') + ' ' + (r['详情'] || '')).indexOf(kw) >= 0; });
  return { 数量: rs.length, 结果: rs.slice(0, 30).map(function (r) { var b = rowBrief(r); b.学期 = r['学期'] || ''; b.科目 = r['科目'] || ''; return b; }) };
}

// ---- write tools (return draft; human confirms before data.add) ----
function makeDraft(type, props, preview) {
  return { draft: true, type: type, props: props, preview: preview };
}
function draftEvent(onEvent, draft) {
  if (onEvent) onEvent({ type: 'draft', draft: draft });
}

function createSchedule(args, onEvent) {
  const title = (args && (args.标题 || args.title)) || '';
  if (!title) throw new Error('缺少标题');
  const date = normalizeDate(args && (args.日期 || args.date));
  const props = { 标题: title, 类型: '日程', 状态: '待处理' };
  const pri = normPriority(args && (args.优先级 || args.priority));
  if (pri) props.优先级 = pri;
  if (date) props.日期 = date;
  const extra = [];
  if (args && (args.时间 || args.time)) extra.push('时间：' + (args.时间 || args.time));
  if (args && (args.地点 || args.location)) extra.push('地点：' + (args.地点 || args.location));
  if (args && (args.详情 || args.detail)) extra.push(args.详情 || args.detail);
  if (extra.length) props.详情 = extra.join('\n');
  if (args && (args.标签 || args.tag)) props.标签 = args.标签 || args.tag;
  const draft = makeDraft('日程', props, '日程：' + title + (date ? '（' + date + '）' : ''));
  draftEvent(onEvent, draft);
  return { draft: true, 已生成草稿: draft.preview };
}

function createTask(args, onEvent) {
  const title = (args && (args.标题 || args.title)) || '';
  if (!title) throw new Error('缺少标题');
  const date = normalizeDate(args && (args.日期 || args.date));
  const props = { 标题: title, 类型: '任务', 状态: '待处理' };
  const pri = normPriority(args && (args.优先级 || args.priority));
  if (pri) props.优先级 = pri;
  if (date) props.日期 = date;
  if (args && (args.详情 || args.detail)) props.详情 = args.详情 || args.detail;
  if (args && (args.标签 || args.tag)) props.标签 = args.标签 || args.tag;
  const draft = makeDraft('任务', props, '任务：' + title + (date ? '（' + date + '）' : ''));
  draftEvent(onEvent, draft);
  return { draft: true, 已生成草稿: draft.preview };
}

function createMemo(args, onEvent) {
  const title = (args && (args.标题 || args.title)) || '';
  if (!title) throw new Error('缺少标题');
  const props = { 标题: title, 类型: '备忘', 状态: '待处理', 日期: todayStr() };
  if (args && (args.详情 || args.detail)) props.详情 = args.详情 || args.detail;
  const draft = makeDraft('备忘', props, '备忘：' + title);
  draftEvent(onEvent, draft);
  return { draft: true, 已生成草稿: draft.preview };
}

function createFamily(args, onEvent) {
  const name = (args && (args.姓名 || args.name)) || '';
  if (!name) throw new Error('缺少姓名');
  const props = { 标题: name, 类型: '亲友', 生日模式: '隐藏' };
  if (args && (args.关系 || args.relation)) props.标签 = args.关系 || args.relation;
  const lines = [];
  if (args && (args.关系 || args.relation)) lines.push('身份：' + (args.关系 || args.relation));
  if (args && (args.忌口 || args.diet)) lines.push('忌口：' + (args.忌口 || args.diet));
  if (args && (args.雷点 || args.taboo)) lines.push('雷点：' + (args.雷点 || args.taboo));
  if (args && (args.喜好 || args.likes)) lines.push('爱好：' + (args.喜好 || args.likes));
  const bd = args && (args.生日 || args.birthday);
  if (bd) {
    const d = normalizeDate(bd);
    if (d) { props.日期 = d; props.生日模式 = '全部'; lines.push('阳历：' + d.slice(5).replace('-', '月') + '日'); }
  }
  if (lines.length) props.详情 = lines.join('\n');
  const draft = makeDraft('亲友', props, '亲友画像：' + name);
  draftEvent(onEvent, draft);
  return { draft: true, 已生成草稿: draft.preview };
}

function createStudy(args, onEvent) {
  const title = (args && (args.标题 || args.title)) || '';
  const sub = (args && (args.科目 || args.subject)) || '';
  const sem = (args && (args.学期 || args.semester)) || '';
  const exam = (args && (args.备考 || args.exam)) || '';
  if (exam) {
    const props = { 标题: title || exam, 类型: '备考', 状态: '待处理', 标签: '备考' };
    if (sub) props.科目 = sub;
    if (title) props.详情 = title;
    const draft = makeDraft('备考', props, '备考：' + (title || exam));
    draftEvent(onEvent, draft);
    return { draft: true, 已生成草稿: draft.preview };
  }
  if (!sub && !title) throw new Error('缺少科目或标题');
  const props = { 标题: sub || title, 类型: '学习', 状态: '待处理', 标签: '科目', 日期: todayStr() };
  if (sem) props.学期 = sem;
  const draft = makeDraft('学习', props, '学习：' + (sub || title) + (sem ? '（' + sem + '）' : ''));
  draftEvent(onEvent, draft);
  return { draft: true, 已生成草稿: draft.preview };
}

// ---- tool definitions (OpenAI function-calling format, Chinese descriptions) ----
function fn(name, description, properties, required) {
  const o = { name: name, description: description, parameters: { type: 'object', properties: properties || {} } };
  if (required && required.length) o.parameters.required = required;
  return { type: 'function', function: o };
}
const TOOL_DEFS = [
  fn('query_today', '查询今日待办、逾期事项、近 7 天生日概览。当用户问"今天有什么安排/今天要做什么/今天忙不忙"时使用。'),
  fn('query_schedules', '按日期或关键字查询日程和任务。参数 keyword 为标题/详情关键词，date 可为 YYYY-MM-DD 或"明天/下周X"等自然语言。当用户问"周五有什么安排/查一下我的会议"时使用。',
    { keyword: { type: 'string', description: '标题或详情关键词' }, date: { type: 'string', description: '日期，YYYY-MM-DD 或自然语言' } }),
  fn('query_memos', '查询备忘（老忘记的事儿）。参数 keyword 为关键词。当用户问"我的备忘里有什么/查一下备忘"时使用。',
    { keyword: { type: 'string', description: '关键词' } }),
  fn('query_family', '查询亲友画像（忌口/雷点/喜好等）。参数 keyword 为姓名或关键词。当用户问"我妈有什么忌口/查一下某人的信息"时使用。',
    { keyword: { type: 'string', description: '姓名或关键词' } }),
  fn('query_study', '查询学习记录（学期/科目/备考）。参数 keyword 为关键词。当用户问"我的学习进度/有什么科目/备考计划"时使用。',
    { keyword: { type: 'string', description: '关键词' } }),
  fn('create_schedule', '新建日程草稿（需用户确认后才真正写入）。当用户在对话中表达"约人/开会/有活动/某天要做什么"等日程意图时调用。',
    { 标题: { type: 'string', description: '日程标题' }, 日期: { type: 'string', description: 'YYYY-MM-DD 或自然语言' }, 时间: { type: 'string', description: '时刻，如 14:00' }, 地点: { type: 'string' }, 优先级: { type: 'string', description: '紧急且重要/重要但不紧急/紧急但不重要/不重要也不紧急' }, 详情: { type: 'string' } },
    ['标题']),
  fn('create_task', '新建任务草稿（需用户确认）。当用户表达"要交作业/要完成某事/有 deadline"等任务意图时调用。',
    { 标题: { type: 'string', description: '任务标题' }, 优先级: { type: 'string' }, 日期: { type: 'string', description: '截止日期，YYYY-MM-DD 或自然语言' }, 标签: { type: 'string' }, 详情: { type: 'string' } },
    ['标题']),
  fn('create_memo', '新建备忘草稿（需用户确认）。当用户说"记住/别忘了我妈不吃香菜"等备忘意图时调用。',
    { 标题: { type: 'string', description: '备忘内容' }, 详情: { type: 'string' } },
    ['标题']),
  fn('create_family', '新建亲友画像草稿（需用户确认）。当用户提及亲友的信息（忌口/雷点/喜好/生日/关系）时调用。',
    { 姓名: { type: 'string' }, 关系: { type: 'string', description: '如 母亲/室友/导师' }, 忌口: { type: 'string' }, 雷点: { type: 'string' }, 喜好: { type: 'string' }, 生日: { type: 'string' } },
    ['姓名']),
  fn('create_study', '新建学习记录草稿（需用户确认）。当用户表达"这周开始刷题/新增科目/备考雅思"等学习意图时调用。',
    { 标题: { type: 'string' }, 学期: { type: 'string' }, 科目: { type: 'string' }, 备考: { type: 'string', description: '备考目标，如 雅思/考研，填写则归为备考' } })
];

// ---- dispatch ----
function executeTool(name, args, onEvent) {
  switch (name) {
    case 'query_today': return Promise.resolve(queryToday());
    case 'query_schedules': return Promise.resolve(querySchedules(args));
    case 'query_memos': return Promise.resolve(queryMemos(args));
    case 'query_family': return Promise.resolve(queryFamily(args));
    case 'query_study': return Promise.resolve(queryStudy(args));
    case 'create_schedule': return Promise.resolve(createSchedule(args, onEvent));
    case 'create_task': return Promise.resolve(createTask(args, onEvent));
    case 'create_memo': return Promise.resolve(createMemo(args, onEvent));
    case 'create_family': return Promise.resolve(createFamily(args, onEvent));
    case 'create_study': return Promise.resolve(createStudy(args, onEvent));
    default: return Promise.reject(new Error('未知工具：' + name));
  }
}

module.exports = {
  TOOL_DEFS,
  executeTool,
  normalizeDate,
  normPriority,
  normType,
  PRIORITIES,
  TYPES
};
