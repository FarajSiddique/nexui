import assert from 'node:assert/strict';
import test from 'node:test';

import { keyboardOverlap } from '../apps/mobile/src/lib/keyboard-overlap.ts';

test('a sheet that starts below the top is covered by the whole keyboard', () => {
  // A 0.92 sheet on an 874pt screen: it starts at 70 and ends at the screen bottom.
  assert.equal(keyboardOverlap({ y: 70, height: 804 }, 538), 336);
});

test('a sheet that iOS grows behind the keyboard is covered by the extra height', () => {
  assert.equal(keyboardOverlap({ y: 0, height: 874 }, 538), 336);
});

test('a view that ends above the keyboard needs no room', () => {
  assert.equal(keyboardOverlap({ y: 70, height: 400 }, 538), 0);
});

test('no keyboard, no overlap', () => {
  assert.equal(keyboardOverlap({ y: 70, height: 804 }, null), 0);
});
