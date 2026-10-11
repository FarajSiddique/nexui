#!/usr/bin/env node
/**
 * The travel eval (spec addendum 2026-10-03, section 4): runs spec section H's eight trip prompts
 * against the running API as the QA user, checks each plan, and leaves the plans in the QA account
 * to judge in Expo. A manual gate, run live; it is not part of `pnpm test`.
 *
 * pnpm eval:travel                 run all eight cases
 * pnpm eval:travel --case <name>   run one case
 * pnpm eval:travel --clean         delete every plan an eval left in the QA account
 *
 * Needs the API running (live AI for a real eval; with AI_PROVIDER=mock, japan-december and
 * chicago-weekend replay their fixtures), a QA session in .qa/session.json, and SUPABASE_URL,
 * SUPABASE_SECRET_KEY and QA_SUPABASE_REF in apps/api/.env.local to tag and clean up plans.
 */
import { parseArgs } from 'node:util';

import { CASES } from './eval-travel-cases.mjs';
import { askChecks, askPromptOf, describePlan, goalChecks } from './lib/eval-checks.mjs';
import { qaAdmin, qaApi, readSession } from './lib/qa-api.mjs';

const { values } = parseArgs({
  options: { case: { type: 'string' }, clean: { type: 'boolean', default: false } },
});
const session = readSession();
const userId = session.user.id;
const { call, waitForRun } = qaApi(session);
const admin = await qaAdmin();

const tokens = (run) =>
  `${run.modelUsage.inputTokens ?? 0} in / ${run.modelUsage.outputTokens ?? 0} out`;
const refusedCount = (run) => run.progress.filter((entry) => !entry.ok).length;

async function clean() {
  const { data, error } = await admin
    .from('intents')
    .delete()
    .eq('user_id', userId)
    .not('context->eval', 'is', null)
    .select('id');

  if (error) {
    throw new Error(`Could not delete the eval plans (${error.code}).`);
  }

  console.log(`Deleted ${data.length} eval plan${data.length === 1 ? '' : 's'}.`);
}

// Tagged at once, so a crash mid-run still leaves the plan for --clean.
async function tag(intentId, name) {
  const { error } = await admin
    .from('intents')
    .update({ context: { eval: { suite: 'travel', case: name, at: new Date().toISOString() } } })
    .eq('id', intentId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Could not tag ${intentId} (${error.code}).`);
  }
}

async function runCase(testCase) {
  const started = await call('POST', '/api/intents', { goal: testCase.goal });

  // A saved goal has no id to tag, so `--clean` can't remove it; it stays off Home.
  if (started.outcome !== 'started') {
    return {
      intentId: null,
      checks: [{ label: 'Jev saw a trip', ok: false, detail: `answered ${started.outcome}` }],
      notes: [],
      plan: [],
    };
  }

  const intentId = started.snapshot.intent.id;

  await tag(intentId, testCase.name);

  const goalRun = await waitForRun(started.runId);
  let snapshot = await call('GET', `/api/intents/${intentId}`);
  const checks = goalChecks(snapshot, goalRun, testCase);
  const notes = [
    `goal run ${goalRun.status}, ${refusedCount(goalRun)} refused calls, ${tokens(goalRun)}`,
  ];
  const prompt = askPromptOf(snapshot);

  if (prompt) {
    const asked = await call('POST', `/api/intents/${intentId}/ask`, { text: prompt });
    const askRun = await waitForRun(asked.runId);

    snapshot = await call('GET', `/api/intents/${intentId}`);
    checks.push(...askChecks(snapshot, askRun, testCase));
    notes.push(
      `ask "${prompt}" → ${asked.route}, run ${askRun.status}, ${refusedCount(askRun)} refused calls, ${tokens(askRun)}`,
    );
  } else {
    notes.push('ask skipped: no free days');
  }

  return { intentId, checks, notes, plan: describePlan(snapshot) };
}

function printCase(testCase, result) {
  console.log(`\n━━ ${testCase.name}  ${result.intentId ?? ''}`);
  console.log(`   "${testCase.goal}"`);

  for (const item of result.checks) {
    console.log(`   ${item.ok ? '✓' : '✗'} ${item.label}${item.ok ? '' : `: ${item.detail}`}`);
  }

  for (const line of [...result.notes, ...result.plan]) {
    console.log(`   ${line}`);
  }
}

if (values.clean) {
  await clean();
} else {
  const selected = values.case ? CASES.filter((testCase) => testCase.name === values.case) : CASES;

  if (selected.length === 0) {
    console.error(`No case "${values.case}". Cases: ${CASES.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  let passed = 0;

  for (const testCase of selected) {
    let result;

    try {
      result = await runCase(testCase);
    } catch (error) {
      result = {
        intentId: null,
        checks: [{ label: 'the case ran', ok: false, detail: error.message }],
        notes: [],
        plan: [],
      };
    }

    printCase(testCase, result);

    if (result.checks.every((item) => item.ok)) {
      passed += 1;
    }
  }

  console.log(
    `\n${passed}/${selected.length} passed automatic checks — open them in Expo (QA account).`,
  );
  process.exitCode = passed === selected.length ? 0 : 1;
}
