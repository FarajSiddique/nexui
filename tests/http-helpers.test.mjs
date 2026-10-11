import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBody, withUser } from '../apps/api/src/lib/http/index.ts';
import { askRequestSchema } from '../packages/types/src/index.ts';
import { authed } from './support/graph-api.mjs';
import { USER_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const headers = { 'Cache-Control': 'no-store' };
const context = { params: Promise.resolve({ id: 'a' }) };

test('withUser answers 401 itself, and hands the handler the user and the route context', async (t) => {
  mockSupabaseAuth(t);

  const seen = [];
  const handler = withUser(headers, async (request, user, routeContext) => {
    seen.push([user.userId, await routeContext.params]);

    return Response.json({ ok: true }, { headers });
  });
  const denied = await handler(new Request('http://localhost/x'), context);

  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  assert.equal(seen.length, 0);

  const allowed = await handler(authed('http://localhost/x'), context);

  assert.equal(allowed.status, 200);
  assert.deepEqual(seen, [[USER_ID, { id: 'a' }]]);
});

test('parseBody gives the parsed data, or a 400 with its message', async () => {
  assert.deepEqual(parseBody(askRequestSchema, { text: ' Make Kyoto 3 days ' }, 'Ask.', headers), {
    data: { text: 'Make Kyoto 3 days' },
  });

  const refused = parseBody(
    askRequestSchema,
    { text: 'x' },
    'Ask in 2 to 1000 characters.',
    headers,
  );

  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: 'Ask in 2 to 1000 characters.' });
});
