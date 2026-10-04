// Hermes, the iOS and Android JS engine, has no Intl.DisplayNames, so country names can't depend
// on it. This file removes it before loading the formatter, as on a device.
import assert from 'node:assert/strict';
import test from 'node:test';

delete Intl.DisplayNames;

const { countryName } = await import('../apps/mobile/src/lib/format.ts');

test('country names come from the code even without Intl.DisplayNames', () => {
  assert.equal(countryName('DE'), 'Germany');
  assert.equal(countryName('JP'), 'Japan');
  assert.equal(countryName('CZ'), 'Czechia');
  assert.equal(countryName('XK'), 'Kosovo');
  assert.equal(countryName('AA'), 'AA');
});
