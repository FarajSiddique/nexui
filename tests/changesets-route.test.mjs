import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intents/[id]/changesets/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import {
  eventRow,
  INTENT_ID,
  intentRow,
  LATER,
  snapshotRow,
  STAMP,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = { params: Promise.resolve({ id: INTENT_ID }) };
const url = `http://localhost/api/intents/${INTENT_ID}/changesets`;
const shorten = {
  op: 'update_object',
  id: TOKYO_ID,
  expectedUpdatedAt: STAMP,
  patch: { data: { ...tokyoData, days: 3 } },
};

function send(ops) {
  return POST(authed(url, { method: 'POST', body: JSON.stringify({ ops }) }), context);
}

test('committing a changeset requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  const response = await POST(
    new Request(url, { method: 'POST', body: JSON.stringify({ ops: [shorten] }) }),
    context,
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(typeof body.error, 'string');
  assert.equal(upstream.mock.callCount(), 0);
});

test('an edit commits with its derived ops and returns the event and snapshot', async (t) => {
  let applied;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: (args) => {
        applied = args;

        return eventRow;
      },
    }),
  );

  const response = await send([shorten]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.event.seq, 42);
  assert.equal(applied.p_actor, 'user');
  assert.equal(applied.p_run_id, null);
  assert.equal(applied.p_expected_activity_at, STAMP);
  assert.deepEqual(applied.p_ops[0], { ...shorten, origin: 'direct' });
  assert.equal(applied.p_ops.at(-1).op, 'update_intent');
});

test('invalid domain data is a 400 that names the field, and nothing is written', async (t) => {
  const upstream = mockSupabaseAuth(
    t,
    postgrest({ get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)) }),
  );

  for (const days of [-1, 2.5]) {
    const response = await send([{ ...shorten, patch: { data: { ...tokyoData, days } } }]);

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /days/);
  }

  const calls = upstream.mock.calls.map((call) => String(call.arguments[0]));

  assert.ok(!calls.some((call) => call.includes('apply_changeset')));
});

test('server-owned fields are refused before anything is loaded', async (t) => {
  const upstream = mockSupabaseAuth(t);

  for (const ops of [
    [{ ...shorten, origin: 'derived' }],
    [{ ...shorten, patch: { source: { type: 'ai' } } }],
    [{ op: 'update_intent', patch: { status: 'active' } }],
    [{ op: 'set_workspace', doc: travelWorkspace(TRIP_ID) }],
    [],
  ]) {
    const response = await send(ops);

    assert.equal(response.status, 400, JSON.stringify(ops));
    assert.equal((await response.json()).error, 'That change is not valid.');
  }

  assert.equal(upstream.mock.callCount(), 0);
});

test('a commit that loses a race re-derives from a fresh snapshot and retries once', async (t) => {
  const calls = [];
  const moved = { ...intentRow, last_activity_at: LATER };

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => {
        calls.push('snapshot');

        return snapshotRow(travelWorkspace(TRIP_ID), {
          intent: calls.length > 1 ? moved : intentRow,
        });
      },
      apply_changeset: (args) => {
        calls.push(`apply@${args.p_expected_activity_at}`);

        return calls.length === 2 ? pgError('NXU08') : eventRow;
      },
    }),
  );

  const response = await send([shorten]);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['snapshot', `apply@${STAMP}`, 'snapshot', `apply@${LATER}`, 'snapshot']);
});

test('a stale edit is a 409 with a readable message after one retry', async (t) => {
  let attempts = 0;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: () => {
        attempts += 1;

        return pgError('NXU08');
      },
    }),
  );

  const response = await send([shorten]);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'This changed while you were editing. Try again.');
  assert.equal(attempts, 2);
});

test('an id or link that already exists is a 409', async (t) => {
  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: () => pgError('NXU11'),
    }),
  );

  const response = await send([shorten]);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'That already exists.');
});

test('a body over 64 KiB is a 413 and nothing is loaded', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const body = JSON.stringify({ ops: [shorten], padding: 'x'.repeat(65_536) });

  const response = await POST(authed(url, { method: 'POST', body }), context);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'That change is too large.');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(upstream.mock.callCount(), 0);
});

test('an unknown intent is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ get_intent_snapshot: () => null }));

  assert.equal((await send([shorten])).status, 404);
});

test('bad JSON is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(authed(url, { method: 'POST', body: '{' }), context);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid JSON');
});
