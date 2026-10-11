import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { ChangesetInvalidError } from '../apps/api/src/lib/graph/errors.ts';
import { startAsk, startIntent } from '../apps/api/src/lib/orchestrator/orchestrate.ts';
import { getAdminClient, getUserClient } from '../apps/api/src/lib/supabase/clients.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { captureRuns, failingEvaluationModel } from './support/ai.mjs';
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
const jobFixture = {
  name: 'test-job',
  kind: 'create_intent',
  match: ['new job'],
  perception: { template: 'none' },
  steps: [],
};
const askFixture = {
  name: 'test-ask',
  kind: 'ask',
  match: ['kyoto'],
  perception: { route: 'edit' },
  steps: [[{ capability: 'trip.setPlaceDays', input: { placeId: 'o1', days: 3 } }]],
};
const fixtures = [tripFixture, jobFixture, askFixture];

function orchestrator() {
  const openSession = sessionOpener({ AI_PROVIDER: 'mock' }, fixtures);

  return {
    db: getUserClient(signToken()),
    userId: USER_ID,
    openSession,
    worker: { db: getAdminClient(), openSession, maxActive: 100 },
  };
}

function setup(t, row = null) {
  const fake = graphDb(row);

  mockSupabaseAuth(t, fake.fetch);

  return {
    fake,
    tasks: captureRuns(t),
    deps: orchestrator(),
  };
}

test('a trip goal is seeded at once and filled in by a run after the response', async (t) => {
  const { fake, tasks, deps } = setup(t);
  const started = await startIntent(deps, 'A test trip to Lisbon');

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

test('a goal that is not a trip gets a plain intent and no run', async (t) => {
  const { fake, tasks, deps } = setup(t);
  const started = await startIntent(deps, 'Find a new job');

  assert.equal(started.runId, null);
  assert.equal(started.snapshot.intent.template, null);
  assert.equal(started.snapshot.intent.summary.line, "Nexui can't plan this yet.");
  assert.equal(fake.state.created.p_template, null);
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
});

test('when Jev is down, the goal is treated as a trip', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake, deps } = setup(t);
  const openMock = deps.openSession;

  deps.openSession = (kind, text) => ({
    ...openMock(kind, text),
    evaluationModel: failingEvaluationModel(),
  });
  await startIntent(deps, 'Find a new job');

  assert.equal(fake.state.created.p_template, 'travel');
  assert.equal(fake.state.createdRun.p_input.perception, 'fallback');
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
