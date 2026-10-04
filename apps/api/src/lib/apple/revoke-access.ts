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
