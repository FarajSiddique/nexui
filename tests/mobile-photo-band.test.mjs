import assert from 'node:assert/strict';
import test from 'node:test';

import { photoBand } from '../apps/mobile/src/features/home/photo-band.ts';

const stops = (count) =>
  Array.from({ length: count }, (_, index) => ({ label: `Stop ${index + 1}`, ai: false }));
const card = (photos, count) => ({ photos, summary: { line: '', strip: stops(count) } });

test('a Home card shows its photos, with "+N" for the stops beyond them', () => {
  assert.deepEqual(photoBand(card(['a', 'b', 'c'], 4)), { photos: ['a', 'b', 'c'], more: 1 });
  assert.deepEqual(photoBand(card(['a', 'c'], 4)), { photos: ['a', 'c'], more: 2 });
  assert.deepEqual(photoBand(card(['a'], 1)), { photos: ['a'], more: 0 });
});

test('a card with no photos has no band, so no "+N"', () => {
  assert.deepEqual(photoBand(card([], 3)), { photos: [], more: 0 });
  assert.deepEqual(photoBand({ photos: [], summary: { line: '' } }), { photos: [], more: 0 });
});
