import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthActionError,
  createAuthActions,
} from '../apps/mobile/src/features/auth/auth-actions.ts';

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

test('email requests normalize the address and allow account creation', async (t) => {
  const { actions, auth } = setup(t);
  assert.equal(await actions.sendEmailCode(' Me@Example.com '), 'me@example.com');
  assert.deepEqual(auth.signInWithOtp.mock.calls[0].arguments, [
    { email: 'me@example.com', options: { shouldCreateUser: true } },
  ]);
});

test('invalid email and code never reach Supabase', async (t) => {
  const { actions, auth } = setup(t);
  await assert.rejects(() => actions.sendEmailCode('invalid'), AuthActionError);
  await assert.rejects(() => actions.verifyEmailCode('a@b.co', '12'), AuthActionError);
  assert.equal(auth.signInWithOtp.mock.callCount(), 0);
  assert.equal(auth.verifyOtp.mock.callCount(), 0);
});

test('verification preserves leading zeroes and uses email OTP', async (t) => {
  const { actions, auth } = setup(t);
  await actions.verifyEmailCode(' Me@Example.com ', ' 012345 ');
  assert.deepEqual(auth.verifyOtp.mock.calls[0].arguments, [
    { email: 'me@example.com', token: '012345', type: 'email' },
  ]);
});

test('email rate limits and expired codes produce actionable messages', async (t) => {
  const apiError = (status, code) => ({ __isAuthError: true, name: 'AuthApiError', status, code });
  const { actions } = setup(t, {
    signInWithOtp: async () => ({ error: apiError(429) }),
    verifyOtp: async () => ({ error: apiError(403, 'otp_expired') }),
  });
  await assert.rejects(() => actions.sendEmailCode('a@b.co'), /Too many attempts/);
  await assert.rejects(() => actions.verifyEmailCode('a@b.co', '012345'), /wrong or has expired/);
});

test('unexpected email errors do not expose provider details', async (t) => {
  const { actions } = setup(t, {
    signInWithOtp: async () => ({ error: new Error('provider internals') }),
  });
  await assert.rejects(() => actions.sendEmailCode('a@b.co'), {
    message: 'Could not send a code. Try again.',
  });
});

test('Google cancellation does not exchange a token', async (t) => {
  const { actions, auth, google } = setup(t);
  google.getIdToken.mock.mockImplementation(async () => null);
  assert.equal(await actions.signInWithGoogle(), false);
  assert.equal(auth.signInWithIdToken.mock.callCount(), 0);
});

test('Google sign-in exchanges the native ID token with Supabase', async (t) => {
  const { actions, auth } = setup(t);
  assert.equal(await actions.signInWithGoogle(), true);
  assert.deepEqual(auth.signInWithIdToken.mock.calls[0].arguments, [
    { provider: 'google', token: 'google-id-token' },
  ]);
});

test('Google exchange errors become user-facing auth errors', async (t) => {
  const { actions } = setup(t, {
    signInWithIdToken: async () => ({ error: new Error('provider internals') }),
  });
  await assert.rejects(actions.signInWithGoogle, {
    message: 'Google sign-in failed. Try again.',
  });
});

test('sign-out succeeds without a fallback when the first attempt succeeds', async (t) => {
  const { actions, auth, google } = setup(t);
  await actions.signOut();
  assert.equal(auth.signOut.mock.callCount(), 1);
  assert.equal(google.signOut.mock.callCount(), 1);
});

test('sign-out succeeds when local fallback succeeds', async (t) => {
  const attempts = t.mock.fn(async (options) => ({
    error: options?.scope === 'local' ? null : new Error('Revocation failed'),
  }));
  const { actions } = setup(t, { signOut: attempts });
  await assert.doesNotReject(actions.signOut);
  assert.equal(attempts.mock.callCount(), 2);
  assert.deepEqual(attempts.mock.calls[1].arguments, [{ scope: 'local' }]);
});

test('both sign-out attempts failing rejects so the screen can recover', async (t) => {
  const { actions } = setup(t, {
    signOut: async () => ({ error: new Error('Offline refresh failed') }),
  });
  await assert.rejects(actions.signOut, AuthActionError);
});

test('deleted-account cleanup rejects if local sign-out fails', async (t) => {
  const { actions } = setup(t, {
    signOut: async () => ({ error: new Error('Cleanup failed') }),
  });
  await assert.rejects(actions.clearDeletedAccount, AuthActionError);
});

test('deleted-account cleanup uses local sign-out only', async (t) => {
  const { actions, auth } = setup(t);
  await actions.clearDeletedAccount();
  assert.equal(auth.signOut.mock.callCount(), 1);
  assert.deepEqual(auth.signOut.mock.calls[0].arguments, [{ scope: 'local' }]);
});

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
