'use strict';

// Isolated regression for Galgame-style conversation branches. It never opens
// the user's data directory and removes its own workspace-local test database.
const fs = require('fs');
const path = require('path');
const data = require('./data.js');
const conv = require('./conv.js');

const testDir = path.join(__dirname, '.test-conversation-branches-' + process.pid);

function expect(value, expected, label) {
  if (value !== expected) throw new Error(label + ': expected ' + expected + ', got ' + value);
  process.stdout.write('PASS ' + label + '\n');
}

try {
  // Remove only stale directories made by a prior interrupted run of this
  // exact regression. They are never user data directories.
  fs.readdirSync(__dirname, { withFileTypes: true }).forEach(function (entry) {
    if (entry.isDirectory() && entry.name.indexOf('.test-conversation-branches-') === 0) {
      fs.rmSync(path.join(__dirname, entry.name), { recursive: true, force: true });
    }
  });
  data.setDataDir(testDir);
  const source = conv.createConversation('Branch test', '主线');
  const first = conv.appendMessage(source.id, 'user', '问题 A');
  const answer = conv.appendMessage(source.id, 'assistant', '回答 A');
  const branch = conv.createBranch(source.id, answer.id, '分支 A');
  expect(branch.ok, true, 'branch is created');
  expect(branch.copied_messages, 2, 'only ancestors are copied');

  conv.appendMessage(source.id, 'user', '主线后续问题');
  conv.appendMessage(branch.branch.id, 'user', '分支后续问题');
  const branchMessages = conv.loadConversation(branch.branch.id).messages;
  const sourceMessages = conv.loadConversation(source.id).messages;
  expect(branchMessages.length, 3, 'branch owns its own continuation');
  expect(branchMessages.some(function (m) { return m.content === '主线后续问题'; }), false, 'later mainline message does not leak');
  expect(sourceMessages.some(function (m) { return m.content === '分支后续问题'; }), false, 'branch message does not leak back');
  expect(conv.getConversation(branch.branch.id).parent_conv_id, source.id, 'lineage is retained');
} catch (err) {
  console.error(err.stack || err);
  process.exitCode = 1;
} finally {
  conv.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  process.stdout.write('PASS isolated test data cleaned\n');
}
