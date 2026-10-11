import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import { personOf, questionId, scoreRoles } from '../apps/api/src/lib/jobs/score.ts';
import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { executeRun } from '../apps/api/src/lib/runs/execute.ts';
import { mapRunRow } from '../apps/api/src/lib/runs/store.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { getUserClient } from '../apps/api/src/lib/supabase/clients.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { failingEvaluationModel, scriptedModel } from './support/ai.mjs';
import { graphDb, toSnapshotRow } from './support/graph-db.mjs';
import { idSequence, LEASE_ID, RUN_ID, runRow, STAMP } from './support/graph.mjs';
import { COMPANY_ID, jobObject, jobSnapshot, SEARCH_ID, searchData } from './support/jobs.mjs';
import { mockSupabaseAuth, signToken } from './support/supabase-auth.mjs';

const NOW = new Date('2026-10-20T12:00:00Z');
const GOAL = 'Find a Staff PM role in London';
const HALYARD = questionId('greenhouse:halyard:101');
const job = (n) => `d1b2c3d4-0000-4000-8000-00000000000${n}`;

// Halyard's board: one Staff PM role, live.
const boardRoutes = {
  'https://boards-api.greenhouse.io/v1/boards/halyard/jobs/101': {
    id: 101,
    title: 'Staff Product Manager, Payments',
    absolute_url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
    location: { name: 'London' },
    first_published: '2026-10-18T09:00:00Z',
    content: 'Own card payments.',
  },
  'https://boards-api.greenhouse.io/v1/boards/halyard/jobs': {
    jobs: [
      {
        id: 101,
        title: 'Staff Product Manager, Payments',
        absolute_url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
        first_published: '2026-10-18T09:00:00Z',
      },
    ],
  },
};

// The build run's fixture: criteria in one step, then Jev's score and the explain call's answer.
const buildFixture = {
  name: 'test-job-build',
  kind: 'create_intent',
  match: ['staff pm'],
  perception: { template: 'job_search' },
  steps: [
    [
      {
        capability: 'object.update',
        input: { ref: 'search', data: { roles: ['Staff Product Manager'], locations: ['London'] } },
      },
    ],
  ],
  scores: { [HALYARD]: 0.91 },
  output: { roles: [{ id: HALYARD, reasons: ['Payments PM experience matches'], gaps: [] }] },
};

// A started job search whose user named Halyard, with its Greenhouse board.
function startedRow() {
  return toSnapshotRow(
    jobSnapshot({
      doc: jobSearchWorkspace(SEARCH_ID),
      search: { ...searchData, roles: [], locations: [] },
      objects: [
        jobObject(COMPANY_ID, 'company', {
          name: 'Halyard',
          target: true,
          board: { provider: 'greenhouse', token: 'halyard' },
        }),
      ],
    }),
  );
}

// The fake database and the boards behind one fetch; board requests are recorded.
function start(t, fakeOptions = {}) {
  const fake = graphDb(startedRow(), fakeOptions);
  const boardRequests = [];

  mockSupabaseAuth(t, async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);

    if (!url.startsWith('https://nexui-test.supabase.co')) {
      boardRequests.push(url);

      const match = Object.keys(boardRoutes)
        .filter((prefix) => url.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];

      return match ? Response.json(boardRoutes[match]) : Response.json({}, { status: 404 });
    }

    return fake.fetch(input, init);
  });

  return { fake, boardRequests, db: getUserClient(signToken()) };
}

const buildRun = () =>
  mapRunRow(
    runRow({
      input: { text: GOAL, route: 'reasoning', template: 'job_search', perception: 'model' },
    }),
  );
const session = (run) =>
  sessionOpener({ AI_PROVIDER: 'mock' }, [buildFixture])(run.kind, run.input.text);
const deps = (env = { NEXUI_CONTACT: 'ops@nexui.test' }) => ({
  clock: () => NOW,
  newId: idSequence(),
  env,
});

test("a job search's build is told today's date in the plan's time zone", async (t) => {
  const { db } = start(t);
  const run = buildRun();
  const seen = [];
  const quiet = {
    evaluationModel: failingEvaluationModel(),
    languageModel: () => scriptedModel([], seen),
    providerOptions: () => undefined,
  };

  t.mock.method(console, 'error', () => {});
  await executeRun({ db, run, leaseId: LEASE_ID, session: quiet }, deps({}));

  const message = seen[0].prompt.find((part) => part.role === 'user').content[0].text;

  assert.match(message, /^Today is Tuesday, 2026-10-20 \(Europe\/London\)\.\n\n<goal>/);
});

test('the build run sets the criteria, then scans once: a strong role lands in New, AI-marked', async (t) => {
  const { fake, boardRequests, db } = start(t);
  const run = buildRun();

  await executeRun({ db, run, leaseId: LEASE_ID, session: session(run) }, deps());

  const { state } = fake;
  const role = state.snapshot.objects.find((object) => object.kind === 'opportunity');

  assert.equal(role.data.stage, 'new');
  assert.deepEqual(role.data.fit, {
    score: 0.91,
    reasons: ['Payments PM experience matches'],
    gaps: [],
  });
  assert.deepEqual(role.source, { type: 'ai', runId: RUN_ID });
  assert.deepEqual(state.snapshot.intent.context.jobs.seen, ['greenhouse:halyard:101']);
  assert.equal(state.snapshot.intent.summary.badge.text, '1 new role');
  assert.deepEqual(
    state.applied.map((args) => args.p_payload.label),
    ['Updated Find a Staff PM role in London', 'Found 1 new role'],
  );
  // The run's progress holds the model's call only, so a recording replays no scan.
  assert.deepEqual(
    state.steps.flatMap((step) => step.p_entries.map((entry) => entry.capability)),
    ['object.update'],
  );
  assert.equal(state.finished.p_status, 'succeeded');
  assert.ok(boardRequests.every((url) => url.startsWith('https://boards-api.greenhouse.io/')));
});

test('without a board contact the build skips its scan, and still succeeds', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake, boardRequests, db } = start(t);
  const run = buildRun();

  await executeRun({ db, run, leaseId: LEASE_ID, session: session(run) }, deps({}));

  assert.equal(fake.state.applied.length, 1);
  assert.deepEqual(boardRequests, []);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('when Jev is down the scan surfaces nothing, and the build still succeeds', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake, db } = start(t);
  const run = buildRun();
  const down = { ...session(run), evaluationModel: failingEvaluationModel() };

  await executeRun({ db, run, leaseId: LEASE_ID, session: down }, deps());

  assert.equal(
    fake.state.snapshot.objects.some((object) => object.kind === 'opportunity'),
    false,
  );
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('a Stop during the build skips the scan', async (t) => {
  // Step 1 is the opening marker; step 2 records the model's first step.
  const stopAfterFirstStep = (state, n) => {
    if (n === 2) {
      state.run = { ...state.run, status: 'stopping' };
    }
  };
  const { fake, boardRequests, db } = start(t, { onStep: stopAfterFirstStep });
  const run = buildRun();

  await executeRun({ db, run, leaseId: LEASE_ID, session: session(run) }, deps());

  assert.deepEqual(boardRequests, []);
  assert.equal(fake.state.run.status, 'cancelled');
});

test('mock Jev answers a boolean question from the fixture’s scores', async () => {
  const evaluation = sessionOpener({ AI_PROVIDER: 'mock' }, [buildFixture])(
    'create_intent',
    GOAL,
  ).evaluationModel;
  const scores = await scoreRoles(
    personOf(searchData, null),
    [
      { key: 'greenhouse:halyard:101', title: 'Staff PM', company: 'Halyard', text: '' },
      { key: 'greenhouse:halyard:102', title: 'Staff PM', company: 'Halyard', text: '' },
    ],
    { model: evaluation, providerOptions: undefined },
  );

  assert.deepEqual(
    [...scores],
    [
      ['greenhouse:halyard:101', 0.91],
      ['greenhouse:halyard:102', 0],
    ],
  );
});

// A started search with a partial-fit card from an earlier scan, and 299 keys seen.
function surfaced() {
  const card = jobObject('f7000000-0000-4000-8000-000000000001', 'insight', {
    text: 'Also worth a look: Old at Old.',
    severity: 'info',
    derivedKey: 'search.partial',
    actions: [],
  });
  const seen = Array.from({ length: 299 }, (_, n) => `greenhouse:old:${n}`);

  return jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    context: { jobs: { timezone: 'UTC', startedAt: STAMP, seen } },
    objects: [card],
  });
}

const corvid = (title, n, fit = { score: 0.9, reasons: ['Strong on lending'], gaps: [] }) => ({
  company: { name: 'Corvid', board: { provider: 'ashby', token: 'corvid' } },
  title,
  url: `https://jobs.ashbyhq.com/corvid/${job(n)}`,
  source: { provider: 'ashby', token: 'corvid', job: job(n) },
  fit,
});

function stager(snapshot) {
  return createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot,
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock: () => NOW,
  });
}

test('surfacing adds roles at one shared company, replaces the partial card and keeps 300 seen', () => {
  const plan = surfaced();
  const s = stager(plan);

  s.call('jobs.surfaceMatches', {
    roles: [corvid('PM, Lending', 1), corvid('PM, Cards', 2)],
    partial: corvid('PM, Treasury', 3, {
      score: 0.7,
      reasons: ['Strong on payments'],
      gaps: ['On-site four days in Leeds'],
    }),
    seen: ['k1', 'k2'],
    boards: [],
  });

  const graph = s.graph();
  const card = graph.objects.find((object) => object.data.derivedKey === 'search.partial');

  assert.equal(graph.objects.filter((object) => object.kind === 'company').length, 1);
  assert.equal(graph.objects.filter((object) => object.kind === 'opportunity').length, 2);
  assert.equal(card.id, 'f7000000-0000-4000-8000-000000000001');
  assert.equal(card.data.text, 'Also worth a look: PM, Treasury at Corvid.');
  assert.equal(card.data.detail, 'Strong on payments, but on-site four days in Leeds.');
  assert.deepEqual(
    card.data.actions.map((action) => action.label),
    ['Add it', 'Ask about it'],
  );
  assert.deepEqual(graph.intent.context.jobs.seen.slice(-2), ['k1', 'k2']);
  assert.equal(graph.intent.context.jobs.seen.length, 300);
  assert.equal(s.takeEntries()[0].label, 'Found 2 new roles');
  assert.doesNotThrow(() =>
    prepareChangeset(plan, s.takeOps(), 'ai', NOW.toISOString(), idSequence()),
  );
});

test('adding the partial fit from its card clears the card in the same changeset', () => {
  const first = stager(surfaced());

  first.call('jobs.surfaceMatches', {
    roles: [],
    partial: corvid('PM, Treasury', 3, { score: 0.7, reasons: ['Strong on payments'], gaps: [] }),
    seen: [],
    boards: [],
  });

  const before = first.graph();
  const card = before.objects.find((object) => object.data.derivedKey === 'search.partial');
  const add = card.data.actions.find((action) => action.name === 'jobs.addRole');
  const user = createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot: before,
    actor: 'user',
    runId: null,
    newId: idSequence(),
    clock: () => NOW,
  });

  user.call('jobs.addRole', add.input);

  const ops = prepareChangeset(before, user.takeOps(), 'user', NOW.toISOString(), idSequence());

  assert.ok(ops.some((op) => op.op === 'delete_object' && op.id === card.id));
});
