import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleUrl,
  clipExtract,
  distanceKm,
  expiresAt,
  failedRow,
  imageType,
  isFresh,
  isUsableImage,
  LOOKUP_VERSION,
  lookupRow,
  matchArticle,
  photoSource,
  plainText,
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

// URLs in our bucket, as `publicPhotoUrl` builds them.
const bucketUrl = (path) => `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`;

// What request 2 says about a usable file, with overrides.
const fileInfo = (overrides = {}) => ({
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
  thumbWidth: 960,
  thumbHeight: 640,
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
  artist: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  nonFree: false,
  ...overrides,
});

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
  assert.deepEqual(toPlaceMedia(found, bucketUrl), {
    status: 'ready',
    about: {
      title: 'Springfield, Illinois',
      extract: 'Springfield, Illinois is a place.',
      url: found.pageUrl,
    },
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(lookupRow('k', null, NOW), bucketUrl), {
    status: 'ready',
    about: null,
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(failedRow('k', NOW), bucketUrl), {
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

  assert.equal(toPlaceMedia(edited, bucketUrl).about, null);
});

test('phase 2 rows are version 2, so phase 1 rows are looked up again', () => {
  const row = lookupRow('k', north('Hallstatt', town, 1), NOW);

  assert.equal(LOOKUP_VERSION, 2);
  assert.equal(isFresh({ ...row, lookupVersion: 1 }, NOW), false);
});

test('a lead image must look like a photo: no SVG, flag, coat of arms, map, logo, seal or emblem', () => {
  for (const file of [
    'Museumsinsel_Berlin.jpg',
    'Hallstatt_300.jpg',
    'Flagstaff_downtown.jpg',
    'Mapleton_Main_Street.JPG',
  ]) {
    assert.equal(isUsableImage(file), true, file);
  }

  for (const file of [
    'Berlin_skyline.svg',
    'Flag_of_Lower_Austria.svg',
    'Flag of Kenya.png',
    'Coat_of_arms_of_Berlin.png',
    'DEU_Berlin_COA.png',
    'Niederösterreich_Wappen.png',
    'Lower_Austria_location_map.png',
    'Locator_map_Kyoto.png',
    'Tuscany_Map.jpg',
    'Kyoto_city_logo.png',
    'Seal_of_Springfield.png',
    'Emblem_of_Kyoto.png',
  ]) {
    assert.equal(isUsableImage(file), false, file);
  }
});

test('the Artist HTML becomes plain text of at most 120 characters', () => {
  assert.equal(
    plainText(
      '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue" title="User:Kasa Fue">Kasa Fue</a>',
    ),
    'Kasa Fue',
  );
  assert.equal(
    plainText('<span class="fn"><bdi>Jane &amp; John&nbsp;Doe</bdi></span>, own work'),
    'Jane & John Doe, own work',
  );
  assert.equal(plainText('Caf&#233; &#x263A; &bogus;'), 'Café ☺ &bogus;');
  // Berlin's lead image, a derivative work: the source file's link goes, list items join.
  assert.equal(
    plainText(
      '<ul><li><a href="//commons.wikimedia.org/wiki/File:Museumsinsel_Berlin_Juli_2021_1_(cropped).jpg" title="File:Museumsinsel Berlin Juli 2021 1 (cropped).jpg">File:Museumsinsel Berlin Juli 2021 1 (cropped).jpg</a>: <a href="//commons.wikimedia.org/wiki/User:Kasa_Fue" title="User:Kasa Fue">Kasa Fue</a></li>\n<li>derivative work: <a href="//commons.wikimedia.org/wiki/User:Georgfotoart" title="User:Georgfotoart">Georgfotoart</a></li></ul>',
    ),
    'Kasa Fue; derivative work: Georgfotoart',
  );

  const long = plainText(`<b>${'name '.repeat(40)}</b>`);

  assert.ok(long.length <= 120);
  assert.ok(long.endsWith('name…'));
});

test('the image format comes from its first bytes, never its name or header', () => {
  const text = (value) => new TextEncoder().encode(value);

  assert.equal(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(imageType(text('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageType(text('<html></html>')), null);
  assert.equal(imageType(text('GIF89a')), null);
  assert.equal(imageType(new Uint8Array()), null);
});

test('request 2 gives a photo its two sizes and its credit', () => {
  assert.deepEqual(photoSource(fileInfo()), {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
    thumbUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/500px-Berlin.jpg',
    width: 960,
    height: 640,
    credit: {
      author: 'Kasa Fue',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  });
  assert.equal(
    photoSource(fileInfo({ licenseUrl: '//creativecommons.org/publicdomain/zero/1.0/' })).credit
      .licenseUrl,
    'https://creativecommons.org/publicdomain/zero/1.0/',
  );
  assert.deepEqual(
    photoSource(fileInfo({ artist: null, license: 'Public domain', licenseUrl: null })).credit,
    {
      author: '',
      license: 'Public domain',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  );
});

test('a thumbnail on thumb.wikimedia.org is used without its tracking query', () => {
  const thumb =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Museumsinsel_%28cropped%29.jpg/960px-Museumsinsel_%28cropped%29.jpg';
  const source = photoSource(
    fileInfo({
      thumbUrl: `${thumb}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
    }),
  );

  assert.equal(source.url, thumb);
  assert.equal(
    source.thumbUrl,
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Museumsinsel_%28cropped%29.jpg/500px-Museumsinsel_%28cropped%29.jpg',
  );
});

test('no licence, a non-free file, a small original or a link off Wikimedia means no photo', () => {
  for (const overrides of [
    { license: null },
    { license: '   ' },
    { nonFree: true },
    {
      thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Berlin.jpg',
      thumbWidth: 640,
    },
    { thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Berlin.jpg' },
    { thumbUrl: 'https://example.com/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg' },
    {
      thumbUrl:
        'http://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
    },
    { pageUrl: 'https://en.wikipedia.org/wiki/File:Berlin.jpg' },
    { thumbHeight: 0 },
  ]) {
    assert.equal(photoSource(fileInfo(overrides)), null, JSON.stringify(overrides));
  }
});

test('a found row with a stored photo answers with our URLs; anything else has no photo', () => {
  const copied = {
    photo: { path: 'a/b-960.jpg', thumbPath: 'a/b-500.jpg', width: 960, height: 640 },
    credit: photoSource(fileInfo()).credit,
  };
  const row = lookupRow('k', north('Hallstatt', town, 1), NOW, copied);
  const localUrl = (path) => `http://127.0.0.1:54321/storage/v1/object/public/place-photos/${path}`;

  assert.deepEqual(row.photo, copied.photo);
  assert.deepEqual(toPlaceMedia(row, bucketUrl).photo, {
    url: bucketUrl('a/b-960.jpg'),
    thumbUrl: bucketUrl('a/b-500.jpg'),
    width: 960,
    height: 640,
    credit: copied.credit,
  });
  assert.equal(
    toPlaceMedia(row, localUrl).photo,
    null,
    'a URL the contract rejects drops the photo, not the answer',
  );
  assert.equal(toPlaceMedia({ ...row, status: 'none' }, bucketUrl).photo, null);
  assert.equal(toPlaceMedia({ ...row, credit: null }, bucketUrl).photo, null);
  assert.equal(lookupRow('k', null, NOW).photo, null);
});
