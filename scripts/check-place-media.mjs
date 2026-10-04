// Checks the place media lookup against live Wikipedia, with no cache writes, and prints a pass
// or fail per case: each place must match the right article, with an introduction. A manual
// gate like `pnpm eval:travel`, not part of `pnpm test`. Phase 2 adds the photo expectations.
// Needs WIKIMEDIA_CONTACT, from the environment or apps/api/.env.local.
import { existsSync } from 'node:fs';

import { readMediaConfig } from '../apps/api/src/lib/media/config.ts';
import { matchArticle } from '../apps/api/src/lib/media/rules.ts';
import { searchArticles } from '../apps/api/src/lib/media/wikipedia.ts';
import { normalizePlaceName, roundCoordinate } from '../packages/types/src/media.ts';

const CASES = [
  { place: { name: 'Berlin', placeType: 'city', lat: 52.52, lng: 13.405 }, title: 'Berlin' },
  {
    place: { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 },
    title: 'Hallstatt',
  },
  {
    place: { name: 'Springfield', placeType: 'city', lat: 39.7817, lng: -89.6501 },
    title: 'Springfield, Illinois',
  },
  {
    place: { name: 'Springfield', placeType: 'city', lat: 42.1015, lng: -72.5898 },
    title: 'Springfield, Massachusetts',
  },
  {
    place: { name: 'Lower Austria', placeType: 'region', lat: 48.2, lng: 15.6 },
    title: 'Lower Austria',
  },
  {
    place: { name: 'Amalfi Coast', placeType: 'area', lat: 40.633, lng: 14.602 },
    title: 'Amalfi Coast',
  },
  { place: { name: 'Kyoto', placeType: 'city', lat: 35.0116, lng: 135.7681 }, title: 'Kyoto' },
  {
    place: { name: 'Dolomites', placeType: 'region', lat: 46.41, lng: 11.84 },
    title: 'Dolomites',
  },
];

if (!process.env.WIKIMEDIA_CONTACT && existsSync('apps/api/.env.local')) {
  process.loadEnvFile('apps/api/.env.local');
}

const { contact } = readMediaConfig();

if (!contact) {
  console.error('Set WIKIMEDIA_CONTACT (an email address or URL) in apps/api/.env.local.');
  process.exit(1);
}

let failures = 0;

for (const { place, title } of CASES) {
  const label = `${place.name} (${place.lat}, ${place.lng})`;

  try {
    // As the lookup does it: the key's normalized name and rounded coordinates.
    const keyed = {
      ...place,
      name: normalizePlaceName(place.name),
      lat: roundCoordinate(place.lat),
      lng: roundCoordinate(place.lng),
    };
    const match = matchArticle(keyed, await searchArticles(keyed.name, contact));
    const pass = match?.title === title && match.extract.length > 0;

    if (!pass) {
      failures += 1;
    }

    const found = match ? `${match.title}${match.extract ? '' : ' (no introduction)'}` : 'no match';

    console.log(
      `${pass ? 'pass' : 'FAIL'}  ${label}: ${found}${pass ? '' : `, expected ${title}`}`,
    );
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${label}: ${error.message}`);
  }
}

console.log(
  failures === 0
    ? `All ${CASES.length} cases pass.`
    : `${failures} of ${CASES.length} cases failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
