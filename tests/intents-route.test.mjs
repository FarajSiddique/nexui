import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, OPTIONS, POST } from '../apps/api/src/app/api/intents/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { intentRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = 'http://localhost/api/intents';

test('the preflight allows GET and POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
});

test('listing requires a token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(new Request(url))).status, 401);
});

test('Home lists intents, most recent first', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': (query) => {
        asked = query;

        return [intentRow];
      },
    }),
  );

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: intentRow.id,
        goal: intentRow.goal,
        template: 'travel',
        status: 'exploring',
        summary: intentRow.summary,
        lastActivityAt: intentRow.last_activity_at,
      },
    ],
  });
  assert.equal(asked.searchParams.get('status'), 'neq.archived');
  assert.equal(asked.searchParams.get('order'), 'last_activity_at.desc');
});

test('creating an intent seeds the trip in one call and returns the snapshot', async (t) => {
  let created;

  mockSupabaseAuth(
    t,
    postgrest({
      create_intent: (args) => {
        created = args;

        return {};
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
    }),
  );

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: '  Plan Japan in December ' }) }),
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).intent.goal, 'Plan Japan in December');
  assert.equal(created.p_goal, 'Plan Japan in December');
  assert.equal(created.p_template, 'travel');
  assert.deepEqual(
    created.p_ops.map((op) => op.op),
    ['insert_object', 'set_workspace', 'insert_object', 'insert_relationship', 'update_intent'],
  );
});

test('a goal must be 3 to 500 characters', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'hi' }) }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    'Describe what you are planning in 3 to 500 characters.',
  );
});

test('a database failure returns a safe 500', async (t) => {
  mockSupabaseAuth(t, postgrest({ create_intent: () => pgError('XX000', 500) }));

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
});
