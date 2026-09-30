import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, OPTIONS, POST } from '../apps/api/src/app/api/intents/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, intentRow, RUN_ID, runRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
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
      'table:runs': () => [],
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

test('Home shows "Drafting" while a run works on an intent', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow],
      'table:runs': (query) => {
        asked = query;

        return [{ intent_id: INTENT_ID }];
      },
    }),
  );

  const [item] = (await (await GET(authed(url))).json()).items;

  assert.deepEqual(item.summary.badge, { text: 'Drafting', tone: 'running' });
  assert.deepEqual(item.summary.strip, intentRow.summary.strip);
  assert.equal(asked.searchParams.get('status'), 'in.(queued,running)');
  assert.match(asked.searchParams.get('created_at'), /^gte\./);
});

test('creating a plan requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  const response = await POST(
    new Request(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(typeof body.error, 'string');
  assert.equal(upstream.mock.callCount(), 0);
});

test('creating an intent seeds the trip, starts its run and answers at once', async (t) => {
  useMockAi(t);

  const tasks = captureRuns(t);
  let created;
  let run;

  mockSupabaseAuth(
    t,
    postgrest({
      create_intent: (args) => {
        created = args;

        return {};
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      create_run: (args) => {
        run = args;

        return runRow({ input: args.p_input });
      },
    }),
  );

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: '  Plan Japan in December ' }) }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.snapshot.intent.goal, 'Plan Japan in December');
  assert.equal(body.runId, RUN_ID);
  assert.equal(created.p_goal, 'Plan Japan in December');
  assert.equal(created.p_template, 'travel');
  assert.deepEqual(
    created.p_ops.map((op) => op.op),
    ['insert_object', 'set_workspace', 'insert_object', 'insert_relationship', 'update_intent'],
  );
  assert.equal(run.p_kind, 'create_intent');
  assert.equal(run.p_input.text, 'Plan Japan in December');
  assert.equal(tasks.length, 1);
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

test('a database failure returns a safe 500 and logs only its code', async (t) => {
  useMockAi(t);

  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ create_intent: () => pgError('XX000', 500) }));

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intents]',
    'Could not start that plan (XX000).',
  ]);
});

test('a misconfigured AI provider is a safe 500 that names the variable in the log', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const previous = { provider: process.env.AI_PROVIDER, key: process.env.AI_GATEWAY_API_KEY };

  process.env.AI_PROVIDER = 'live';
  delete process.env.AI_GATEWAY_API_KEY;
  t.after(() => {
    for (const [name, value] of [
      ['AI_PROVIDER', previous.provider],
      ['AI_GATEWAY_API_KEY', previous.key],
    ]) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
  mockSupabaseAuth(t);

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intents]',
    'AI_PROVIDER=live needs AI_GATEWAY_API_KEY.',
  ]);
});

test('a body over 64 KiB is a 413 and nothing is written', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const body = JSON.stringify({ goal: 'Plan Japan', padding: 'x'.repeat(65_536) });

  const response = await POST(authed(url, { method: 'POST', body }));

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'That change is too large.');
  assert.equal(upstream.mock.callCount(), 0);
});

test('bad JSON is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(authed(url, { method: 'POST', body: '{' }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid JSON');
});
