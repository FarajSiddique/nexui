import assert from 'node:assert/strict';
import test from 'node:test';

import { OPTIONS, POST } from '../apps/api/src/app/api/intents/[id]/ask/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, RUN_ID, runRow, snapshotRow, TRIP_ID, USER_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = { params: Promise.resolve({ id: INTENT_ID }) };
const url = `http://localhost/api/intents/${INTENT_ID}/ask`;

function ask(text, routeContext = context) {
  return POST(authed(url, { method: 'POST', body: JSON.stringify({ text }) }), routeContext);
}

test('the preflight allows POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});

test('asking requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const response = await POST(
    new Request(url, { method: 'POST', body: JSON.stringify({ text: 'Slow it down' }) }),
    context,
  );

  assert.equal(response.status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a malformed intent id is a 404', async (t) => {
  mockSupabaseAuth(t);

  assert.equal((await ask('Slow it down', { params: Promise.resolve({ id: 'x' }) })).status, 404);
});

test('an ask is routed and answered with 202 while its run works', async (t) => {
  useMockAi(t);

  const tasks = captureRuns(t);
  let created;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      create_run: (args) => {
        created = args;

        return runRow({ kind: 'ask', input: args.p_input });
      },
    }),
  );

  const response = await ask('  Could we slow the pace down? ');

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { runId: RUN_ID, route: 'reasoning' });
  assert.deepEqual(created, {
    p_user_id: USER_ID,
    p_intent_id: INTENT_ID,
    p_kind: 'ask',
    p_input: { text: 'Could we slow the pace down?', route: 'reasoning', perception: 'model' },
  });
  assert.equal(tasks.length, 1);
});

test('an ask must be 2 to 1000 characters', async (t) => {
  mockSupabaseAuth(t);

  const response = await ask('x');

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Ask in 2 to 1000 characters.');
});

test('a second ask while a run works is a 409 and starts nothing', async (t) => {
  useMockAi(t);

  const tasks = captureRuns(t);

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      create_run: () => pgError('NXU12'),
    }),
  );

  const response = await ask('Could we slow the pace down?');

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Nexui is still working on this plan.');
  assert.equal(tasks.length, 0);
});

test('an ask about a missing intent is a 404', async (t) => {
  useMockAi(t);
  mockSupabaseAuth(t, postgrest({ get_intent_snapshot: () => null }));

  assert.equal((await ask('Could we slow the pace down?')).status, 404);
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

  const response = await ask('Could we slow the pace down?');

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[ask]',
    'AI_PROVIDER=live needs AI_GATEWAY_API_KEY.',
  ]);
});
