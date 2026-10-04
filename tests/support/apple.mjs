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
