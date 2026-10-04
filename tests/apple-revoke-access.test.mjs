import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import test from 'node:test';

import {
  AppleConfigurationError,
  AppleRevocationError,
  revokeAppleAccess,
} from '../apps/api/src/lib/apple/index.ts';
import { appleEnv, appleIdToken, appleKeys } from './support/apple.mjs';

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

function stubApple(
  t,
  {
    token = () =>
      Response.json({ refresh_token: 'refresh-1', id_token: appleIdToken('apple-user-1') }),
    revoke = () => new Response(null, { status: 200 }),
  } = {},
) {
  return t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === TOKEN_URL) return token(init);
    if (url === REVOKE_URL) return revoke(init);
    return new Response(null, { status: 404 });
  });
}

function sent(fetchMock, index) {
  const [input, init] = fetchMock.mock.calls[index].arguments;
  return {
    url: String(input),
    method: init.method,
    signal: init.signal,
    form: Object.fromEntries(new URLSearchParams(init.body)),
  };
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('exchanges the code, revokes the refresh token, and returns the subject', async (t) => {
  const fetchMock = stubApple(t);
  assert.deepEqual(await revokeAppleAccess('code-1', appleEnv), { subject: 'apple-user-1' });
  assert.equal(fetchMock.mock.callCount(), 2);

  const exchange = sent(fetchMock, 0);
  assert.equal(exchange.url, TOKEN_URL);
  assert.equal(exchange.method, 'POST');
  assert.ok(exchange.signal instanceof AbortSignal);
  assert.equal(exchange.form.client_id, 'ai.faraj.nexui');
  assert.equal(exchange.form.code, 'code-1');
  assert.equal(exchange.form.grant_type, 'authorization_code');

  const revoke = sent(fetchMock, 1);
  assert.equal(revoke.url, REVOKE_URL);
  assert.equal(revoke.method, 'POST');
  assert.ok(revoke.signal instanceof AbortSignal);
  assert.equal(revoke.form.client_id, 'ai.faraj.nexui');
  assert.equal(revoke.form.token, 'refresh-1');
  assert.equal(revoke.form.token_type_hint, 'refresh_token');
  assert.equal(revoke.form.client_secret, exchange.form.client_secret);
});

test('the client secret is an ES256 JWT for this team, key and app, valid five minutes', async (t) => {
  const fetchMock = stubApple(t);
  await revokeAppleAccess('code-1', appleEnv);
  const [header, claims, signature] = sent(fetchMock, 0).form.client_secret.split('.');

  assert.deepEqual(decode(header), { alg: 'ES256', kid: 'KEY1234567' });
  const payload = decode(claims);
  assert.equal(payload.iss, 'TEAM123456');
  assert.equal(payload.sub, 'ai.faraj.nexui');
  assert.equal(payload.aud, 'https://appleid.apple.com');
  assert.equal(payload.exp - payload.iat, 300);
  assert.ok(Math.abs(payload.iat - Date.now() / 1000) < 5);
  assert.equal(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: appleKeys.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});

test('a .p8 key written on one line with \\n escapes is accepted', async (t) => {
  stubApple(t);
  const oneLine = appleEnv.APPLE_PRIVATE_KEY.trim().replaceAll('\n', '\\n');
  assert.ok(!oneLine.includes('\n'));
  assert.deepEqual(await revokeAppleAccess('code-1', { ...appleEnv, APPLE_PRIVATE_KEY: oneLine }), {
    subject: 'apple-user-1',
  });
});

test('a missing Apple setting names the variable and calls nobody', async (t) => {
  const fetchMock = stubApple(t);
  for (const name of Object.keys(appleEnv)) {
    await assert.rejects(
      revokeAppleAccess('code-1', { ...appleEnv, [name]: ' ' }),
      (error) => error instanceof AppleConfigurationError && error.message.includes(name),
    );
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('an unreadable key is a configuration error that never echoes the key', async (t) => {
  const fetchMock = stubApple(t);
  await assert.rejects(
    revokeAppleAccess('code-1', { ...appleEnv, APPLE_PRIVATE_KEY: 'not-a-key-secret-text' }),
    (error) =>
      error instanceof AppleConfigurationError &&
      error.message === 'APPLE_PRIVATE_KEY is not a valid .p8 key.',
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('a failed, malformed or timed-out answer is a revocation error', async (t) => {
  const timeout = () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  };
  const cases = {
    'exchange refused': { token: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) },
    'exchange not JSON': { token: () => new Response('<html>') },
    'no refresh token': { token: () => Response.json({ id_token: appleIdToken('apple-user-1') }) },
    'ID token not a JWT': {
      token: () => Response.json({ refresh_token: 'refresh-1', id_token: 'not-a-jwt' }),
    },
    'ID token without sub': {
      token: () => Response.json({ refresh_token: 'refresh-1', id_token: appleIdToken('') }),
    },
    'exchange timed out': { token: timeout },
    'revoke refused': { revoke: () => new Response(null, { status: 500 }) },
    'revoke timed out': { revoke: timeout },
  };

  for (const [name, responders] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      stubApple(t, responders);
      await assert.rejects(revokeAppleAccess('code-1', appleEnv), AppleRevocationError);
    });
  }
});
