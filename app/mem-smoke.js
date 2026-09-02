// mem-smoke.js — M4 smoke test for facts + skills + memory injection (no GUI, no AI key needed).
// Run with Electron: env -u ELECTRON_RUN_AS_NODE NODE_OPTIONS= ./node_modules/.bin/electron mem-smoke.js --no-sandbox --disable-gpu --disable-gpu-compositing
'use strict';
const { app } = require('electron');
const os = require('os');
const path = require('path');

app.setName("Jovan's Workplace");
app.setPath('userData', "C:\\Users\\17169\\AppData\\Roaming\\Jovan's Workplace");

function assert(name, cond) {
  console.log((cond ? 'SMOKE|' + name + '|PASS' : 'SMOKE|' + name + '|FAIL'));
  if (!cond) process.exitCode = 1;
}

app.whenReady().then(function () {
  const data = require('./data.js');
  const tmp = path.join(os.tmpdir(), 'jw-m4-test-' + Date.now());
  data.setDataDir(tmp);
  const conv = require('./conv.js');
  const skills = require('./skills.js');

  // ---- facts ----
  conv.addFact({ fact: '用户雅思备考中', category: 'pref' });
  conv.addFact({ fact: '用户是研究生', category: 'correct', source_conv: 'c_abc', source_ts: Date.now() });
  conv.addFact({ fact: '用户习惯周三开组会', category: 'habit', source_conv: 'c_def', source_ts: Date.now() });
  assert('facts-add-3', conv.listFacts().length === 3);
  assert('facts-active-3', conv.activeFacts().length === 3);
  const first = conv.listFacts()[0];
  conv.deleteFact(first.id); // soft delete
  assert('facts-soft-delete', conv.activeFacts().length === 2 && conv.listFacts().length === 3);

  // ---- skills ----
  const s1 = skills.saveSkill({ name: '每周组会提醒', 场景: '用户需要每周提醒开组会', 步骤: ['查今日日程', '建日程草稿'], 坑: ['相对日期要换算成具体日期'], 验证: '草稿日期与用户说的星期一致', category: '日程' });
  assert('skill-save', s1.ok && !!s1.skill.id);
  assert('skill-list-1', skills.listSkills().length === 1);
  const hits = skills.hitSkills('帮我安排每周组会提醒');
  assert('skill-hit-by-name', hits.length === 1 && hits[0].name === '每周组会提醒');
  const hits2 = skills.hitSkills('提醒我开会');
  assert('skill-hit-by-scene', hits2.length >= 1);

  // ---- memory injection (skill still enabled here) ----
  const inj2 = conv.buildMemoryInjection(null, '帮我安排每周组会提醒');
  assert('injection-has-skill-hit', inj2.indexOf('技能可能适用') >= 0);
  console.log('SMOKE|injection-sample|' + JSON.stringify(inj2.replace(/\n/g, ' ').slice(0, 300)));

  skills.toggleSkill(s1.skill.id);
  assert('skill-toggle-disabled', skills.getSkill(s1.skill.id).disabled === true);
  assert('skill-hit-disabled-empty', skills.hitSkills('组会').length === 0);

  // ---- memory injection (facts) ----
  const inj = conv.buildMemoryInjection(null, '我周三有什么安排');
  assert('injection-has-facts', inj.indexOf('关于 Jovan 的记忆') >= 0 && inj.indexOf('用户雅思备考中') >= 0);

  console.log('---- M4 smoke done (tmp=' + tmp + ')');
  app.exit(process.exitCode || 0);
});
