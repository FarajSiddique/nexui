#!/usr/bin/env node
/**
 * The job search eval (spec section 9), build half. Part A asks live Jev to route 24 goals and
 * creates nothing. Part B runs the eight live cases' builds as the QA user: create, start with a
 * fictional resume, wait for the build run, check the plan, and read every New role again from
 * its board (zero dead links). The scan and kit halves come with PR 4. A manual live gate like
 * `pnpm eval:travel`; not part of `pnpm test`. Roughly $0.01 for Part A and $1 for Part B.
 *
 * pnpm eval:jobs                    both parts
 * pnpm eval:jobs --part routing     Part A only
 * pnpm eval:jobs --part build       Part B only
 * pnpm eval:jobs --case <name>      one Part B case
 * pnpm eval:jobs --clean            delete every plan a jobs eval left in the QA account
 *
 * Part A needs AI_GATEWAY_API_KEY in apps/api/.env.local. Part B needs the API running with
 * AI_PROVIDER=live, JOB_SEARCH=on and NEXUI_CONTACT (and PARALLEL_API_KEY for web search), a QA
 * session in .qa/session.json, and SUPABASE_SECRET_KEY with QA_SUPABASE_REF in
 * apps/api/.env.local to tag and clean up plans.
 */
import { parseArgs } from 'node:util';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { readPosting } from '../apps/api/src/lib/jobs/boards.ts';
import { chooseTemplate } from '../apps/api/src/lib/perception/perceive.ts';
import { BUILD_CASES, ROUTING_CASES } from './eval-jobs-cases.mjs';
import { resumePdf } from './eval-jobs/resumes.mjs';
import { buildChecks, describeSearch, routingCheck } from './lib/eval-jobs-checks.mjs';
import { qaAdmin, qaApi, readSession } from './lib/qa-api.mjs';

const { values } = parseArgs({
  options: {
    part: { type: 'string' },
    case: { type: 'string' },
    clean: { type: 'boolean', default: false },
  },
});

process.loadEnvFile('apps/api/.env.local');

const tokens = (run) =>
  `${run.modelUsage.inputTokens ?? 0} in / ${run.modelUsage.outputTokens ?? 0} out`;

async function routing() {
  const env = { ...process.env, AI_PROVIDER: 'live', JOB_SEARCH: 'on' };
  const open = sessionOpener(env);
  let right = 0;

  console.log('━━ Part A: routing');

  for (const testCase of ROUTING_CASES) {
    const session = open('create_intent', testCase.goal);
    let answer;

    try {
      answer = await chooseTemplate(session.evaluationModel, testCase.goal, {
        providerOptions: session.providerOptions('perception'),
        env,
      });
    } catch {
      answer = 'failed';
    }

    const result = routingCheck(testCase, answer);

    right += result.ok ? 1 : 0;
    console.log(`   ${result.ok ? '✓' : '✗'} ${testCase.goal} → ${answer}`);
  }

  console.log(`   ${right}/${ROUTING_CASES.length} routed as expected`);

  return right === ROUTING_CASES.length;
}

// Part B's liveness bar: every New role from a board is still listed there.
async function liveness(snapshot) {
  const deps = { contact: process.env.NEXUI_CONTACT ?? '', fetch, cache: new Map() };
  const fresh = snapshot.objects.filter(
    (object) => object.kind === 'opportunity' && object.data.stage === 'new',
  );
  const dead = [];

  for (const role of fresh) {
    const source = role.data.source;
    const found = source ? await readPosting(source, source.job, deps).catch(() => null) : null;

    if (!found) {
      dead.push(role.data.title);
    }
  }

  return {
    label: 'every New role is live on its board',
    ok: dead.length === 0,
    detail: dead.join('; '),
  };
}

// A user has one job search at a time, so the last case's search is archived before the next.
// Only the eval's own searches: a search the QA account made by hand stops the case instead.
async function archiveEvalSearches(admin, userId) {
  const { error } = await admin
    .from('intents')
    .update({ status: 'archived' })
    .eq('user_id', userId)
    .eq('template', 'job_search')
    .eq('context->eval->>suite', 'jobs')
    .not('status', 'in', '(completed,archived)');

  if (error) {
    throw new Error(`Could not archive the earlier eval searches (${error.code}).`);
  }
}

async function build(testCase, api, admin, userId) {
  await archiveEvalSearches(admin, userId);

  const created = await api.call('POST', '/api/intents', {
    goal: testCase.goal,
    timezone: testCase.timezone,
  });

  if (created.outcome !== 'awaiting_resume') {
    return {
      intentId: created.intentId ?? null,
      checks: [{ label: 'Jev saw a job search', ok: false, detail: `answered ${created.outcome}` }],
      notes: [],
      plan: [],
    };
  }

  const intentId = created.snapshot.intent.id;
  // Tagged at once, keeping the plan's own context, so a crash still leaves it for --clean.
  const context = {
    ...created.snapshot.intent.context,
    eval: { suite: 'jobs', case: testCase.name, at: new Date().toISOString() },
  };
  const { error } = await admin
    .from('intents')
    .update({ context })
    .eq('id', intentId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Could not tag ${intentId} (${error.code}).`);
  }

  let form = null;

  if (testCase.resume) {
    form = new FormData();
    form.set(
      'file',
      new File([resumePdf(testCase.resume)], `${testCase.resume}.pdf`, { type: 'application/pdf' }),
    );
  }

  const startedAt = Date.now();
  const started = await api.postForm(`/api/intents/${intentId}/start`, form);
  const startMs = Date.now() - startedAt;
  const run = await api.waitForRun(started.runId);
  const snapshot = await api.call('GET', `/api/intents/${intentId}`);

  return {
    intentId,
    checks: [...buildChecks(snapshot, run, testCase, started.intake), await liveness(snapshot)],
    notes: [`start ${startMs} ms (resume ${started.intake}), build ${run.status}, ${tokens(run)}`],
    plan: describeSearch(snapshot),
  };
}

async function buildPart() {
  const session = readSession();
  const api = qaApi(session);
  const admin = await qaAdmin();
  const selected = values.case
    ? BUILD_CASES.filter((testCase) => testCase.name === values.case)
    : BUILD_CASES;

  if (selected.length === 0) {
    console.error(
      `No case "${values.case}". Cases: ${BUILD_CASES.map((one) => one.name).join(', ')}`,
    );
    process.exit(1);
  }

  let passed = 0;

  for (const testCase of selected) {
    let result;

    try {
      result = await build(testCase, api, admin, session.user.id);
    } catch (error) {
      result = {
        intentId: null,
        checks: [{ label: 'the case ran', ok: false, detail: error.message }],
        notes: [],
        plan: [],
      };
    }

    console.log(`\n━━ ${testCase.name}  ${result.intentId ?? ''}\n   "${testCase.goal}"`);

    for (const item of result.checks) {
      console.log(`   ${item.ok ? '✓' : '✗'} ${item.label}${item.ok ? '' : `: ${item.detail}`}`);
    }

    for (const line of [...result.notes, ...result.plan]) {
      console.log(`   ${line}`);
    }

    passed += result.checks.every((item) => item.ok) ? 1 : 0;
  }

  // Each case but the last is archived by the next one, so only the last stays on Home.
  console.log(
    `\nPart B: ${passed}/${selected.length} passed — judge the roles printed above, or one case ` +
      'at a time with --case in Expo (QA account).',
  );

  return passed === selected.length;
}

async function clean() {
  const session = readSession();
  const admin = await qaAdmin();
  const { data, error } = await admin
    .from('intents')
    .delete()
    .eq('user_id', session.user.id)
    .eq('context->eval->>suite', 'jobs')
    .select('id');

  if (error) {
    throw new Error(`Could not delete the eval plans (${error.code}).`);
  }

  console.log(`Deleted ${data.length} job search eval plan${data.length === 1 ? '' : 's'}.`);
}

if (values.clean) {
  await clean();
} else {
  const routed = values.part === 'build' || values.case ? true : await routing();
  const built = values.part === 'routing' ? true : await buildPart();

  process.exitCode = routed && built ? 0 : 1;
}
