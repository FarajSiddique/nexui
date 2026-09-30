import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, requestJson, UNREACHABLE_MESSAGE } from '../apps/mobile/src/lib/api-request.ts';
import { UnauthorizedError } from '../apps/mobile/src/lib/authenticated-fetch.ts';

const identity = { parse: (value) => value };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a successful answer is parsed', async () => {
  const seen = [];
  const send = async (url, init) => {
    seen.push([url, init.method]);

    return json({ items: [] });
  };

  assert.deepEqual(await requestJson(send, 'http://api/x', { method: 'GET' }, identity), {
    items: [],
  });
  assert.deepEqual(seen, [['http://api/x', 'GET']]);
});

test('an error answer carries the server message and status', async () => {
  const send = async () => json({ error: 'A run is already working on this intent' }, 409);

  await assert.rejects(
    requestJson(send, 'http://api/x', {}, identity),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.message === 'A run is already working on this intent',
  );
});

test('a failure without a JSON body gets a readable fallback', async () => {
  const send = async () => new Response('<html>oops</html>', { status: 500 });

  await assert.rejects(
    requestJson(send, 'http://api/x', {}, identity),
    (error) => error.status === 500 && error.message === 'Something went wrong. Try again.',
  );
});

test('a server that cannot be reached is status 0', async () => {
  const send = async () => {
    throw new TypeError('Network request failed');
  };

  await assert.rejects(
    requestJson(send, 'http://api/x', {}, identity),
    (error) => error.status === 0 && error.message === UNREACHABLE_MESSAGE,
  );
});

test('a request past its timeout is aborted and reported as unreachable', async () => {
  const send = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

  await assert.rejects(
    requestJson(send, 'http://api/x', {}, identity, 5),
    (error) => error.status === 0,
  );
});

test('a rejected session asks the user to sign in again', async () => {
  const send = async () => {
    throw new UnauthorizedError('Session rejected by the API');
  };

  await assert.rejects(
    requestJson(send, 'http://api/x', {}, identity),
    (error) => error.status === 401 && error.message === 'Sign in again to continue.',
  );
});

test("the caller's own cancel passes through untouched", async () => {
  const controller = new AbortController();
  const send = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('Request aborted');

        error.name = 'AbortError';
        reject(error);
      });
    });
  const pending = requestJson(send, 'http://api/x', { signal: controller.signal }, identity);

  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('the parser checks the answer', async () => {
  const strict = {
    parse: () => {
      throw new Error('Invalid answer');
    },
  };

  await assert.rejects(
    requestJson(async () => json({}), 'http://api/x', {}, strict),
    /Invalid/,
  );
});
