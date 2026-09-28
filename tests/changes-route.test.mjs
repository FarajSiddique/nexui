import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/changes/route.ts';
import { authed, postgrest } from './support/graph-api.mjs';
import { eventRow, INTENT_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const change = { ...eventRow, intent_goal: 'Plan Japan in December', reverted_by_event_id: null };

test('a page of changes with its cursor', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      changes_page: (args) => {
        asked = args;

        return [change];
      },
    }),
  );

  const response = await GET(authed(`http://localhost/api/changes?limit=1&intentId=${INTENT_ID}`));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_limit: 1, p_before_seq: null, p_intent_id: INTENT_ID });
  assert.equal(body.items[0].intentGoal, 'Plan Japan in December');
  assert.equal(body.nextCursor, '42');
});

test('a short page has no cursor, and the cursor is passed through', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      changes_page: (args) => {
        asked = args;

        return [change];
      },
    }),
  );

  const body = await (await GET(authed('http://localhost/api/changes?cursor=99'))).json();

  assert.equal(asked.p_before_seq, '99');
  assert.equal(asked.p_limit, 50);
  assert.equal(body.nextCursor, null);
});

test('a bad query is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await GET(authed('http://localhost/api/changes?limit=500'));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid changes query.');
});
