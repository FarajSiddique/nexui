import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/cron/runs/route.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { pgError, postgrest } from './support/graph-api.mjs';
import { LEASE_ID, runRow } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = 'http://localhost/api/cron/runs';
const SECRET = 'cron-secret-test-0123456789abcdef';

// `null` leaves CRON_SECRET unset.
function useCronSecret(t, value = SECRET) {
  const previous = process.env.CRON_SECRET;

  if (value === null) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previous;
    }
  });
}

const cron = (authorization) =>
  new Request(url, { headers: authorization ? { Authorization: authorization } : {} });

test('the sweep needs the cron secret', async (t) => {
  const upstream = mockSupabaseAuth(t);

  useCronSecret(t);

  for (const authorization of [null, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
    const response = await GET(cron(authorization));

    assert.equal(response.status, 401, String(authorization));
    assert.deepEqual(await response.json(), { error: 'Not allowed.' });
  }

  assert.equal(upstream.mock.calls.length, 0);
});

test('without a configured secret the sweep refuses and says so in the log', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t);
  useCronSecret(t, null);

  const response = await GET(cron('Bearer '));

  assert.equal(response.status, 503);
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[cron]',
    'CRON_SECRET (32 characters or more) is required for scheduled jobs.',
  ]);
});

test('a short secret counts as unset, even when the header matches it', async (t) => {
  t.mock.method(console, 'error', () => {});
  mockSupabaseAuth(t);
  useCronSecret(t, 'short-secret');

  assert.equal((await GET(cron('Bearer short-secret'))).status, 503);
});

test('the sweep reaps, claims and answers what it did', async (t) => {
  useMockAi(t);
  useCronSecret(t);

  const sent = [];

  mockSupabaseAuth(
    t,
    postgrest({
      reap_runs: () => 2,
      claim_runs: (args) => {
        sent.push(args);

        return [runRow({ lease_id: LEASE_ID, attempts: 1 })];
      },
    }),
  );

  const tasks = captureRuns(t);
  const response = await GET(cron(`Bearer ${SECRET}`));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { reaped: 2, claimed: 1 });
  assert.equal(sent[0].p_run_id, null);
  assert.equal(tasks.length, 1);
});

test('a failed sweep is a logged, safe 500', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  useMockAi(t);
  useCronSecret(t);
  mockSupabaseAuth(t, postgrest({ reap_runs: () => pgError('XX000', 500) }));

  const response = await GET(cron(`Bearer ${SECRET}`));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not sweep runs.' });
  assert.deepEqual(logged.mock.calls[0].arguments, ['[cron]', 'Could not sweep runs (XX000).']);
});
