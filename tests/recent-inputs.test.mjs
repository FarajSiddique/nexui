// Contract for anchored-shell.md, Slice A "The + sheet, empty state" and "File plan":
// apps/mobile/src/stores/use-recent-inputs.ts exports a Zustand store `useRecentInputs`
// whose state has `inputs: string[]` (most recent first, at most five, device only), and
// `addRecentInput(text: string): void`, which records one input.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { addRecentInput, useRecentInputs } from '../apps/mobile/src/stores/use-recent-inputs.ts';

const inputs = () => useRecentInputs.getState().inputs;

beforeEach(() => {
  useRecentInputs.setState({ inputs: [] });
});

test('the most recent input comes first', () => {
  addRecentInput('call mom');
  addRecentInput('lunch with Sam fri 1pm');
  assert.deepEqual(inputs(), ['lunch with Sam fri 1pm', 'call mom']);
});

test('only the five most recent inputs are kept', () => {
  for (const text of ['one', 'two', 'three', 'four', 'five', 'six', 'seven']) {
    addRecentInput(text);
  }
  assert.deepEqual(inputs(), ['seven', 'six', 'five', 'four', 'three']);
});
