import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE, OPTIONS } from '../apps/api/src/app/api/intents/[id]/route.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { INTENT_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = (id) => ({ params: Promise.resolve({ id }) });
const url = `http://localhost/api/intents/${INTENT_ID}`;

test('deleting a plan deletes it through delete_intent and answers 204', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      delete_intent: (args) => {
        asked = args;

        return null;
      },
    }),
  );

  const response = await DELETE(authed(url, { method: 'DELETE' }), context(INTENT_ID));

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual(asked, { p_intent_id: INTENT_ID });
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /DELETE/);
});

test('a missing or foreign plan is 404, and a bad id never reaches the database', async (t) => {
  const upstream = mockSupabaseAuth(t, postgrest({ delete_intent: () => pgError('NXU04') }));

  const missing = await DELETE(authed(url, { method: 'DELETE' }), context(INTENT_ID));

  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'Not found.');

  const calls = upstream.mock.callCount();
  const bad = await DELETE(authed('http://localhost/x', { method: 'DELETE' }), context('nope'));

  assert.equal(bad.status, 404);
  assert.equal(upstream.mock.callCount(), calls);
});

test('a plan a run is still working on is a 409', async (t) => {
  mockSupabaseAuth(t, postgrest({ delete_intent: () => pgError('NXU12') }));

  const response = await DELETE(authed(url, { method: 'DELETE' }), context(INTENT_ID));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Nexui is still working on this plan.');
});

test('deleting a plan requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  const response = await DELETE(new Request(url, { method: 'DELETE' }), context(INTENT_ID));

  assert.equal(response.status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a database failure returns a safe 500 and logs only its code', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ delete_intent: () => pgError('XX000', 500) }));

  const response = await DELETE(authed(url, { method: 'DELETE' }), context(INTENT_ID));

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not delete that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intent]',
    'Could not delete that plan (XX000).',
  ]);
});

test('the preflight allows DELETE', () => {
  assert.match(OPTIONS().headers.get('Access-Control-Allow-Methods'), /DELETE/);
});
