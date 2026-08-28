// test-data.js — smoke test for the data layer (no GUI).
const data = require('./data.js');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = path.join(os.tmpdir(), 'jw-test-' + Date.now());
data.setDataDir(dir);

function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) process.exitCode = 1;
}

// 1. add
let r = data.mutate('add', { props: { '标题': { text: '测试任务' }, '类型': { select: '任务' }, '优先级': { select: '紧急且重要' } } });
assert('add creates row', r.ok && r.rows.some(x => x['标题'] === '测试任务'));
const id = r.row._id;

// 2. log was appended
assert('add writes log', data.rows().some(x => x['类型'] === '日志' && x['详情'] && x['详情'].indexOf('添加') >= 0));

// 3. update
r = data.mutate('update', { id: id, props: { '状态': { select: '已完成' } } });
assert('update sets status', data.findRow(id)['状态'] === '已完成');

// 4. delete
r = data.mutate('delete', { id: id });
assert('delete removes row', !data.findRow(id));

// 5. atomic write: no .tmp leftover
assert('no tmp leftover', !fs.existsSync(path.join(dir, 'workspace.json.tmp')));

// 6. conv solar2lunar
const c = data.conv('solar2lunar', { date: '2026-08-27' });
assert('conv solar2lunar ok', c.ok && c.lunarMonth && c.lunarDay);
console.log('    lunar of 2026-08-27:', c.lunarMonth + '月' + c.lunarDay + '日');

// 7. lunar2solar round trip
const c2 = data.conv('lunar2solar', { year: 2026, lm: c.lunarMonth, ld: c.lunarDay });
assert('conv lunar2solar ok', c2.ok && c2.solarDate);
console.log('    solar round trip:', c2.solarDate);

// 8. birthdays (solar)
data.mutate('add', { props: { '标题': { text: '测试生日' }, '类型': { select: '生日' }, '日期': { date: '2000-05-20' } } });
const bs = data.birthdaysOfYear(2026);
assert('birthdays computed', bs.some(b => b.name === '测试生日'));
const b = bs.find(x => x.name === '测试生日');
console.log('    birthday dates:', JSON.stringify(b.dates));

// 9. snapshot & daily backup created
const snap = fs.readdirSync(path.join(dir, 'snapshots'));
const bak = fs.readdirSync(path.join(dir, 'backups'));
assert('snapshots created', snap.length > 0);
assert('daily backup created', bak.length > 0);
console.log('    snapshots:', snap.length, 'backups:', bak.length);

console.log('---- data layer smoke test done (dir: ' + dir + ')');
