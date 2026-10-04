import assert from 'node:assert/strict';
import test from 'node:test';

import { DELETE } from '../apps/api/src/app/api/account/route.ts';
import { appleIdToken, useAppleEnv } from './support/apple.mjs';
import { mockSupabaseAuth, signToken, supabaseEnv } from './support/supabase-auth.mjs';

const userId = '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11';
const userUrl = `${supabaseEnv.SUPABASE_URL}/auth/v1/admin/users/${userId}`;
const LOOKUP = `GET ${userUrl}`;
const REMOVE = `DELETE ${userUrl}`;
const TOKEN = 'POST https://appleid.apple.com/auth/token';
const REVOKE = 'POST https://appleid.apple.com/auth/revoke';

const appleIdentity = {
  provider: 'apple',
  identity_data: { sub: 'apple-user-1', email: 'x@privaterelay.appleid.com' },
};
const googleIdentity = { provider: 'google', identity_data: { sub: 'google-user-1' } };

function request(body = {}, token = signToken()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Stubs Supabase's admin user endpoints and Apple's token endpoints. Records each call as
 * `METHOD url` in order; pass a handler to make one step answer differently.
 */
function mockServices(t, { identities = [], handlers = {} } = {}) {
  const calls = [];
  const answers = {
    [LOOKUP]: () => Response.json({ id: userId, identities }),
    [REMOVE]: () => Response.json({}),
    [TOKEN]: () =>
      Response.json({ refresh_token: 'refresh-1', id_token: appleIdToken('apple-user-1') }),
    [REVOKE]: () => new Response(null, { status: 200 }),
    ...handlers,
  };
  const upstream = mockSupabaseAuth(t, async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const key = `${method} ${url}`;
    calls.push({ key, init });
    return answers[key] ? answers[key](init) : new Response(null, { status: 404 });
  });
  return { calls, upstream, keys: () => calls.map((call) => call.key) };
}

function captureErrors(t) {
  return t.mock.method(console, 'error', () => {});
}

const logged = (errors) => JSON.stringify(errors.mock.calls.map((call) => call.arguments));

test('deleting an account requires a valid token', async (t) => {
  const { upstream } = mockServices(t);
  assert.equal((await DELETE(request({}, null))).status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('bad JSON and bad bodies answer 400 and delete nothing', async (t) => {
  const { keys } = mockServices(t, { identities: [appleIdentity] });
  const invalidJson = await DELETE(request('{nope'));
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: 'Invalid JSON' });

  for (const body of [
    'null',
    '[]',
    { appleAuthorizationCode: '' },
    { appleAuthorizationCode: 42 },
    { appleAuthorizationCode: 'x'.repeat(1025) },
  ]) {
    const response = await DELETE(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request.' });
  }
  assert.deepEqual(keys(), []);
});

test('an account without Apple is deleted with the secret key and no Apple calls', async (t) => {
  useAppleEnv(t);
  const { calls, keys } = mockServices(t, { identities: [googleIdentity] });
  const response = await DELETE(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appleAccessRemains: false });
  assert.deepEqual(keys(), [LOOKUP, REMOVE]);
  assert.equal(new Headers(calls[1].init?.headers).get('apikey'), supabaseEnv.SUPABASE_SECRET_KEY);
});

test('an Apple account with a code is deleted, then its Apple grant revoked', async (t) => {
  useAppleEnv(t);
  const { calls, keys } = mockServices(t, { identities: [googleIdentity, appleIdentity] });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appleAccessRemains: false });
  assert.deepEqual(keys(), [LOOKUP, REMOVE, TOKEN, REVOKE]);
  assert.equal(new URLSearchParams(calls[2].init.body).get('code'), 'code-1');
  assert.equal(new URLSearchParams(calls[3].init.body).get('token'), 'refresh-1');
});

test('an Apple account without a code is deleted and Apple access remains', async (t) => {
  useAppleEnv(t);
  const errors = captureErrors(t);
  const { keys } = mockServices(t, { identities: [appleIdentity] });
  const response = await DELETE(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appleAccessRemains: true });
  assert.deepEqual(keys(), [LOOKUP, REMOVE]);
  assert.equal(errors.mock.callCount(), 0);
});

test('a failed exchange or revoke still deletes, says access remains, and logs no secrets', async (t) => {
  const failures = {
    exchange: { [TOKEN]: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) },
    revoke: { [REVOKE]: () => new Response(null, { status: 503 }) },
  };

  for (const [name, handlers] of Object.entries(failures)) {
    await t.test(name, async (t) => {
      useAppleEnv(t);
      const errors = captureErrors(t);
      const { keys } = mockServices(t, { identities: [appleIdentity], handlers });
      const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleAccessRemains: true });
      assert.deepEqual(keys().slice(0, 2), [LOOKUP, REMOVE]);
      assert.equal(errors.mock.callCount(), 1);
      assert.equal(errors.mock.calls[0].arguments[0], '[account]');
      for (const secret of ['code-1', 'refresh-1', 'apple-user-1']) {
        assert.ok(!logged(errors).includes(secret), `logged ${secret}`);
      }
    });
  }
});

test('a confirmation from a different Apple ID is revoked, and access remains', async (t) => {
  useAppleEnv(t);
  captureErrors(t);
  const { keys } = mockServices(t, {
    identities: [appleIdentity],
    handlers: {
      [TOKEN]: () =>
        Response.json({ refresh_token: 'refresh-2', id_token: appleIdToken('someone-else') }),
    },
  });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.deepEqual(await response.json(), { appleAccessRemains: true });
  assert.deepEqual(keys(), [LOOKUP, REMOVE, TOKEN, REVOKE]);
});

test('an Apple identity without a subject is revoked, and access remains', async (t) => {
  useAppleEnv(t);
  captureErrors(t);
  const { keys } = mockServices(t, {
    identities: [{ provider: 'apple', identity_data: {} }],
  });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appleAccessRemains: true });
  assert.deepEqual(keys(), [LOOKUP, REMOVE, TOKEN, REVOKE]);
});

test('missing Apple settings still delete the account and log the setting', async (t) => {
  useAppleEnv(t, { APPLE_TEAM_ID: '' });
  const errors = captureErrors(t);
  const { keys } = mockServices(t, { identities: [appleIdentity] });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appleAccessRemains: true });
  assert.deepEqual(keys(), [LOOKUP, REMOVE]);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[account]',
    'APPLE_TEAM_ID is required to revoke Apple access.',
  ]);
});

test('a failed deletion returns a generic 500 and never calls Apple', async (t) => {
  useAppleEnv(t);
  captureErrors(t);
  const { keys } = mockServices(t, {
    identities: [appleIdentity],
    handlers: { [REMOVE]: () => Response.json({ msg: 'boom' }, { status: 500 }) },
  });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'Could not delete your account. Try again later.',
  });
  assert.deepEqual(keys(), [LOOKUP, REMOVE]);
});

test('a failed user lookup deletes nothing and returns a generic 500', async (t) => {
  useAppleEnv(t);
  captureErrors(t);
  const { keys } = mockServices(t, {
    handlers: { [LOOKUP]: () => Response.json({ msg: 'boom' }, { status: 500 }) },
  });
  const response = await DELETE(request({ appleAuthorizationCode: 'code-1' }));
  assert.equal(response.status, 500);
  assert.deepEqual(keys(), [LOOKUP]);
});
