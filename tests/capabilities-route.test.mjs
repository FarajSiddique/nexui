import assert from 'node:assert/strict';
import test from 'node:test';

import { OPTIONS, POST } from '../apps/api/src/app/api/intents/[id]/capabilities/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, postgrest } from './support/graph-api.mjs';
import {
  eventRow,
  INTENT_ID,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = { params: Promise.resolve({ id: INTENT_ID }) };
const url = `http://localhost/api/intents/${INTENT_ID}/capabilities`;

function press(body, routeContext = context) {
  return POST(authed(url, { method: 'POST', body: JSON.stringify(body) }), routeContext);
}

function graph(t) {
  const applied = [];

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: (args) => {
        applied.push(args);

        return eventRow;
      },
    }),
  );

  return applied;
}

test('the preflight allows POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('pressing a button requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const response = await POST(
    new Request(url, {
      method: 'POST',
      body: JSON.stringify({ name: 'trip.setPlaceDays', input: {} }),
    }),
    context,
  );

  assert.equal(response.status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a malformed intent id is a 404', async (t) => {
  mockSupabaseAuth(t);

  const response = await press(
    { name: 'trip.setPlaceDays', input: {} },
    { params: Promise.resolve({ id: 'nope' }) },
  );

  assert.equal(response.status, 404);
});

test('"Give it back" commits as the user, with its derived changes', async (t) => {
  const applied = graph(t);
  const response = await press({
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 5 },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.event.seq, 42);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].p_actor, 'user');
  assert.equal(applied[0].p_run_id, null);
  assert.deepEqual(applied[0].p_ops[0], {
    op: 'update_object',
    id: TOKYO_ID,
    patch: { data: { ...tokyoData, days: 5 } },
    origin: 'direct',
  });
  assert.equal(applied[0].p_ops.at(-1).op, 'update_intent');
});

test('only the button capabilities can be called', async (t) => {
  const applied = graph(t);
  const response = await press({ name: 'object.delete', input: { ref: TOKYO_ID } });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "That action isn't available.");
  assert.equal(applied.length, 0);
});

test('a refused press is a 400 with its reason, and nothing is written', async (t) => {
  const applied = graph(t);
  const same = await press({ name: 'trip.setPlaceDays', input: { placeId: TOKYO_ID, days: 4 } });

  assert.equal(same.status, 400);
  assert.equal((await same.json()).error, 'Tokyo already has 4 days.');

  const negative = await press({
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: -1 },
  });

  assert.equal(negative.status, 400);
  assert.match((await negative.json()).error, /^days: /);
  assert.equal(applied.length, 0);
});

test('a malformed request is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await press({ name: 'trip', input: {} });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'That action is not valid.');
});
