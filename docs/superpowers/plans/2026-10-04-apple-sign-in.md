# Sign in with Apple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Sign in with Apple on iOS, and make account deletion revoke Nexui's Apple access (or tell the user how to remove it).

**Architecture:** The mobile app mirrors Google: a native adapter (`apple-sign-in.ts`) returns an Apple credential, and `createAuthActions` exchanges its ID token with Supabase and saves the name best-effort. Deleting an Apple account on iOS asks Apple for an authorization code; `DELETE /api/account` deletes the user first, then exchanges that code with Apple and revokes the refresh token, signing Apple's client secret per request with the `.p8` key. The answer `{ appleAccessRemains }` drives a notice on the sign-in screen.

**Tech Stack:** Expo SDK 57 (`expo-apple-authentication`, `expo-crypto`), Supabase Auth (`signInWithIdToken`, admin API), Next.js 16 route handlers, Zod 4 contracts in `@nexui/types`, Node's `crypto` for ES256, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-apple-sign-in-design.md`

### Path mapping

The spec predates the mobile folder reshuffle (PRs #19–#24). Its paths map to:

| Spec path                                         | Path now                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/mobile/src/lib/apple-sign-in.ts`            | `apps/mobile/src/features/auth/apple-sign-in.ts`                    |
| `apps/mobile/src/lib/auth-actions.ts`, `auth.ts`  | `apps/mobile/src/features/auth/…`                                   |
| `apps/mobile/src/stores/use-auth-notice-store.ts` | `apps/mobile/src/features/auth/use-auth-notice-store.ts`            |
| `apps/mobile/src/lib/api.ts`                      | `apps/mobile/src/data/api.ts`                                       |
| `apps/api/src/lib/account/`, `src/lib/apple/`     | same, each with an `index.ts` barrel (`#lib/account`, `#lib/apple`) |

Routes import features through `#features/auth`; a new name another folder needs goes in that barrel.

## Global Constraints

- iOS only for Apple: web keeps email codes, Android keeps Google and email. No Apple on web or Android.
- No new dependency in `apps/api`; ES256 uses `crypto.sign('sha256', …, { key, dsaEncoding: 'ieee-p1363' })`.
- Mobile dependencies are added with `npx expo install expo-apple-authentication expo-crypto` so SDK 57 versions are pinned.
- Nothing about Apple is stored: no refresh tokens, no codes, no subjects in the database or logs.
- Logs are `console.error('[account]', message)` with an error class's message or a generic one; never the code, a token, the subject or a provider error.
- `DELETE /api/account` always takes a JSON body (`{}` without a code) and answers `200 { appleAccessRemains }` instead of `204`.
- `deleteAccountRequestSchema`: `appleAuthorizationCode: z.string().min(1).max(1024).optional()`. `deleteAccountResponseSchema`: `appleAccessRemains: z.boolean()`.
- Apple env: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PEM; literal `\n` become newlines), `APPLE_CLIENT_ID`. Server only.
- Client secret: header `{ alg: 'ES256', kid: APPLE_KEY_ID }`; claims `iss` = team ID, `sub` = client ID, `aud` = `https://appleid.apple.com`, `exp` = `iat` + 300.
- Apple calls: POST form to `https://appleid.apple.com/auth/token` (`client_id`, `client_secret`, `code`, `grant_type=authorization_code`) then `https://appleid.apple.com/auth/revoke` (`client_id`, `client_secret`, `token`, `token_type_hint=refresh_token`), each with `AbortSignal.timeout(5000)`.
- Mobile `deleteAccount` timeout: 20 s.
- Copy, verbatim:
  - Adapter: `'Apple sign-in needs the iOS app.'`, `'Apple did not return an ID token.'`, `'Apple sign-in failed. Try again.'`
  - Deletion code: `'Apple did not confirm. Try again.'`
  - Route: 400 `'Invalid JSON'`, 400 `'Invalid request.'`, 500 `'Could not delete your account. Try again later.'`
  - Subtitles: iOS `'Use Apple or Google, or get a one-time code by email.'`; Android `'Use Google, or get a one-time code by email.'`; web `'Get a one-time code by email.'`
  - Danger card (iOS, Apple account): `You’ll confirm with Apple so Nexui’s access to your Apple ID is removed too.`
- Apple button: `AppleAuthenticationButton`, type `CONTINUE`, above Google, full width, 52 pt high, `BLACK` when `useScheme()` is light and `WHITE` when dark; while anything is pending, its wrapper dims and ignores touches.
- An account "uses Apple" when `session.user.app_metadata.providers` includes `'apple'`.
- Repo style (root `AGENTS.md`): braces on every `if`, blank line before `return` and after blocks, explicit types on exported functions, `.ts` extensions on relative API imports, barrels hold only re-exports.

## Review Focus

1. **An `APPLE_PRIVATE_KEY` that is set but unreadable** (pasted wrong, truncated): deletion still answers `200 { appleAccessRemains: true }` and logs a configuration message, not a crypto stack or key text. Pinned in Task 2.
2. **Apple answers 200 with a body that isn't what we expect** (not JSON, no `refresh_token`, an `id_token` that isn't a JWT): a revocation error, never a `TypeError` that escapes as a 500 after the user is gone. Pinned in Task 2.
3. **Apple's sheet returns blank name parts** (`''` or spaces): treated as no name, so `full_name` is never saved as an empty string. Pinned in Task 4.
4. **The user lookup before deletion fails:** a 500 and nothing deleted, no Apple call. Pinned in Task 3.
5. **An Apple identity row without `identity_data.sub`:** the confirmation grant is still revoked, and the answer says access remains (it can't be shown to match). Pinned in Task 3.

---

### Task 1: Account deletion contracts

**Files:**

- Modify: `packages/types/src/auth.ts` (append)
- Test: `tests/auth-contract.test.mjs`

**Interfaces:**

- Produces: `deleteAccountRequestSchema`, `DeleteAccountRequest` (`{ appleAuthorizationCode?: string }`), `deleteAccountResponseSchema`, `DeleteAccountResponse` (`{ appleAccessRemains: boolean }`), exported from `@nexui/types`.

- [ ] **Step 1: Write the failing tests**

Add to the import list in `tests/auth-contract.test.mjs`: `deleteAccountRequestSchema, deleteAccountResponseSchema`, then append:

```js
test('account deletion takes an optional Apple code of 1 to 1024 characters', () => {
  assert.deepEqual(deleteAccountRequestSchema.parse({}), {});
  assert.deepEqual(deleteAccountRequestSchema.parse({ appleAuthorizationCode: 'c.1' }), {
    appleAuthorizationCode: 'c.1',
  });
  for (const appleAuthorizationCode of ['', 'x'.repeat(1025), 42, null]) {
    assert.equal(deleteAccountRequestSchema.safeParse({ appleAuthorizationCode }).success, false);
  }
});

test('account deletion answers whether Apple access remains', () => {
  assert.deepEqual(deleteAccountResponseSchema.parse({ appleAccessRemains: true }), {
    appleAccessRemains: true,
  });
  assert.equal(deleteAccountResponseSchema.safeParse({}).success, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/auth-contract.test.mjs`
Expected: FAIL — `deleteAccountRequestSchema` is undefined.

- [ ] **Step 3: Add the schemas**

Append to `packages/types/src/auth.ts`:

```ts
// DELETE /api/account. An Apple user on iOS confirms with Apple first, and the API uses that
// code to revoke Nexui's Apple access once the account is deleted.
export const deleteAccountRequestSchema = z.object({
  appleAuthorizationCode: z.string().min(1).max(1024).optional(),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

// True when the account signed in with Apple and Nexui couldn't revoke that access, so the user
// removes Nexui under Sign in with Apple themselves.
export const deleteAccountResponseSchema = z.object({
  appleAccessRemains: z.boolean(),
});

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/auth-contract.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/auth.ts tests/auth-contract.test.mjs
git commit -m "Add the account deletion contracts for Apple revocation"
```

---

### Task 2: Revoke Apple access from the API

**Files:**

- Create: `apps/api/src/lib/apple/revoke-access.ts`, `apps/api/src/lib/apple/index.ts`
- Create: `tests/support/apple.mjs`, `tests/apple-revoke-access.test.mjs`

**Interfaces:**

- Produces: `revokeAppleAccess(authorizationCode: string, env?: Env): Promise<{ subject: string }>`, `AppleConfigurationError`, `AppleRevocationError`, all from `#lib/apple`.
- Produces (tests): `appleEnv`, `appleKeys`, `appleIdToken(sub)`, `useAppleEnv(t, overrides?)` from `tests/support/apple.mjs`.

- [ ] **Step 1: Write the test support**

`tests/support/apple.mjs`:

```js
import { generateKeyPairSync } from 'node:crypto';

// A local P-256 key stands in for the Sign in with Apple .p8 key.
export const appleKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

export const appleEnv = {
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  APPLE_CLIENT_ID: 'ai.faraj.nexui',
  APPLE_PRIVATE_KEY: appleKeys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
};

/** An unsigned stand-in for the ID token Apple returns from /auth/token. */
export function appleIdToken(sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', kid: 'apple' })}.${encode({
    iss: 'https://appleid.apple.com',
    aud: appleEnv.APPLE_CLIENT_ID,
    sub,
  })}.signature`;
}

/** Sets the APPLE_* env vars for one test, restoring them afterwards. */
export function useAppleEnv(t, overrides = {}) {
  for (const [key, value] of Object.entries({ ...appleEnv, ...overrides })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/apple-revoke-access.test.mjs`:

```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tests/apple-revoke-access.test.mjs`
Expected: FAIL — cannot find module `apps/api/src/lib/apple/index.ts`.

- [ ] **Step 4: Write the implementation**

`apps/api/src/lib/apple/revoke-access.ts`:

```ts
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

import { z } from 'zod';

type Env = Record<string, string | undefined>;

/** A Sign in with Apple setting is missing or unusable. The message names it and is safe to log. */
export class AppleConfigurationError extends Error {}

/** A call to Apple failed. The message names the step and is safe to log. */
export class AppleRevocationError extends Error {}

interface AppleConfig {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: KeyObject;
}

const APPLE_ID_URL = 'https://appleid.apple.com';
const CALL_TIMEOUT_MS = 5_000;
const SECRET_LIFETIME_S = 300;
const EXCHANGE_FAILED = 'Apple did not exchange the authorization code.';
const REVOKE_FAILED = 'Apple did not revoke the token.';

const tokenResponseSchema = z.object({
  refresh_token: z.string().min(1),
  id_token: z.string().min(1),
});
const idTokenClaimsSchema = z.object({ sub: z.string().min(1) });

function required(env: Env, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new AppleConfigurationError(`${name} is required to revoke Apple access.`);
  }

  return value;
}

function readAppleConfig(env: Env): AppleConfig {
  const teamId = required(env, 'APPLE_TEAM_ID');
  const keyId = required(env, 'APPLE_KEY_ID');
  const pem = required(env, 'APPLE_PRIVATE_KEY');
  const clientId = required(env, 'APPLE_CLIENT_ID');

  try {
    // A one-line env value carries the .p8 file's line breaks as literal `\n`.
    const privateKey = createPrivateKey(pem.replaceAll('\\n', '\n'));

    return { teamId, keyId, clientId, privateKey };
  } catch {
    throw new AppleConfigurationError('APPLE_PRIVATE_KEY is not a valid .p8 key.');
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Apple's client secret: an ES256 JWT signed with the Sign in with Apple key, valid 5 minutes. */
function signClientSecret(config: AppleConfig): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'ES256', kid: config.keyId });
  const claims = encodeJson({
    iss: config.teamId,
    iat,
    exp: iat + SECRET_LIFETIME_S,
    aud: APPLE_ID_URL,
    sub: config.clientId,
  });
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${header}.${claims}.${signature.toString('base64url')}`;
}

async function postForm(
  path: string,
  fields: Record<string, string>,
  failure: string,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(`${APPLE_ID_URL}${path}`, {
      method: 'POST',
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new AppleRevocationError(failure);
  }

  if (!response.ok) {
    throw new AppleRevocationError(failure);
  }

  return response;
}

// The token came straight from Apple over TLS in answer to our request, so it is decoded, not
// verified.
function subjectOf(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1] ?? '';
    const claims = idTokenClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );

    return claims.success ? claims.data.sub : null;
  } catch {
    return null;
  }
}

/**
 * Revokes Nexui's access to the Apple ID that confirmed with `authorizationCode`: exchanges the
 * code for a refresh token, then revokes that token. Returns the grant's Apple user ID, which the
 * caller compares with the account's Apple identity.
 *
 * @example
 * const { subject } = await revokeAppleAccess(code);
 */
export async function revokeAppleAccess(
  authorizationCode: string,
  env: Env = process.env,
): Promise<{ subject: string }> {
  const config = readAppleConfig(env);
  const clientSecret = signClientSecret(config);
  const exchanged = await postForm(
    '/auth/token',
    {
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    },
    EXCHANGE_FAILED,
  );
  const tokens = tokenResponseSchema.safeParse(await exchanged.json().catch(() => null));
  const subject = tokens.success ? subjectOf(tokens.data.id_token) : null;

  if (!tokens.success || subject === null) {
    throw new AppleRevocationError(EXCHANGE_FAILED);
  }

  await postForm(
    '/auth/revoke',
    {
      client_id: config.clientId,
      client_secret: clientSecret,
      token: tokens.data.refresh_token,
      token_type_hint: 'refresh_token',
    },
    REVOKE_FAILED,
  );

  return { subject };
}
```

`apps/api/src/lib/apple/index.ts`:

```ts
export {
  AppleConfigurationError,
  AppleRevocationError,
  revokeAppleAccess,
} from './revoke-access.ts';
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/apple-revoke-access.test.mjs`
Expected: PASS (6 tests, 8 subtests).

- [ ] **Step 6: Lint and typecheck the API**

Run: `pnpm --filter @nexui/api lint && pnpm --filter @nexui/api typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/apple tests/support/apple.mjs tests/apple-revoke-access.test.mjs
git commit -m "Revoke Apple access with a per-request client secret"
```

---

### Task 3: Delete the account, then revoke Apple access

**Files:**

- Create: `apps/api/src/lib/account/delete-account.ts`, `apps/api/src/lib/account/index.ts`
- Modify: `apps/api/src/app/api/account/route.ts`
- Modify: `apps/api/.env.example`
- Test: `tests/account-route.test.mjs` (rewrite)

**Interfaces:**

- Consumes: `revokeAppleAccess`, `AppleConfigurationError`, `AppleRevocationError` (Task 2); `deleteAccountRequestSchema`, `deleteAccountResponseSchema`, `DeleteAccountResponse` (Task 1); `getAdminClient`, `SupabaseConfigurationError`, `verifyRequest` from `#lib/supabase`; `appleIdToken`, `useAppleEnv` from `tests/support/apple.mjs`.
- Produces: `deleteAccount(userId: string, appleAuthorizationCode: string | undefined, env?: Env): Promise<DeleteAccountResponse>` from `#lib/account`. `DELETE /api/account` with a JSON body answering `200 { appleAccessRemains }`.

- [ ] **Step 1: Rewrite the route tests**

`tests/account-route.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/account-route.test.mjs`
Expected: FAIL — the route answers 204 and never looks the user up.

- [ ] **Step 3: Write `deleteAccount`**

`apps/api/src/lib/account/delete-account.ts`:

```ts
import type { DeleteAccountResponse } from '@nexui/types';

import { AppleConfigurationError, AppleRevocationError, revokeAppleAccess } from '#lib/apple';
import { getAdminClient } from '#lib/supabase';

type Env = Record<string, string | undefined>;

/**
 * Deletes a user, then revokes Nexui's Apple access when the account signed in with Apple.
 * Apple is only called once the account is gone (TN3194). `appleAccessRemains` tells the app to
 * show the user how to remove Nexui under Sign in with Apple themselves.
 *
 * @example
 * const { appleAccessRemains } = await deleteAccount(user.userId, body.appleAuthorizationCode);
 */
export async function deleteAccount(
  userId: string,
  appleAuthorizationCode: string | undefined,
  env: Env = process.env,
): Promise<DeleteAccountResponse> {
  const admin = getAdminClient(env);
  const { data, error: lookupError } = await admin.auth.admin.getUserById(userId);

  if (lookupError) {
    throw lookupError;
  }

  const appleIdentity = data.user.identities?.find((identity) => identity.provider === 'apple');
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (deleteError) {
    throw deleteError;
  }

  if (!appleIdentity) {
    return { appleAccessRemains: false };
  }

  // Web and Android can't confirm with Apple, so they send no code.
  if (!appleAuthorizationCode) {
    return { appleAccessRemains: true };
  }

  const appleUserId: unknown = appleIdentity.identity_data?.sub;
  const revoked = await revokeOwnGrant(appleUserId, appleAuthorizationCode, env);

  return { appleAccessRemains: !revoked };
}

/**
 * True when Apple revoked a grant for the account's own Apple ID. A confirmation from another
 * Apple ID is still revoked, since it was created just now, but leaves the account's grant.
 */
async function revokeOwnGrant(
  appleUserId: unknown,
  authorizationCode: string,
  env: Env,
): Promise<boolean> {
  try {
    const { subject } = await revokeAppleAccess(authorizationCode, env);

    if (subject !== appleUserId) {
      console.error('[account]', 'Apple confirmed with a different Apple ID.');

      return false;
    }

    return true;
  } catch (error) {
    const known = error instanceof AppleConfigurationError || error instanceof AppleRevocationError;

    console.error('[account]', known ? error.message : 'Apple access revocation failed.');

    return false;
  }
}
```

`apps/api/src/lib/account/index.ts`:

```ts
export { deleteAccount } from './delete-account.ts';
```

- [ ] **Step 4: Update the route**

`apps/api/src/app/api/account/route.ts`:

```ts
import { deleteAccountRequestSchema, deleteAccountResponseSchema } from '@nexui/types';

import { deleteAccount } from '#lib/account';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import { SupabaseConfigurationError, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['DELETE'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Permanently deletes the signed-in user's account (required by App Store rules). An Apple user
// on iOS sends Apple's authorization code so Nexui's Apple access is revoked too.
export async function DELETE(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = deleteAccountRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError('Invalid request.', 400, headers);
  }

  try {
    const result = await deleteAccount(user.userId, parsed.data.appleAuthorizationCode);

    return Response.json(deleteAccountResponseSchema.parse(result), { headers });
  } catch (error) {
    console.error(
      '[account]',
      error instanceof SupabaseConfigurationError ? error.message : 'Account deletion failed.',
    );

    return jsonError('Could not delete your account. Try again later.', 500, headers);
  }
}
```

- [ ] **Step 5: Document the env**

In `apps/api/.env.example`, after the `SUPABASE_SECRET_KEY=` line, add:

```dotenv

# Sign in with Apple (Apple Developer → Keys) — server only; used to revoke an Apple user's
# access when they delete their account. Never expose to the mobile app.
APPLE_TEAM_ID=
APPLE_KEY_ID=
# The .p8 file's text. On one line, write its line breaks as \n.
APPLE_PRIVATE_KEY=
# The iOS bundle ID: ai.faraj.nexui
APPLE_CLIENT_ID=
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --test tests/account-route.test.mjs tests/apple-revoke-access.test.mjs`
Expected: PASS.

- [ ] **Step 7: Lint and typecheck the API**

Run: `pnpm --filter @nexui/api lint && pnpm --filter @nexui/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/account apps/api/src/app/api/account/route.ts apps/api/.env.example tests/account-route.test.mjs
git commit -m "Revoke Apple access after deleting an account"
```

---

### Task 4: Apple auth actions

**Files:**

- Modify: `apps/mobile/src/features/auth/auth-actions.ts`
- Test: `tests/mobile-auth.test.mjs`

**Interfaces:**

- Produces: `AppleCredential` (`{ idToken: string; nonce: string; givenName: string | null; familyName: string | null; authorizationCode: string | null }`), `AppleAuth` (`{ getCredential(): Promise<AppleCredential | null> }`), `createAuthActions(auth, google, apple)`, and on `AuthActions`: `signInWithApple(): Promise<boolean>`, `getAppleDeletionCode(): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

In `tests/mobile-auth.test.mjs`, replace `setup` and add a credential helper:

```js
function appleCredential(overrides = {}) {
  return {
    idToken: 'apple-id-token',
    nonce: 'raw-nonce',
    givenName: null,
    familyName: null,
    authorizationCode: 'apple-code',
    ...overrides,
  };
}

function setup(t, overrides = {}) {
  const auth = {
    signInWithOtp: t.mock.fn(async () => ({ data: {}, error: null })),
    verifyOtp: t.mock.fn(async () => ({ data: {}, error: null })),
    signInWithIdToken: t.mock.fn(async () => ({ data: {}, error: null })),
    signOut: t.mock.fn(async () => ({ error: null })),
    updateUser: t.mock.fn(async () => ({ data: {}, error: null })),
    ...overrides,
  };
  const google = {
    getIdToken: t.mock.fn(async () => 'google-id-token'),
    signOut: t.mock.fn(async () => {}),
  };
  const apple = { getCredential: t.mock.fn(async () => appleCredential()) };
  return { auth, google, apple, actions: createAuthActions(auth, google, apple) };
}
```

Append:

```js
test('Apple cancellation exchanges nothing', async (t) => {
  const { actions, auth, apple } = setup(t);
  apple.getCredential.mock.mockImplementation(async () => null);
  assert.equal(await actions.signInWithApple(), false);
  assert.equal(auth.signInWithIdToken.mock.callCount(), 0);
  assert.equal(auth.updateUser.mock.callCount(), 0);
});

test('Apple sign-in exchanges the ID token with the raw nonce', async (t) => {
  const { actions, auth } = setup(t);
  assert.equal(await actions.signInWithApple(), true);
  assert.deepEqual(auth.signInWithIdToken.mock.calls[0].arguments, [
    { provider: 'apple', token: 'apple-id-token', nonce: 'raw-nonce' },
  ]);
});

test('Apple’s first sign-in saves the name to user metadata', async (t) => {
  const { actions, auth, apple } = setup(t);
  apple.getCredential.mock.mockImplementation(async () =>
    appleCredential({ givenName: 'Ada', familyName: 'Lovelace' }),
  );
  assert.equal(await actions.signInWithApple(), true);
  assert.deepEqual(auth.updateUser.mock.calls[0].arguments, [
    { data: { full_name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace' } },
  ]);
});

test('a given name alone still sets the full name', async (t) => {
  const { actions, auth, apple } = setup(t);
  apple.getCredential.mock.mockImplementation(async () => appleCredential({ givenName: 'Ada' }));
  await actions.signInWithApple();
  assert.deepEqual(auth.updateUser.mock.calls[0].arguments, [
    { data: { full_name: 'Ada', given_name: 'Ada' } },
  ]);
});

test('no name, or a blank one, saves nothing', async (t) => {
  const { actions, auth, apple } = setup(t);
  await actions.signInWithApple();
  apple.getCredential.mock.mockImplementation(async () =>
    appleCredential({ givenName: '  ', familyName: '' }),
  );
  await actions.signInWithApple();
  assert.equal(auth.signInWithIdToken.mock.callCount(), 2);
  assert.equal(auth.updateUser.mock.callCount(), 0);
});

test('a failing or throwing name update still signs in', async (t) => {
  const named = async () => appleCredential({ givenName: 'Ada', familyName: 'Lovelace' });
  for (const updateUser of [
    async () => ({ data: {}, error: new Error('metadata failed') }),
    async () => {
      throw new Error('offline');
    },
  ]) {
    const { actions, apple } = setup(t, { updateUser });
    apple.getCredential.mock.mockImplementation(named);
    assert.equal(await actions.signInWithApple(), true);
  }
});

test('Apple exchange errors become the generic message and save no name', async (t) => {
  const { actions, auth, apple } = setup(t, {
    signInWithIdToken: async () => ({ error: new Error('provider internals') }),
  });
  apple.getCredential.mock.mockImplementation(async () => appleCredential({ givenName: 'Ada' }));
  await assert.rejects(actions.signInWithApple, { message: 'Apple sign-in failed. Try again.' });
  assert.equal(auth.updateUser.mock.callCount(), 0);
});

test('the deletion confirmation returns Apple’s code, or null when cancelled', async (t) => {
  const { actions, auth, apple } = setup(t);
  assert.equal(await actions.getAppleDeletionCode(), 'apple-code');
  apple.getCredential.mock.mockImplementation(async () => null);
  assert.equal(await actions.getAppleDeletionCode(), null);
  apple.getCredential.mock.mockImplementation(async () =>
    appleCredential({ authorizationCode: null }),
  );
  await assert.rejects(actions.getAppleDeletionCode, {
    message: 'Apple did not confirm. Try again.',
  });
  assert.equal(auth.signInWithIdToken.mock.callCount(), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/mobile-auth.test.mjs`
Expected: FAIL — `actions.signInWithApple is not a function`.

- [ ] **Step 3: Implement the actions**

In `apps/mobile/src/features/auth/auth-actions.ts`:

1. Add `'updateUser'` to the `AuthClient` `Pick`.
2. After `GoogleAuth`, add:

```ts
/** What Apple's sheet returns. `nonce` is the raw nonce; the sheet was given its SHA-256 hash. */
export interface AppleCredential {
  idToken: string;
  nonce: string;
  givenName: string | null;
  familyName: string | null;
  authorizationCode: string | null;
}

export interface AppleAuth {
  getCredential(): Promise<AppleCredential | null>;
}
```

3. Add to `AuthActions`: `signInWithApple(): Promise<boolean>;` and `getAppleDeletionCode(): Promise<string | null>;`.
4. Add above `createAuthActions`:

```ts
/**
 * Apple's name parts as user metadata, or null when Apple sent none (it only sends a name on the
 * first authorization).
 *
 * @example
 * appleNameMetadata('Ada', null) // { full_name: 'Ada', given_name: 'Ada' }
 */
function appleNameMetadata(
  givenName: string | null,
  familyName: string | null,
): Record<string, string> | null {
  const given = givenName?.trim() ?? '';
  const family = familyName?.trim() ?? '';
  const fullName = [given, family].filter(Boolean).join(' ');

  if (!fullName) {
    return null;
  }

  const data: Record<string, string> = { full_name: fullName };

  if (given) {
    data.given_name = given;
  }

  if (family) {
    data.family_name = family;
  }

  return data;
}
```

5. Change the signature and doc comment to `/** Binds auth operations to Supabase and the native Google and Apple adapters. */ export function createAuthActions(auth: AuthClient, google: GoogleAuth, apple: AppleAuth): AuthActions {`.
6. After `signInWithGoogle`, add:

```ts
/** Returns false when Apple's sheet was cancelled. Saves the name best-effort. */
async function signInWithApple(): Promise<boolean> {
  const credential = await apple.getCredential();

  if (credential === null) {
    return false;
  }

  try {
    const { error } = await auth.signInWithIdToken({
      provider: 'apple',
      token: credential.idToken,
      nonce: credential.nonce,
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    throw new AuthActionError(authMessage(error, 'Apple sign-in failed. Try again.'));
  }

  await saveAppleName(credential);

  return true;
}

// The name is a nicety and sign-in has already succeeded, so a failure here is ignored.
async function saveAppleName({ givenName, familyName }: AppleCredential): Promise<void> {
  const data = appleNameMetadata(givenName, familyName);

  if (data === null) {
    return;
  }

  try {
    await auth.updateUser({ data });
  } catch {
    // Best-effort, like a returned error.
  }
}

/** Asks Apple to confirm an Apple account's deletion. Null when the sheet was cancelled. */
async function getAppleDeletionCode(): Promise<string | null> {
  const credential = await apple.getCredential();

  if (credential === null) {
    return null;
  }

  if (!credential.authorizationCode) {
    throw new AuthActionError('Apple did not confirm. Try again.');
  }

  return credential.authorizationCode;
}
```

7. Return them: `return { sendEmailCode, verifyEmailCode, signInWithGoogle, signInWithApple, getAppleDeletionCode, signOut, clearDeletedAccount };`

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/mobile-auth.test.mjs`
Expected: PASS (21 tests). `auth.ts` fails typecheck until Task 5 wires the adapter; that is expected here.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/auth/auth-actions.ts tests/mobile-auth.test.mjs
git commit -m "Add Apple sign-in and deletion confirmation to the auth actions"
```

---

### Task 5: The native Apple adapter and app config

**Files:**

- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml` (via `npx expo install`)
- Create: `apps/mobile/src/features/auth/apple-sign-in.ts`
- Modify: `apps/mobile/src/features/auth/auth.ts`, `apps/mobile/src/features/auth/index.ts`
- Modify: `apps/mobile/app.config.ts`

**Interfaces:**

- Consumes: `AppleCredential`, `AuthActionError`, `createAuthActions(auth, google, apple)` (Task 4).
- Produces: `getAppleCredential(): Promise<AppleCredential | null>`; `signInWithApple` and `getAppleDeletionCode` exported from `#features/auth`.

- [ ] **Step 1: Install the Expo modules**

Run (from `apps/mobile`): `npx expo install expo-apple-authentication expo-crypto`
Expected: both added to `dependencies` with `~57.x` ranges, lockfile updated.

- [ ] **Step 2: Write the adapter**

`apps/mobile/src/features/auth/apple-sign-in.ts`:

```ts
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { AuthActionError, type AppleCredential } from './auth-actions';

function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  );
}

function namePart(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Opens Apple's sign-in sheet, asking for the name and email. Cancellation returns null, not an
 * error. Apple sees the nonce's SHA-256 hash; Supabase gets the raw nonce and compares hashes.
 */
export async function getAppleCredential(): Promise<AppleCredential | null> {
  if (Platform.OS !== 'ios') {
    throw new AuthActionError('Apple sign-in needs the iOS app.');
  }

  try {
    const nonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      throw new AuthActionError('Apple did not return an ID token.');
    }

    return {
      idToken: credential.identityToken,
      nonce,
      givenName: namePart(credential.fullName?.givenName),
      familyName: namePart(credential.fullName?.familyName),
      authorizationCode: credential.authorizationCode,
    };
  } catch (error) {
    if (error instanceof AuthActionError) {
      throw error;
    }

    if (isCancelled(error)) {
      return null;
    }

    throw new AuthActionError('Apple sign-in failed. Try again.');
  }
}
```

- [ ] **Step 3: Wire it in**

`apps/mobile/src/features/auth/auth.ts`:

```ts
import { supabase } from '#data';

import { getAppleCredential } from './apple-sign-in';
import { createAuthActions } from './auth-actions';
import { forgetGoogleAccount, getGoogleIdToken } from './google-sign-in';

export const {
  sendEmailCode,
  verifyEmailCode,
  signInWithGoogle,
  signInWithApple,
  getAppleDeletionCode,
  signOut,
  clearDeletedAccount,
} = createAuthActions(
  supabase.auth,
  { getIdToken: getGoogleIdToken, signOut: forgetGoogleAccount },
  { getCredential: getAppleCredential },
);
```

In `apps/mobile/src/features/auth/index.ts`, extend the `./auth` export to:

```ts
export {
  clearDeletedAccount,
  getAppleDeletionCode,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
} from './auth';
```

- [ ] **Step 4: Configure the app**

In `apps/mobile/app.config.ts`:

- Change the identifiers comment to `// Permanent store identifiers (see "Identifiers" in docs/specs/auth.md). Don't change after release.`
- `ios: { bundleIdentifier: appId, usesAppleSignIn: true },`
- Add `'expo-apple-authentication',` to `plugins` after `'expo-secure-store',`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && node --test tests/mobile-auth.test.mjs && pnpm --filter @nexui/mobile build`
Expected: no errors; the web export succeeds with the Apple module imported (it is only called on iOS).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/app.config.ts apps/mobile/src/features/auth
git commit -m "Add the native Apple sign-in adapter and capability"
```

---

### Task 6: Apple on the sign-in screen, and the Apple access notice

**Files:**

- Create: `apps/mobile/src/features/auth/use-auth-notice-store.ts`
- Create: `apps/mobile/src/features/auth/apple-access-notice.tsx`
- Modify: `apps/mobile/src/features/auth/index.ts`
- Modify: `apps/mobile/src/app/(auth)/sign-in.tsx`

**Interfaces:**

- Consumes: `signInWithApple` (Task 5), `useScheme` from `#theme`, `Button` from `#ui`.
- Produces: `showAppleAccessNotice(): void`, `dismissAppleAccessNotice(): void`, `useAuthNoticeStore`, `AppleAccessNotice` from `#features/auth`.

- [ ] **Step 1: Write the notice store**

`apps/mobile/src/features/auth/use-auth-notice-store.ts`:

```ts
import { create } from 'zustand';

interface AuthNoticeState {
  /** An account was deleted, but Nexui couldn't remove its Sign in with Apple access. */
  appleAccessRemains: boolean;
}

// Outlives the session on purpose: the Account screen sets it before the session clears, and the
// sign-in screen shows it however the session ended.
export const useAuthNoticeStore = create<AuthNoticeState>(() => ({ appleAccessRemains: false }));

export function showAppleAccessNotice(): void {
  useAuthNoticeStore.setState({ appleAccessRemains: true });
}

export function dismissAppleAccessNotice(): void {
  useAuthNoticeStore.setState({ appleAccessRemains: false });
}
```

- [ ] **Step 2: Write the notice**

`apps/mobile/src/features/auth/apple-access-notice.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

import { dismissAppleAccessNotice, useAuthNoticeStore } from './use-auth-notice-store';

/** After deleting an account whose Apple access Nexui couldn't revoke: how to finish. */
export function AppleAccessNotice(): ReactElement | null {
  const styles = useStyles();
  const visible = useAuthNoticeStore((state) => state.appleAccessRemains);

  if (!visible) {
    return null;
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.title}>Your account is deleted</Text>
      <Text style={styles.text}>
        To finish, remove Nexui under Sign in with Apple in your Apple Account settings, on an Apple
        device or at account.apple.com.
      </Text>
      <Button
        variant="text"
        label="Dismiss"
        onPress={dismissAppleAccessNotice}
        style={styles.dismiss}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  notice: { padding: 16, borderRadius: 16, backgroundColor: colors.card, marginBottom: 24 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 6 },
  dismiss: { alignSelf: 'flex-start', marginTop: 4 },
}));
```

Add to `apps/mobile/src/features/auth/index.ts`:

```ts
export { AppleAccessNotice } from './apple-access-notice';
export {
  dismissAppleAccessNotice,
  showAppleAccessNotice,
  useAuthNoticeStore,
} from './use-auth-notice-store';
```

- [ ] **Step 3: Update the sign-in screen**

In `apps/mobile/src/app/(auth)/sign-in.tsx`:

- Imports: add
  `import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from 'expo-apple-authentication';`, `useScheme` from `#theme`, and `AppleAccessNotice`, `dismissAppleAccessNotice`, `signInWithApple` from `#features/auth`.
- `type Pending = 'email' | 'google' | 'apple' | null;`
- Above the component:

```ts
// Web shows only email codes; Apple sign-in is iOS only.
const SUBTITLE = Platform.select({
  ios: 'Use Apple or Google, or get a one-time code by email.',
  web: 'Get a one-time code by email.',
  default: 'Use Google, or get a one-time code by email.',
});
```

- In the component: `const scheme = useScheme();`.
- Call `dismissAppleAccessNotice();` right after the `pending !== null` guard in `submitEmail` and `continueWithGoogle`.
- Add after `continueWithGoogle`:

```ts
async function continueWithApple() {
  if (pending !== null) {
    return;
  }

  dismissAppleAccessNotice();
  setPending('apple');
  setError(null);
  try {
    await signInWithApple();
  } catch (caught) {
    setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
  } finally {
    setPending(null);
  }
}
```

- Render: `<AuthScreen title="Sign in" subtitle={SUBTITLE}>`, then `<AppleAccessNotice />` first, and inside `styles.providers` before `GoogleSigninButton`:

```tsx
{
  Platform.OS === 'ios' ? (
    // The Apple button has no disabled state, so its wrapper dims it and takes no touches.
    <View style={pending !== null && styles.inactive}>
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={
          scheme === 'dark'
            ? AppleAuthenticationButtonStyle.WHITE
            : AppleAuthenticationButtonStyle.BLACK
        }
        style={styles.providerButton}
        onPress={() => void continueWithApple()}
      />
    </View>
  ) : null;
}
```

- Style: `inactive: { opacity: 0.6, pointerEvents: 'none' },`

- [ ] **Step 4: Verify**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && pnpm --filter @nexui/mobile build`
Expected: no errors.

Smoke-test web (Metro doesn't hot-reload in a worktree; restart after edits): run the API on 3010 and `EXPO_PUBLIC_API_URL=http://localhost:3010 npx expo start --web --port 8091 --clear` in `apps/mobile`; the signed-out screen shows "Get a one-time code by email." and no provider buttons. The notice itself is device check 8, after the manual steps.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/auth "apps/mobile/src/app/(auth)/sign-in.tsx"
git commit -m "Show Sign in with Apple on iOS and the Apple access notice"
```

---

### Task 7: Confirm with Apple when deleting an account

**Files:**

- Modify: `apps/mobile/src/data/api.ts`
- Modify: `apps/mobile/src/app/(app)/account.tsx`

**Interfaces:**

- Consumes: `deleteAccountRequestSchema` types and `deleteAccountResponseSchema` (Task 1); `getAppleDeletionCode`, `showAppleAccessNotice`, `AuthActionError`, `clearDeletedAccount` from `#features/auth`.
- Produces: `deleteAccount(appleAuthorizationCode?: string): Promise<DeleteAccountResponse>` from `#data`.

- [ ] **Step 1: Send the body and parse the answer**

In `apps/mobile/src/data/api.ts`:

- Import `deleteAccountResponseSchema`, `type DeleteAccountRequest`, `type DeleteAccountResponse` from `@nexui/types`.
- Give `callApi` a timeout:

```ts
function callApi<T>(
  path: string,
  parser: Parser<T>,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  return requestJson(
    (url, request) => fetchWithSession(supabase.auth, url, request),
    `${apiUrl}${path}`,
    init,
    parser,
    timeoutMs,
  );
}
```

- Replace the old `deleteAccount` (and its comment) with, placed after `postJson`:

```ts
/**
 * Permanently deletes the signed-in user's account. Pass Apple's authorization code to revoke
 * Nexui's Apple access too. Allows 20 s: the server may call Apple twice after deleting, and
 * giving up early would report an account that's already gone as a failure.
 */
export function deleteAccount(appleAuthorizationCode?: string): Promise<DeleteAccountResponse> {
  const body: DeleteAccountRequest = {};

  if (appleAuthorizationCode) {
    body.appleAuthorizationCode = appleAuthorizationCode;
  }

  return callApi(
    '/api/account',
    deleteAccountResponseSchema,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    20_000,
  );
}
```

- [ ] **Step 2: Update the Account screen**

In `apps/mobile/src/app/(app)/account.tsx`:

- Import `Platform` from `react-native`; import `AuthActionError`, `getAppleDeletionCode`, `showAppleAccessNotice` from `#features/auth`.
- In the component:

```ts
const providers = useSessionStore((state) => state.session?.user.app_metadata.providers);
// Apple accounts on iOS confirm with Apple once more, so the API can revoke Nexui's access.
const confirmsWithApple =
  Platform.OS === 'ios' && Array.isArray(providers) && providers.includes('apple');
```

- Replace `onDelete`:

```ts
async function onDelete() {
  setPending('delete');
  setError(null);
  try {
    const appleCode = confirmsWithApple ? await getAppleDeletionCode() : undefined;

    // Cancelling Apple's sheet keeps the account.
    if (appleCode === null) {
      setPending(null);

      return;
    }

    const { appleAccessRemains } = await deleteAccount(appleCode);

    // Before the session clears, so the sign-in screen can show how to finish.
    if (appleAccessRemains) {
      showAppleAccessNotice();
    }

    await clearDeletedAccount();
  } catch (caught) {
    if (__DEV__) {
      console.warn('Account deletion failed', caught);
    }

    setError(
      caught instanceof AuthActionError
        ? caught.message
        : 'Could not delete your account. Check your connection and try again.',
    );
    setPending(null);
  }
}
```

- In the danger card's text, after "It can’t be undone.", add
  `{confirmsWithApple ? ' You’ll confirm with Apple so Nexui’s access to your Apple ID is removed too.' : null}`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && pnpm test`
Expected: no errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/data/api.ts "apps/mobile/src/app/(app)/account.tsx"
git commit -m "Confirm with Apple before deleting an Apple account on iOS"
```

---

### Task 8: Setup checklist and docs

**Files:**

- Create: `docs/specs/auth.md`
- Modify: `docs/architecture/authentication.md`, `AGENTS.md`, `README.md`, `.claude/agents/docs-keeper.md`

- [ ] **Step 1: Write `docs/specs/auth.md`** as a setup checklist only, with these sections: Identifiers (bundle ID / package `ai.faraj.nexui`, scheme `nexui`); Supabase projects (dev `nexui-dev`, prod `nexui-prod`; API keys; ES256 JWT keys; sign-up and confirm email; URL settings `nexui://` and `nexui://**`); Email codes (custom SMTP, Magic Link and Confirm signup templates with `{{ .Token }}`, OTP length 6); Google (consent screen, web/iOS/Android clients, Supabase provider with the web ID first); Apple (the spec's manual steps 1–2 and 5); EAS builds (dev client, preview, `eas device:create`, physical iPhone for Apple); and "Where each value goes" (table, including the four `APPLE_*` values for `apps/api/.env.local` and Vercel). It links to `docs/architecture/authentication.md` for behavior and notes the original plan is in git history (`911639f^:docs/specs/auth.md`).

- [ ] **Step 2: Update `docs/architecture/authentication.md`:** the intro names Apple (iOS only); the operation diagram mentions `apple-sign-in.ts`; a paragraph on the Apple flow (hashed nonce to Apple, raw nonce to Supabase, cancel → `null`, name saved best-effort on first authorization); "Deletion" becomes "delete, then revoke" (iOS confirmation code, server-side exchange and revoke, `appleAccessRemains`, the sign-in notice and why it lives on the sign-in screen); the native release list adds Apple success/cancel/name, deletion with Apple confirmation and cancel, and the web notice.

- [ ] **Step 3: Update pointers:** `AGENTS.md` says "Supabase, Google and Apple credentials are required for sign-in (see `docs/specs/auth.md`)"; `README.md`'s "`docs/specs/auth.md` A5" becomes "the EAS builds section of `docs/specs/auth.md`"; `.claude/agents/docs-keeper.md` says `auth.md` covers Supabase, Google and Apple setup.

- [ ] **Step 4: Verify**

Run: `pnpm format:check`
Expected: clean (run `pnpm format` first if Markdown tables need aligning).

- [ ] **Step 5: Commit**

```bash
git add docs/specs/auth.md docs/architecture/authentication.md AGENTS.md README.md .claude/agents/docs-keeper.md
git commit -m "Document Apple sign-in setup, flow and deletion"
```

---

### Task 9: Checks, reviewers, and handoff to the manual steps

- [ ] **Step 1:** `pnpm fix`, then inspect `git diff` for unrelated changes.
- [ ] **Step 2:** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build` — all pass.
- [ ] **Step 3:** Run `api-reviewer`, `mobile-reviewer`, `security-reviewer` and `docs-keeper` on the branch; fix findings and re-run the checks.
- [ ] **Step 4:** Commit fixes, push the branch, and open a draft PR listing validation results and the manual steps.
- [ ] **Step 5: Stop.** The spec's manual steps (Apple Developer key, Supabase Apple provider on dev then prod, the `APPLE_*` env values locally and in Vercel, new EAS dev-client and preview builds) are the user's. The nine device checks on a physical iPhone follow them.
