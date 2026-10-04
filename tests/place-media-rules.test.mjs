import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleUrl,
  clipExtract,
  distanceKm,
  expiresAt,
  failedRow,
  isFresh,
  LOOKUP_VERSION,
  lookupRow,
  matchArticle,
  retryAfterMs,
  toPlaceMedia,
} from '../apps/api/src/lib/media/rules.ts';

const NOW = new Date('2026-10-04T12:00:00Z');
const MINUTE = 60_000;
const DAY = 86_400_000;

// An article `km` kilometres due north of a place: 1° of latitude is about 111.2 km.
const north = (title, from, km) => ({
  title,
  lat: from.lat + km / 111.195,
  lng: from.lng,
  image: null,
  extract: `${title} is a place.`,
});

const town = { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 };
const region = { name: 'Lower Austria', placeType: 'region', lat: 48.2, lng: 15.6 };

test('distances are great-circle kilometres', () => {
  const berlinToParis = distanceKm({ lat: 52.52, lng: 13.405 }, { lat: 48.8566, lng: 2.3522 });

  assert.ok(Math.abs(berlinToParis - 878) < 5);
  assert.ok(Math.abs(distanceKm(town, north('x', town, 20)) - 20) < 0.1);
});

test('a town matches articles within 25 km, a region or area within 75 km', () => {
  assert.equal(matchArticle(town, [north('Hallstatt', town, 20)])?.title, 'Hallstatt');
  assert.equal(matchArticle(town, [north('Hallstatt', town, 30)]), null);
  assert.equal(matchArticle(region, [north('Lower Austria', region, 60)])?.title, 'Lower Austria');
  assert.equal(
    matchArticle({ ...region, placeType: 'area' }, [north('Lower Austria', region, 74)])?.title,
    'Lower Austria',
  );
  assert.equal(matchArticle(region, [north('Lower Austria', region, 80)]), null);
});

test('an article titled with the name wins over a nearer one', () => {
  const amalfi = { name: 'Amalfi Coast', placeType: 'area', lat: 40.63, lng: 14.6 };
  const articles = [north('Duchy of Amalfi', amalfi, 2), north('Amalfi Coast', amalfi, 12)];

  assert.equal(matchArticle(amalfi, articles)?.title, 'Amalfi Coast');
});

test('"Springfield, Illinois" names Springfield; otherwise the nearest article wins', () => {
  const springfield = { name: 'Springfield', placeType: 'city', lat: 39.8, lng: -89.65 };
  const named = [
    north('Lincoln Home', springfield, 1),
    north('Springfield, Illinois', springfield, 3),
  ];
  const unnamed = [
    north('Springfield Armory', springfield, 5),
    north('Lincoln Home', springfield, 1),
  ];

  assert.equal(matchArticle(springfield, named)?.title, 'Springfield, Illinois');
  assert.equal(matchArticle(springfield, unnamed)?.title, 'Lincoln Home');
});

test('nothing in range means no match, never a guess', () => {
  assert.equal(matchArticle(town, []), null);
  assert.equal(matchArticle(town, [north('Hallstatt', town, 400)]), null);
});

test('rows expire by status: found 90 days, none 30, failed 15 minutes or Retry-After', () => {
  const wait = (date) => date.getTime() - NOW.getTime();

  assert.equal(wait(expiresAt('found', NOW)), 90 * DAY);
  assert.equal(wait(expiresAt('none', NOW)), 30 * DAY);
  assert.equal(wait(expiresAt('failed', NOW)), 15 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 60 * MINUTE)), 60 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 5 * MINUTE)), 15 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 30 * DAY)), DAY);
});

test('Retry-After reads as seconds or an HTTP date', () => {
  assert.equal(retryAfterMs('120', NOW), 120_000);
  assert.equal(retryAfterMs('Sun, 04 Oct 2026 13:00:00 GMT', NOW), 60 * MINUTE);
  assert.equal(retryAfterMs('soon', NOW), 0);
  assert.equal(retryAfterMs(null, NOW), 0);
});

test('a row is fresh while current; pinned rows always; an older version never', () => {
  const row = lookupRow('hallstatt|AT|47.6|13.6', north('Hallstatt', town, 1), NOW);
  const later = new Date(NOW.getTime() + 91 * DAY);

  assert.equal(isFresh(row, NOW), true);
  assert.equal(isFresh(row, later), false);
  assert.equal(isFresh({ ...row, pinned: true }, later), true);
  assert.equal(isFresh({ ...row, lookupVersion: LOOKUP_VERSION - 1 }, NOW), false);
  assert.equal(isFresh({ ...row, lookupVersion: LOOKUP_VERSION - 1, pinned: true }, NOW), true);
});

test('a found row carries the article; none and failed rows carry nothing', () => {
  const found = lookupRow('k', north('Springfield, Illinois', town, 1), NOW);

  assert.equal(found.status, 'found');
  assert.equal(found.lookupVersion, LOOKUP_VERSION);
  assert.equal(found.pageUrl, 'https://en.wikipedia.org/wiki/Springfield%2C_Illinois');
  assert.deepEqual(toPlaceMedia(found), {
    status: 'ready',
    about: {
      title: 'Springfield, Illinois',
      extract: 'Springfield, Illinois is a place.',
      url: found.pageUrl,
    },
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(lookupRow('k', null, NOW)), {
    status: 'ready',
    about: null,
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(failedRow('k', NOW)), {
    status: 'ready',
    about: null,
    photo: null,
  });
});

test('an introduction is cut to 600 characters at a word, and an unsafe link is dropped', () => {
  const long = clipExtract('word '.repeat(200));

  assert.ok(long.length <= 600);
  assert.ok(long.endsWith('word…'));
  assert.equal(clipExtract(' Two\n\nlines. '), 'Two lines.');
  assert.equal(
    articleUrl('Český Krumlov'),
    'https://en.wikipedia.org/wiki/%C4%8Cesk%C3%BD_Krumlov',
  );

  const edited = {
    ...lookupRow('k', north('Hallstatt', town, 1), NOW),
    pageUrl: 'javascript:alert(1)',
  };

  assert.equal(toPlaceMedia(edited).about, null);
});
