import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePlaceName, placeMediaKey } from '../packages/types/src/media.ts';

test('the key is the normalized name, country and coordinates to 0.1°', () => {
  assert.equal(
    placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 }),
    'cesky krumlov|CZ|48.8|14.3',
  );
});

test('case, accents and spacing make no difference', () => {
  const berlin = { country: 'DE', lat: 52.52, lng: 13.405 };

  assert.equal(
    placeMediaKey({ ...berlin, name: '  BERLIN ' }),
    placeMediaKey({ ...berlin, name: 'Berlin' }),
  );
  assert.equal(normalizePlaceName('Zürich'), 'zurich');
  assert.equal(normalizePlaceName('Kraków\tOld   Town'), 'krakow old town');
});

test('punctuation folds to spaces, so a key is safe in a PostgREST in-filter', () => {
  const key = placeMediaKey({
    name: 'Washington, D.C.',
    country: 'US',
    lat: 38.9072,
    lng: -77.0369,
  });

  assert.equal(key, 'washington d c|US|38.9|-77.0');
  assert.doesNotMatch(key, /[,()"]/);
  assert.equal(normalizePlaceName("Xi'an"), 'xi an');
});

test('coordinates round to one decimal place, so nearby points share a key', () => {
  const at = (lat, lng) => placeMediaKey({ name: 'Hallstatt', country: 'AT', lat, lng });

  assert.equal(at(47.5622, 13.6493), at(47.5501, 13.6012));
  assert.notEqual(at(47.54, 13.6), at(47.56, 13.6));
  assert.equal(at(35, 139), 'hallstatt|AT|35.0|139.0');
  assert.equal(at(-0.04, 0.01), 'hallstatt|AT|0.0|0.0');
});

test('a very long name still makes a key the table accepts', () => {
  const key = placeMediaKey({ name: '㎞'.repeat(100), country: 'JP', lat: 35, lng: 139 });

  assert.ok(key.length <= 200);
});
