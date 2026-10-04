// Request 2 (a lead image's thumbnail and credit, from Commons) and the image downloads that
// copy a photo, with fetch stubbed.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  downloadImage,
  fileInfo,
  MAX_PHOTO_BYTES,
  WikipediaError,
  WikipediaThrottledError,
} from '../apps/api/src/lib/media/wikipedia.ts';
import { CONTACT, fileInfoBody, JPEG } from './support/media.mjs';

const IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/B.jpg/960px-B.jpg';

// Answers fetch with each of `answers` in turn and records what was asked.
function stub(t, ...answers) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init });

    const answer = answers.shift();

    if (answer instanceof Error) {
      throw answer;
    }

    return answer();
  });

  return calls;
}

const jpeg = (body = JPEG, headers = {}) =>
  new Response(body, { headers: { 'Content-Type': 'image/jpeg', ...headers } });

test('request 2 asks Commons for the 960px thumbnail and the credit metadata', async (t) => {
  const calls = stub(t, () => Response.json(fileInfoBody('Berlin.jpg')));

  const info = await fileInfo('Berlin.jpg', CONTACT);
  const [{ url, init }] = calls;

  assert.equal(`${url.origin}${url.pathname}`, 'https://commons.wikimedia.org/w/api.php');
  assert.equal(url.searchParams.get('titles'), 'File:Berlin.jpg');
  assert.equal(url.searchParams.get('prop'), 'imageinfo');
  assert.equal(url.searchParams.get('iiprop'), 'url|size|extmetadata');
  assert.equal(url.searchParams.get('iiurlwidth'), '960');
  assert.equal(
    url.searchParams.get('iiextmetadatafilter'),
    'Artist|LicenseShortName|LicenseUrl|NonFree',
  );
  assert.equal(url.searchParams.get('formatversion'), '2');
  assert.equal(new Headers(init.headers).get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.deepEqual(info, {
    thumbUrl:
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail',
    thumbWidth: 960,
    thumbHeight: 640,
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    artist: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    nonFree: false,
  });
});

test('NonFree counts unless it says false', async (t) => {
  const marked = (value) =>
    fileInfoBody('Berlin.jpg', {
      extmetadata: { LicenseShortName: { value: 'Fair use' }, NonFree: { value } },
    });

  stub(
    t,
    () => Response.json(marked('true')),
    () => Response.json(marked('false')),
  );

  assert.equal((await fileInfo('Berlin.jpg', CONTACT)).nonFree, true);
  assert.equal((await fileInfo('Berlin.jpg', CONTACT)).nonFree, false);
});

test('a file Commons lacks is no photo; an error answer throws', async (t) => {
  stub(
    t,
    () =>
      Response.json({
        batchcomplete: true,
        query: { pages: [{ ns: 6, title: 'File:Local.jpg', missing: true }] },
      }),
    () => Response.json({ error: { code: 'internal_api_error' } }),
  );

  assert.equal(await fileInfo('Local.jpg', CONTACT), null);
  await assert.rejects(fileInfo('Berlin.jpg', CONTACT), WikipediaError);
});

test('a download sends our User-Agent, refuses redirects and reads the format from the bytes', async (t) => {
  const calls = stub(t, () => jpeg());

  const image = await downloadImage(IMAGE, CONTACT);

  assert.equal(calls[0].url.href, IMAGE);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(new Headers(calls[0].init.headers).get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.equal(image.type, 'jpg');
  assert.deepEqual([...image.bytes], [...JPEG]);
});

test('a download that is not a JPEG, PNG or WebP, or is over 2 MB, is no photo', async (t) => {
  const oversized = new Uint8Array(MAX_PHOTO_BYTES + 1);

  oversized.set(JPEG);
  stub(
    t,
    () => jpeg('<html></html>'),
    () => jpeg('GIF89a'),
    () => jpeg(oversized),
    () => jpeg(JPEG, { 'Content-Length': String(MAX_PHOTO_BYTES + 1) }),
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await downloadImage(IMAGE, CONTACT), null, `attempt ${attempt}`);
  }
});

test('a download Wikimedia refuses for good (404, 403) is no photo, not a failed lookup', async (t) => {
  stub(
    t,
    () => new Response(null, { status: 404 }),
    () => new Response(null, { status: 403 }),
  );

  assert.equal(await downloadImage(IMAGE, CONTACT), null);
  assert.equal(await downloadImage(IMAGE, CONTACT), null);
});

test('a throttled, failed or redirected download throws, so the lookup is tried again', async (t) => {
  stub(
    t,
    () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    () => new Response(null, { status: 502 }),
    new TypeError('fetch failed: unexpected redirect'),
  );

  await assert.rejects(downloadImage(IMAGE, CONTACT), (error) => {
    assert.ok(error instanceof WikipediaThrottledError);
    assert.equal(error.retryAfter, '120');

    return true;
  });
  await assert.rejects(downloadImage(IMAGE, CONTACT), WikipediaError);
  await assert.rejects(downloadImage(IMAGE, CONTACT), WikipediaError);
});
