import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { ChangesetInvalidError } from '../apps/api/src/lib/graph/errors.ts';
import { startAsk, startIntent } from '../apps/api/src/lib/orchestrator/orchestrate.ts';
import { PerceptionFailedError } from '../apps/api/src/lib/perception/perceive.ts';
import { getAdminClient, getUserClient } from '../apps/api/src/lib/supabase/clients.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { captureRuns, failingEvaluationModel } from './support/ai.mjs';
import { useFlags } from './support/flags.mjs';
import { graphDb } from './support/graph-db.mjs';
import {
  INTENT_ID,
  KYOTO_ID,
  LEASE_ID,
  RUN_ID,
  snapshotRow,
  TRIP_ID,
  USER_ID,
} from './support/graph.mjs';
import { mockSupabaseAuth, signToken } from './support/supabase-auth.mjs';

const tripFixture = {
  name: 'test-trip',
  kind: 'create_intent',
  match: ['test trip'],
  perception: { template: 'travel' },
  steps: [
    [
      {
        capability: 'object.create',
        input: {
          ref: 'lisbon',
          kind: 'place',
          data: {
            name: 'Lisbon',
            country: 'PT',
            placeType: 'city',
            lat: 38.72,
            lng: -9.14,
            days: 3,
          },
        },
      },
    ],
  ],
};
const savedFixture = {
  name: 'test-saved',
  kind: 'create_intent',
  match: ['wedding'],
  perception: { template: 'unsupported' },
  steps: [],
};
const askFixture = {
  name: 'test-ask',
  kind: 'ask',
  match: ['kyoto'],
  perception: { route: 'edit' },
  steps: [[{ capability: 'trip.setPlaceDays', input: { placeId: 'o1', days: 3 } }]],
};
const jobFixture = {
  name: 'test-job',
  kind: 'create_intent',
  match: ['staff pm'],
  perception: { template: 'job_search' },
  steps: [],
};
const fixtures = [tripFixture, savedFixture, jobFixture, askFixture];

function orchestrator() {
  const openSession = sessionOpener({ AI_PROVIDER: 'mock' }, fixtures);

  return {
    db: getUserClient(signToken()),
    userId: USER_ID,
    openSession,
    worker: { db: getAdminClient(), openSession, maxActive: 100 },
  };
}

function setup(t, row = null, options = {}) {
  const fake = graphDb(row, options);

  mockSupabaseAuth(t, fake.fetch);
  // Every flag is off unless a test turns one on after setup.
  useFlags(t);

  return {
    fake,
    tasks: captureRuns(t),
    deps: orchestrator(),
  };
}

test('a trip goal is seeded at once and filled in by a run after the response', async (t) => {
  const { fake, tasks, deps } = setup(t);
  const started = await startIntent(deps, 'A test trip to Lisbon');

  assert.equal(started.outcome, 'started');
  assert.equal(started.runId, RUN_ID);
  assert.equal(started.snapshot.intent.template, 'travel');
  assert.equal(fake.state.created.p_template, 'travel');
  assert.deepEqual(fake.state.createdRun, {
    p_user_id: USER_ID,
    p_intent_id: started.snapshot.intent.id,
    p_kind: 'create_intent',
    p_input: {
      text: 'A test trip to Lisbon',
      route: 'reasoning',
      template: 'travel',
      perception: 'model',
    },
  });
  assert.equal(
    started.snapshot.objects.some((object) => object.kind === 'place'),
    false,
  );
  assert.equal(tasks.length, 1);

  assert.equal(fake.state.claims.length, 0);

  await tasks[0]();

  assert.deepEqual(fake.state.claims, [
    { p_run_id: RUN_ID, p_limit: 1, p_lease_seconds: 330, p_max_active: 100 },
  ]);
  assert.deepEqual(
    fake.state.snapshot.objects.filter((object) => object.kind === 'place').map((p) => p.title),
    ['Lisbon'],
  );
  assert.equal(fake.state.applied[0].p_lease_id, LEASE_ID);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('a trip whose run cannot start is discarded, and the error stands', async (t) => {
  t.mock.method(console, 'error', () => {});

  const fake = graphDb(null, { failCreateRun: 'XX000' });

  mockSupabaseAuth(t, fake.fetch);

  const tasks = captureRuns(t);
  const deps = orchestrator();

  await assert.rejects(startIntent(deps, 'A test trip to Lisbon'));
  assert.deepEqual(fake.state.discarded, { p_intent_id: fake.state.created.p_intent_id });
  assert.equal(fake.state.snapshot, null);
  assert.equal(tasks.length, 0);
});

test('a goal no template fits is saved: no workspace, no run, no model call but Jev', async (t) => {
  const { fake, tasks, deps } = setup(t);

  assert.deepEqual(await startIntent(deps, 'Plan my wedding next June'), {
    outcome: 'unsupported',
  });
  assert.equal(fake.state.created.p_template, null);
  assert.deepEqual(
    fake.state.created.p_ops.map((op) => op.op),
    ['update_intent'],
  );
  assert.equal(fake.state.snapshot.intent.summary.line, "Nexui can't plan this yet.");
  assert.equal(fake.state.snapshot.workspace, null);
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
});

test('when Jev is down, nothing is created and the goal is not guessed', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake, tasks, deps } = setup(t);
  const openMock = deps.openSession;

  deps.openSession = (kind, text) => ({
    ...openMock(kind, text),
    evaluationModel: failingEvaluationModel(),
  });

  await assert.rejects(startIntent(deps, 'Plan Japan in December'), PerceptionFailedError);
  assert.equal(fake.state.created, null);
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
});

test('an ask is routed by Jev and runs after the response', async (t) => {
  const { fake, tasks, deps } = setup(t, snapshotRow(travelWorkspace(TRIP_ID)));

  assert.deepEqual(await startAsk(deps, INTENT_ID, 'Make Kyoto 3 days'), {
    runId: RUN_ID,
    route: 'edit',
  });
  assert.deepEqual(fake.state.createdRun.p_input, {
    text: 'Make Kyoto 3 days',
    route: 'edit',
    perception: 'model',
  });

  await tasks[0]();

  const kyoto = fake.state.snapshot.objects.find((object) => object.id === KYOTO_ID);

  assert.equal(kyoto.data.days, 3);
  assert.equal(fake.state.applied[0].p_actor, 'ai');
});

test('an ask on an intent without a workspace is refused', async (t) => {
  const { fake, deps } = setup(t, snapshotRow(travelWorkspace(TRIP_ID), { workspace: null }));

  await assert.rejects(
    startAsk(deps, INTENT_ID, 'Make Kyoto 3 days'),
    (error) =>
      error instanceof ChangesetInvalidError && error.message === "Nexui can't plan this yet.",
  );
  assert.equal(fake.state.createdRun, null);
});

test('a job search is seeded with the device’s zone and waits for its resume: no run', async (t) => {
  const { fake, tasks, deps } = setup(t);

  useFlags(t, 'job-search');

  const started = await startIntent(deps, 'Find a Staff PM role in London', 'Europe/London');

  assert.equal(started.outcome, 'awaiting_resume');
  assert.equal(started.snapshot.intent.template, 'job_search');
  assert.deepEqual(started.snapshot.intent.context, {
    jobs: { timezone: 'Europe/London', seen: [] },
  });
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
  // The one-search rule reads the user's plans of this template that are still going: an
  // active or paused search counts; one that ended in a hire (completed) doesn't.
  assert.equal(fake.state.intentQueries[0].template, 'eq.job_search');
  assert.equal(fake.state.intentQueries[0].status, 'not.in.(completed,archived)');
});

test('a second job search goal while one is going answers with that plan, and creates nothing', async (t) => {
  const { fake, deps } = setup(t, null, { activeIntents: [INTENT_ID] });

  useFlags(t, 'job-search');

  assert.deepEqual(await startIntent(deps, 'Find a Staff PM role in Berlin'), {
    outcome: 'existing_search',
    intentId: INTENT_ID,
  });
  assert.equal(fake.state.created, null);
});

test("with its flag off, Jev isn't offered job search, and an answer naming it is refused", async (t) => {
  // `setup` leaves every flag off.
  const { deps } = setup(t);

  // The fixture answers `job_search`, which Jev wasn't offered, so the SDK refuses it.
  await assert.rejects(startIntent(deps, 'Find a Staff PM role in London'), PerceptionFailedError);
});
