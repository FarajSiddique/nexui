import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import {
  executeRun,
  FAILED_RUN_ERROR,
  INVALID_RUN_ERROR,
} from '../apps/api/src/lib/runs/execute.ts';
import { mapRunRow } from '../apps/api/src/lib/runs/store.ts';
import { getUserClient } from '../apps/api/src/lib/supabase/clients.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { failingEvaluationModel, MockLanguageModelV4, toolStep } from './support/ai.mjs';
import { editObject, graphDb, removeObject } from './support/graph-db.mjs';
import {
  idSequence,
  KYOTO_ID,
  RUN_ID,
  runRow,
  seedRow,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';
import { mockSupabaseAuth, signToken } from './support/supabase-auth.mjs';

const tokyo = { name: 'Tokyo', country: 'JP', placeType: 'city', lat: 35.68, lng: 139.69, days: 4 };
const kyoto = { name: 'Kyoto', country: 'JP', placeType: 'city', lat: 35.01, lng: 135.77, days: 3 };

const createFixture = {
  name: 'test-trip',
  kind: 'create_intent',
  match: ['test trip'],
  perception: {},
  steps: [
    [
      { capability: 'object.update', input: { ref: 'trip', data: { destinations: ['Japan'] } } },
      { capability: 'object.create', input: { ref: 'tokyo', kind: 'place', data: tokyo } },
      { capability: 'object.create', input: { ref: 'kyoto', kind: 'place', data: kyoto } },
    ],
    [
      {
        capability: 'object.create',
        input: {
          ref: 'tokyo-kyoto',
          kind: 'leg',
          from: 'tokyo',
          to: 'kyoto',
          data: { mode: 'train' },
        },
      },
    ],
  ],
};

// In the plan-1 fixture trip, o1 is Kyoto and o2 is Tokyo.
function askFixture(route, steps) {
  return { name: `test-${route}`, kind: 'ask', match: ['test ask'], perception: { route }, steps };
}

const setDays = (ref, days) => ({ capability: 'trip.setPlaceDays', input: { placeId: ref, days } });

function start(t, row, fakeOptions = {}) {
  const fake = graphDb(row, fakeOptions);

  mockSupabaseAuth(t, fake.fetch);

  return { fake, db: getUserClient(signToken()) };
}

function createRun() {
  return mapRunRow(
    runRow({
      input: { text: 'A test trip', route: 'reasoning', template: 'travel', perception: 'model' },
    }),
  );
}

function askRun(route) {
  return mapRunRow(
    runRow({ kind: 'ask', input: { text: 'A test ask', route, perception: 'model' } }),
  );
}

function mockSession(run, fixtures) {
  return sessionOpener({ AI_PROVIDER: 'mock' }, fixtures)(run.kind, run.input.text);
}

const deps = () => ({ clock: () => new Date('2026-09-29T10:00:00Z'), newId: idSequence() });

test('each model step commits one changeset as the run, and the run succeeds', async (t) => {
  const { fake, db } = start(t, seedRow(travelWorkspace(TRIP_ID), 'A test trip'));
  const run = createRun();

  await executeRun({ db, run, session: mockSession(run, [createFixture]) }, deps());

  const { state } = fake;
  const places = state.snapshot.objects.filter((object) => object.kind === 'place');

  assert.deepEqual(
    state.applied.map((args) => [args.p_actor, args.p_run_id]),
    [
      ['ai', RUN_ID],
      ['ai', RUN_ID],
    ],
  );
  assert.deepEqual(
    places.map((place) => [place.title, place.position]),
    [
      ['Tokyo', 1],
      ['Kyoto', 2],
    ],
  );
  assert.deepEqual(places[0].source, { type: 'ai', runId: RUN_ID });
  assert.equal(state.snapshot.objects.filter((object) => object.kind === 'leg').length, 1);
  // The start marker, the two tool steps, then the model's closing text step.
  assert.deepEqual(
    state.steps.map((step) =>
      step.p_entries.map((entry) => [entry.step, entry.capability, entry.ok]),
    ),
    [
      [],
      [
        [0, 'object.update', true],
        [0, 'object.create', true],
        [0, 'object.create', true],
      ],
      [[1, 'object.create', true]],
      [],
    ],
  );
  assert.deepEqual(state.finished, { p_run_id: RUN_ID, p_status: 'succeeded', p_error: null });
});

test('a cancel stops the run after the step that sees it', async (t) => {
  const { fake, db } = start(t, seedRow(travelWorkspace(TRIP_ID), 'A test trip'), {
    onApply: (state) => {
      state.run = { ...state.run, status: 'cancelled' };
    },
  });
  const run = createRun();

  await executeRun({ db, run, session: mockSession(run, [createFixture]) }, deps());

  assert.equal(fake.state.applied.length, 1);
  assert.equal(fake.state.run.status, 'cancelled');
});

test('a run cancelled before it starts does nothing', async (t) => {
  const { fake, db } = start(t, seedRow(travelWorkspace(TRIP_ID), 'A test trip'), {
    run: runRow({ status: 'cancelled' }),
  });
  const run = createRun();

  await executeRun({ db, run, session: mockSession(run, [createFixture]) }, deps());

  assert.equal(fake.state.loads, 0);
  assert.equal(fake.state.applied.length, 0);
  assert.equal(fake.state.finished, null);
});

test('two invalid steps in a row fail the run and write nothing', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)));
  const run = askRun('edit');
  const fixture = askFixture('edit', [[setDays('o2', 400)], [setDays('o2', 400)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(fake.state.applied.length, 0);
  assert.deepEqual(fake.state.finished, {
    p_run_id: RUN_ID,
    p_status: 'failed',
    p_error: INVALID_RUN_ERROR,
  });
});

test('a user edit mid-run fails that step, keeps what committed and says why', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  // Reads: 1 at the start, 2 and 3 around the first commit, 4 before the second commit.
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)), {
    onLoad: (state, n) => {
      if (n === 4) {
        removeObject(state, KYOTO_ID);
      }
    },
  });
  const run = askRun('reasoning');
  const fixture = askFixture('reasoning', [[setDays('o2', 3)], [setDays('o1', 5)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(fake.state.applied.length, 1);
  assert.deepEqual(fake.state.finished, {
    p_run_id: RUN_ID,
    p_status: 'failed',
    p_error: 'That item no longer exists.',
  });
  assert.equal(fake.state.steps.length, 3);
  assert.deepEqual(logged.mock.calls.at(-1).arguments, ['[runs]', 'A run failed.']);
});

test('a model error fails the run, keeps the steps before it and logs no detail', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)));
  const run = askRun('reasoning');
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;

      if (calls === 1) {
        return toolStep([['trip_setPlaceDays', { placeId: 'o2', days: 3 }]]);
      }

      throw new Error('provider exploded: secret detail');
    },
  });
  const session = {
    evaluationModel: failingEvaluationModel(),
    languageModel: () => model,
    providerOptions: () => undefined,
  };

  await executeRun({ db, run, session }, deps());

  assert.equal(fake.state.applied.length, 1);
  assert.equal(fake.state.finished.p_error, FAILED_RUN_ERROR);

  for (const call of logged.mock.calls) {
    assert.doesNotMatch(call.arguments.join(' '), /secret detail/);
  }
});

// Load 1 is the run's first snapshot; load 2 is the one step 0 commits against.
const editTokyoDuringStep = (changes) => (state, n) => {
  if (n === 2) {
    editObject(state, TOKYO_ID, changes);
  }
};

const placeData = (state, id) => state.snapshot.objects.find((object) => object.id === id).data;

test('a user edit made while a step runs survives, and the step merges around it', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)), {
    onLoad: editTokyoDuringStep({ days: 6 }),
  });
  const run = askRun('reasoning');
  const fixture = askFixture('reasoning', [
    [
      { capability: 'object.update', input: { ref: 'o2', data: { why: 'Best ramen' } } },
      setDays('o1', 5),
    ],
  ]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(fake.state.applied.length, 1);
  assert.equal(placeData(fake.state, TOKYO_ID).days, 6);
  assert.equal(placeData(fake.state, TOKYO_ID).why, 'Best ramen');
  assert.equal(placeData(fake.state, KYOTO_ID).days, 5);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('a step call that would undo the field the user just changed is dropped', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)), {
    onLoad: editTokyoDuringStep({ days: 6 }),
  });
  const run = askRun('reasoning');
  const fixture = askFixture('reasoning', [[setDays('o2', 3), setDays('o1', 5)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(placeData(fake.state, TOKYO_ID).days, 6);
  assert.equal(placeData(fake.state, KYOTO_ID).days, 5);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('a step whose every call was superseded commits nothing and the run goes on', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)), {
    onLoad: editTokyoDuringStep({ days: 6 }),
  });
  const run = askRun('reasoning');
  const fixture = askFixture('reasoning', [[setDays('o2', 3)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(fake.state.applied.length, 0);
  assert.equal(placeData(fake.state, TOKYO_ID).days, 6);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});
