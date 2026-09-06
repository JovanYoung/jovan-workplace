'use strict';

const ai = require('./ai.js');

async function expect(value, expected, label) {
  if (value !== expected) throw new Error(label + ': expected ' + expected + ', got ' + value);
  process.stdout.write('PASS ' + label + '\n');
}

async function main() {
  const a = ai.waitAsk('agent_session_alpha');
  const b = ai.waitAsk('agent_session_beta');
  await expect(ai.answerAsk('agent_session_beta', 'B'), true, 'answer B accepted');
  await expect(ai.answerAsk('agent_session_alpha', 'A'), true, 'answer A accepted');
  await expect(await a, 'A', 'ask A isolated');
  await expect(await b, 'B', 'ask B isolated');

  const pa = ai.waitPlan('agent_session_plan_a');
  const pb = ai.waitPlan('agent_session_plan_b');
  await expect(ai.answerPlan('agent_session_plan_b', 'cancel'), true, 'plan B accepted');
  await expect(ai.answerPlan('agent_session_plan_a', 'edit', ['one']), true, 'plan A accepted');
  await expect((await pa).action, 'edit', 'plan A isolated');
  await expect((await pb).action, 'cancel', 'plan B isolated');

  const pending = ai.waitAsk('agent_session_cancel');
  ai.cancelSession('agent_session_cancel');
  await expect(await pending, null, 'cancel releases ask');
  await expect(ai.answerAsk('agent_session_missing', 'x'), false, 'stale answer rejected');
}

main().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
