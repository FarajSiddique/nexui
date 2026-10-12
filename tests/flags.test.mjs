import assert from 'node:assert/strict';
import test from 'node:test';

import { readFlag, readFrom, setFlagReader } from '../apps/api/src/lib/flags/flags.ts';

const serving = (value, reason = 'fallthrough') => ({
  evaluate: async () => ({ value, reason, variantId: null }),
});

test('a flag is on only when Vercel serves true', async () => {
  assert.equal(await readFrom(serving(true), 'job-search'), true);
  assert.equal(await readFrom(serving(false), 'job-search'), false);
  assert.equal(await readFrom(serving('on'), 'job-search'), false);
});

test('the flag is asked for by its key, off by default', async () => {
  const calls = [];
  const source = {
    evaluate: async (...args) => {
      calls.push(args);

      return { value: true, reason: 'fallthrough', variantId: null };
    },
  };

  await readFrom(source, 'job-search');

  assert.deepEqual(calls, [['job-search', false]]);
});

test("a flag Vercel can't read stays off, and the log names no error detail", async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const failing = {
    evaluate: async () => ({
      value: false,
      reason: 'error',
      errorMessage: 'secret detail',
      variantId: null,
    }),
  };
  const throwing = {
    evaluate: async () => {
      throw new Error('secret detail');
    },
  };

  assert.equal(await readFrom(failing, 'job-search'), false);
  assert.equal(await readFrom(throwing, 'job-search'), false);
  assert.equal(logged.mock.callCount(), 2);

  for (const call of logged.mock.calls) {
    assert.equal(call.arguments[0], '[flags]');
    assert.equal(call.arguments[1], 'Could not read the job-search flag; it stays off.');
  }
});

test('tests and scripts can answer flags without Vercel', async (t) => {
  setFlagReader(async (key) => key === 'job-search');
  t.after(() => setFlagReader(null));

  assert.equal(await readFlag('job-search'), true);
  assert.equal(await readFlag('another-flag'), false);
});
