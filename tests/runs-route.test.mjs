import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPTIONS as CANCEL_OPTIONS,
  POST as CANCEL,
} from '../apps/api/src/app/api/runs/[id]/cancel/route.ts';
import { GET, OPTIONS } from '../apps/api/src/app/api/runs/[id]/route.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { RUN_ID, runRow } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = { params: Promise.resolve({ id: RUN_ID }) };
const url = `http://localhost/api/runs/${RUN_ID}`;
const entry = {
  step: 0,
  capability: 'object.create',
  label: 'Added Kyoto',
  ok: true,
  ms: 4,
  input: { ref: 'kyoto' },
};

test('the preflights allow GET and POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(CANCEL_OPTIONS().headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('reading or cancelling a run requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  assert.equal((await GET(new Request(url), context)).status, 401);
  assert.equal(
    (await CANCEL(new Request(`${url}/cancel`, { method: 'POST' }), context)).status,
    401,
  );
  assert.equal(upstream.mock.callCount(), 0);
});

test('a run is read with its progress', async (t) => {
  mockSupabaseAuth(
    t,
    postgrest({
      'table:runs': () => [
        runRow({ status: 'running', progress: [entry], started_at: new Date().toISOString() }),
      ],
    }),
  );

  const response = await GET(authed(url), context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'running');
  assert.deepEqual(body.progress, [entry]);
});

test('a run that stopped long ago reads as failed', async (t) => {
  mockSupabaseAuth(
    t,
    postgrest({
      'table:runs': () => [runRow({ status: 'running', created_at: '2026-01-01T00:00:00Z' })],
    }),
  );

  const body = await (await GET(authed(url), context)).json();

  assert.equal(body.status, 'failed');
  assert.equal(body.error, 'This run stopped unexpectedly.');
});

test('a missing or malformed run is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ 'table:runs': () => [] }));

  assert.equal((await GET(authed(url), context)).status, 404);
  assert.equal(
    (await GET(authed('http://localhost/api/runs/x'), { params: Promise.resolve({ id: 'x' }) }))
      .status,
    404,
  );
});

test('a database failure reading a run is a safe 500 and logs only its code', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ 'table:runs': () => pgError('XX000', 500) }));

  const response = await GET(authed(url), context);

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not load that run. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, ['[runs]', 'Could not load that run (XX000).']);
});

test('cancel stops the run and returns it', async (t) => {
  let sent;

  mockSupabaseAuth(
    t,
    postgrest({
      cancel_run: (args) => {
        sent = args;

        return runRow({ status: 'cancelled', finished_at: new Date().toISOString() });
      },
    }),
  );

  const response = await CANCEL(authed(`${url}/cancel`, { method: 'POST' }), context);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'cancelled');
  assert.deepEqual(sent, { p_run_id: RUN_ID });
});

test('cancelling another user’s run is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ cancel_run: () => pgError('NXU04') }));

  assert.equal((await CANCEL(authed(`${url}/cancel`, { method: 'POST' }), context)).status, 404);
});

test('a database failure cancelling a run is a safe 500 and logs only its code', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ cancel_run: () => pgError('XX000', 500) }));

  const response = await CANCEL(authed(`${url}/cancel`, { method: 'POST' }), context);

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not stop that run. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, ['[runs]', 'Could not stop that run (XX000).']);
});
