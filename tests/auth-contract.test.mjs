import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authErrorSchema,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  emailCodeRequestSchema,
  emailCodeVerificationSchema,
} from '../packages/types/src/index.ts';

test('email code requests normalize the address and reject invalid ones', () => {
  assert.deepEqual(emailCodeRequestSchema.parse({ email: '  Me@Example.COM ' }), {
    email: 'me@example.com',
  });
  for (const email of ['', 'nope', 'a@', 42]) {
    assert.equal(emailCodeRequestSchema.safeParse({ email }).success, false);
  }
});

test('verification accepts exactly six digits, keeping leading zeros', () => {
  assert.deepEqual(emailCodeVerificationSchema.parse({ email: 'a@b.co', token: ' 012345 ' }), {
    email: 'a@b.co',
    token: '012345',
  });
  for (const token of ['12345', '1234567', '12a456', '']) {
    assert.equal(emailCodeVerificationSchema.safeParse({ email: 'a@b.co', token }).success, false);
  }
});

test('auth errors carry a message', () => {
  assert.equal(authErrorSchema.safeParse({ error: 'Sign in to continue.' }).success, true);
  assert.equal(authErrorSchema.safeParse({}).success, false);
});

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
