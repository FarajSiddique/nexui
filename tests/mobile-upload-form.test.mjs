import assert from 'node:assert/strict';
import test from 'node:test';

import { appendPdf, checkPdf, TOO_LARGE } from '../apps/mobile/src/data/upload-form.ts';

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

test('on web the File itself is the upload, under its name', () => {
  const file = new File(['%PDF-1.7'], 'Jordan-Lee-CV.pdf', { type: 'application/pdf' });
  const form = recorder();

  appendPdf(form, { uri: 'blob:cv', name: 'Jordan-Lee-CV.pdf', size: file.size, file });
  assert.deepEqual(form.calls, [['file', file, 'Jordan-Lee-CV.pdf']]);
});

test('on a phone the file part points at its uri, as a PDF', () => {
  const form = recorder();

  appendPdf(form, { uri: 'file:///cache/cv.pdf', name: 'cv.pdf', size: 1200, file: null });
  assert.deepEqual(form.calls, [
    ['file', { uri: 'file:///cache/cv.pdf', name: 'cv.pdf', type: 'application/pdf' }],
  ]);
});
