import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../apps/mobile/src/data/api-request.ts';
import {
  appendPdf,
  checkPdf,
  TOO_LARGE,
  UNREADABLE_FILE,
} from '../apps/mobile/src/data/upload-form.ts';

const recorder = () => {
  const calls = [];

  return { calls, append: (...args) => calls.push(args) };
};

test('a PDF over 4 MB is refused before it is sent; one of unknown size goes', () => {
  assert.equal(TOO_LARGE, 'That file is over 4 MB.');
  assert.equal(checkPdf({ size: 4 * 1024 * 1024 + 1 }), TOO_LARGE);
  assert.equal(checkPdf({ size: 4 * 1024 * 1024 }), null);
  assert.equal(checkPdf({ size: null }), null);
});

test('on web the File itself is the upload, under its name', async () => {
  const file = new File(['%PDF-1.7'], 'Jordan-Lee-CV.pdf', { type: 'application/pdf' });
  const form = recorder();

  await appendPdf(form, { name: 'Jordan-Lee-CV.pdf', size: file.size, file });
  assert.deepEqual(form.calls, [['file', file, 'Jordan-Lee-CV.pdf']]);
});

// Expo's fetch sends a part that is a string, a Blob or has `bytes()`; it throws on React
// Native's `{ uri }` part, so a phone's upload never left the device.
test('on a phone the file part is the picked copy, read by bytes(), under its picked name', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7');
  // The picker's copy is named by a UUID; the part keeps the name the user picked.
  const copy = { name: '5F1C2A9E.pdf', bytes: async () => bytes };
  const form = recorder();

  await appendPdf(form, { name: 'Jordan-Lee-CV.pdf', size: bytes.length, copy });

  const [[field, part]] = form.calls;

  assert.equal(field, 'file');
  assert.equal(typeof part.bytes, 'function');
  assert.deepEqual(await part.bytes(), bytes);
  assert.equal(part.name, 'Jordan-Lee-CV.pdf');
  assert.equal(part.type, 'application/pdf');
  assert.equal('uri' in part, false);
});

test('a phone’s copy is read once, before the request is built', async () => {
  let reads = 0;
  const copy = {
    bytes: async () => {
      reads += 1;

      return new TextEncoder().encode('%PDF-1.7');
    },
  };
  const form = recorder();

  await appendPdf(form, { name: 'cv.pdf', size: 8, copy });
  assert.equal(reads, 1);

  await form.calls[0][1].bytes();
  assert.equal(reads, 1);
});

// Read inside Expo's fetch, a failure would show as "Nexui can't reach its server".
test('a phone’s copy that can’t be read is refused with its own message, nothing appended', async () => {
  const copy = {
    bytes: async () => {
      throw new Error('ENOENT');
    },
  };
  const form = recorder();

  await assert.rejects(appendPdf(form, { name: 'cv.pdf', size: 8, copy }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, UNREADABLE_FILE);
    assert.equal(error.message, "Couldn't read that file. Pick it again.");

    return true;
  });
  assert.equal(form.calls.length, 0);
});
