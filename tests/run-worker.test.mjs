import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { getAdminClient } from '../apps/api/src/lib/supabase/clients.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  readRunMaxActive,
  runWorker,
  sweepRuns,
  workRun,
} from '../apps/api/src/lib/runs/worker.ts';
import { captureRuns } from './support/ai.mjs';
import { pgError, postgrest } from './support/graph-api.mjs';
import { graphDb } from './support/graph-db.mjs';
import { LEASE_ID, RUN_ID, runRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth, upstreamCall } from './support/supabase-auth.mjs';

const askFixture = {
  name: 'test-ask',
  kind: 'ask',
  match: ['kyoto'],
  perception: { route: 'edit' },
  steps: [[{ capability: 'trip.setPlaceDays', input: { placeId: 'o1', days: 3 } }]],
};

const queuedAsk = (overrides = {}) =>
  runRow({
    kind: 'ask',
    input: { text: 'Make Kyoto 3 days', route: 'edit', perception: 'model' },
    ...overrides,
  });

function worker(maxActive = 100) {
  return {
    db: getAdminClient(),
    openSession: sessionOpener({ AI_PROVIDER: 'mock' }, [askFixture]),
    maxActive,
  };
}

test('workRun claims the run, then executes it with its lease', async (t) => {
  const fake = graphDb(snapshotRow(travelWorkspace(TRIP_ID)), { run: queuedAsk() });

  mockSupabaseAuth(t, fake.fetch);
  await workRun(worker(), RUN_ID);

  assert.deepEqual(fake.state.claims, [
    { p_run_id: RUN_ID, p_limit: 1, p_lease_seconds: 330, p_max_active: 100 },
  ]);
  assert.equal(fake.state.run.attempts, 1);
  assert.deepEqual(
    fake.state.applied.map((args) => [args.rpc, args.p_lease_id]),
    [['run_apply_changeset', LEASE_ID]],
  );
  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('workRun acts as the service role', async (t) => {
  const upstream = mockSupabaseAuth(t, postgrest({ claim_runs: () => [] }));

  await workRun(worker(), RUN_ID);

  assert.equal(upstreamCall(upstream).headers.get('apikey'), 'sb_secret_test');
});

test('workRun does nothing when the run is taken, finished or over the cap', async (t) => {
  const fake = graphDb(snapshotRow(travelWorkspace(TRIP_ID)), {
    run: queuedAsk({ status: 'cancelled' }),
  });

  mockSupabaseAuth(t, fake.fetch);
  await workRun(worker(), RUN_ID);

  assert.equal(fake.state.claims.length, 1);
  assert.equal(fake.state.loads, 0);
  assert.equal(fake.state.steps.length, 0);
});

test('workRun logs a failed claim without throwing, and leaves the run to the cron', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ claim_runs: () => pgError('XX000', 500) }));
  await workRun(worker(), RUN_ID);

  assert.deepEqual(logged.mock.calls[0].arguments, ['[runs]', 'Could not claim a run (XX000).']);
});

test('sweepRuns reaps, then claims runs nobody started and schedules each', async (t) => {
  const fake = graphDb(snapshotRow(travelWorkspace(TRIP_ID)), { run: queuedAsk() });

  mockSupabaseAuth(t, fake.fetch);

  const tasks = captureRuns(t);
  const swept = await sweepRuns(worker(25));

  assert.deepEqual(swept, { reaped: 0, claimed: 1 });
  assert.equal(fake.state.reaps, 1);
  assert.deepEqual(fake.state.claims, [
    { p_run_id: null, p_limit: 10, p_lease_seconds: 330, p_max_active: 25 },
  ]);
  assert.equal(tasks.length, 1);
  assert.equal(fake.state.finished, null);

  await tasks[0]();

  assert.equal(fake.state.finished.p_status, 'succeeded');
});

test('RUN_MAX_ACTIVE is a positive whole number, or 100', () => {
  assert.equal(readRunMaxActive({}), 100);
  assert.equal(readRunMaxActive({ RUN_MAX_ACTIVE: ' 40 ' }), 40);
  assert.equal(readRunMaxActive({ RUN_MAX_ACTIVE: '0' }), 100);
  assert.equal(readRunMaxActive({ RUN_MAX_ACTIVE: '2.5' }), 100);
  assert.equal(readRunMaxActive({ RUN_MAX_ACTIVE: 'lots' }), 100);
});

test('the worker needs the secret key', () => {
  assert.throws(
    () => runWorker({ SUPABASE_URL: 'https://nexui-test.supabase.co', AI_PROVIDER: 'mock' }),
    { message: 'SUPABASE_SECRET_KEY is required for runs and account deletion.' },
  );
});
