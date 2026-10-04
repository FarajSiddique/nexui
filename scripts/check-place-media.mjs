// Checks the place media lookup against live Wikipedia and Commons, with no cache or storage
// writes, and prints a pass or fail per case. Each place must:
// - match the right article, with an introduction;
// - get a photo, or none, as expected, with both sizes downloaded and accepted.
// A manual gate like `pnpm eval:travel`, not part of `pnpm test`.
// Needs WIKIMEDIA_CONTACT, from the environment or apps/api/.env.local.
import { existsSync } from 'node:fs';

import { readMediaConfig } from '../apps/api/src/lib/media/config.ts';
import { isUsableImage, matchArticle, photoSource } from '../apps/api/src/lib/media/rules.ts';
import { downloadImage, fileInfo, searchArticles } from '../apps/api/src/lib/media/wikipedia.ts';
import { normalizePlaceName, roundCoordinate } from '../packages/types/src/media.ts';

// `photo`: true when the place must get one, false when it must not, absent when either is fine.
const CASES = [
  {
    place: { name: 'Berlin', placeType: 'city', lat: 52.52, lng: 13.405 },
    title: 'Berlin',
    photo: true,
  },
  {
    place: { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 },
    title: 'Hallstatt',
    photo: true,
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
    photo: false,
  },
  {
    place: { name: 'Amalfi Coast', placeType: 'area', lat: 40.633, lng: 14.602 },
    title: 'Amalfi Coast',
  },
  {
    place: { name: 'Kyoto', placeType: 'city', lat: 35.0116, lng: 135.7681 },
    title: 'Kyoto',
    photo: true,
  },
  {
    place: { name: 'Dolomites', placeType: 'region', lat: 46.41, lng: 11.84 },
    title: 'Dolomites',
    photo: true,
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

// The match's photo as the lookup would copy it (downloaded, not stored), or why there's none.
async function livePhoto(match) {
  if (!match.image) {
    return { source: null, why: 'no lead image' };
  }

  if (!isUsableImage(match.image)) {
    return { source: null, why: `${match.image} is not a photo` };
  }

  const info = await fileInfo(match.image, contact);
  const source = info ? photoSource(info) : null;

  if (!source) {
    return { source: null, why: `${match.image} fails the licence or size rules` };
  }

  const sizes = await Promise.all([
    downloadImage(source.url, contact),
    downloadImage(source.thumbUrl, contact),
  ]);

  if (sizes.includes(null)) {
    return { source: null, why: `${match.image} downloads are not accepted images` };
  }

  return { source, why: '' };
}

// What a failed case expected, for its FAIL line.
function expected(title, photo) {
  if (photo === undefined) {
    return title;
  }

  return photo ? `${title} with a photo` : `${title} with no photo`;
}

let failures = 0;

for (const { place, title, photo } of CASES) {
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
    const found = match ? await livePhoto(match) : { source: null, why: 'no match' };
    const matched = match?.title === title && match.extract.length > 0;
    const pass = matched && (photo === undefined || photo === (found.source !== null));
    const credit = found.source?.credit;
    const shown = credit
      ? `photo by ${credit.author || 'unknown'} (${credit.license})`
      : `no photo: ${found.why}`;
    const verdict = pass ? 'pass' : 'FAIL';
    const wanted = pass ? '' : `; expected ${expected(title, photo)}`;

    if (!pass) {
      failures += 1;
    }

    console.log(`${verdict}  ${label}: ${match?.title ?? 'no match'}, ${shown}${wanted}`);
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
