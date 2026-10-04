import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAppearance, resolveScheme } from '../apps/mobile/src/lib/appearance.ts';

test('a saved choice reads back as itself', () => {
  assert.equal(parseAppearance('light'), 'light');
  assert.equal(parseAppearance('dark'), 'dark');
  assert.equal(parseAppearance('system'), 'system');
});

test('a missing or unknown saved value falls back to matching the phone', () => {
  assert.equal(parseAppearance(null), 'system');
  assert.equal(parseAppearance(undefined), 'system');
  assert.equal(parseAppearance(''), 'system');
  assert.equal(parseAppearance('sepia'), 'system');
});

test('matching the phone draws with the phone’s scheme', () => {
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'light'), 'light');
});

test('matching the phone counts anything but dark as light', () => {
  assert.equal(resolveScheme('system', null), 'light');
  assert.equal(resolveScheme('system', undefined), 'light');
  assert.equal(resolveScheme('system', 'unspecified'), 'light');
});

test('a chosen scheme wins over the phone’s', () => {
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
});
