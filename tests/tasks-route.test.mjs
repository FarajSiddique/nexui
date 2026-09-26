// Contract for anchored-shell.md, Slice A "API for slice A": `GET /api/tasks` lives in
// apps/api/src/app/api/tasks/route.ts and exports `GET(request: Request): Promise<Response>`
// and `OPTIONS(): Response`. It reads the `tasks` table through the user's client (RLS),
// keeping open tasks only (`completed_at is null`), ordered `due_date` ascending with no
// date last and `created_at` descending last, limit 300. Response `{ items: SavedTask[] }`.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, OPTIONS } from '../apps/api/src/app/api/tasks/route.ts';
import { savedTask, TASK_ID, taskRow } from './support/records.mjs';
import {
  mockSupabaseAuth,
  signToken,
  supabaseEnv,
  upstreamCall,
} from './support/supabase-auth.mjs';

const UNDATED_ID = '4f1a5d2c-6b8e-4a0f-8c2d-7e9b1a3c5d6f';
const undatedRow = {
  ...taskRow,
  id: UNDATED_ID,
  title: 'Renew passport',
  due_date: null,
  due_time: null,
};
const savedUndated = { ...savedTask, id: UNDATED_ID, title: 'Renew passport', due: null };

function request(token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request('http://localhost/api/tasks', { headers });
}

test('tasks require a valid token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const response = await GET(request(null));
  assert.equal(response.status, 401);
  assert.equal(typeof (await response.json()).error, 'string');
  assert.equal(upstream.mock.callCount(), 0);
});

test('the preflight allows GET', async () => {
  const response = OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('open tasks come back as saved tasks in the order the database returned', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([taskRow, undatedRow]));
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { items: [savedTask, savedUndated] });
  assert.equal(upstream.mock.callCount(), 1);
});

test('the query uses the user client and asks for open tasks, due first, no date last', async (t) => {
  const token = signToken();
  const upstream = mockSupabaseAuth(t, async () => Response.json([]));
  const response = await GET(request(token));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  const call = upstreamCall(upstream);
  assert.equal(call.method, 'GET');
  assert.equal(call.url.pathname, '/rest/v1/tasks');
  // RLS: the user's own token with the publishable key, never the secret key.
  assert.equal(call.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(call.headers.get('apikey'), supabaseEnv.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(call.url.searchParams.get('completed_at'), 'is.null');
  assert.equal(call.url.searchParams.get('limit'), '300');
  const order = call.url.searchParams.get('order') ?? '';
  const terms = order.split(',');
  assert.equal(terms[0], 'due_date.asc.nullslast', `order was "${order}"`);
  assert.equal(terms.at(-1), 'created_at.desc', `order was "${order}"`);
});

test('a database failure returns a safe 500 message', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json(
      { code: 'XX000', message: 'relation secret_internal_table exploded', details: TASK_ID },
      { status: 500 },
    ),
  );
  t.mock.method(console, 'error', () => {});
  const response = await GET(request());
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(body.error, /secret_internal_table|XX000/);
  assert.equal(body.error.includes(TASK_ID), false);
});
