import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { mediaPlaces, resolvePlaceMedia } from '../apps/api/src/lib/media/lookup.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { placeMediaKey } from '../packages/types/src/media.ts';
import {
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';
import {
  adminDb,
  article,
  cacheRow,
  CONTACT,
  fileInfoBody,
  JPEG,
  mediaUpstream,
  NOW,
  searchBody,
} from './support/media.mjs';

// A town `index` degrees east along the equator, so each one has its own key.
function spot(index, name = `Place ${index}`) {
  const place = { name, country: 'KE', placeType: 'town', lat: 0, lng: index };

  return {
    id: `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    key: placeMediaKey(place),
    ...place,
  };
}

// Stubs fetch with `upstream` and quiets the logs; returns the deps and the deferred tasks.
function setup(t, upstream, overrides = {}) {
  const deferred = [];

  t.mock.method(globalThis, 'fetch', upstream.handler);
  t.mock.method(console, 'info', () => {});

  return {
    deps: {
      db: adminDb(),
      contact: CONTACT,
      defer: (task) => deferred.push(task),
      now: () => NOW,
      ...overrides,
    },
    deferred,
    errors: t.mock.method(console, 'error', () => {}),
  };
}

test('lookups that outlast the budget answer pending and finish after the response', async (t) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const upstream = mediaUpstream({
    wikipedia: async (url) => {
      const name = url.searchParams.get('gsrsearch');

      if (name === 'Slow') {
        await held;
      }

      return Response.json(searchBody([article(name, 0, name === 'Slow' ? 2 : 1)]));
    },
  });
  const { deps, deferred } = setup(t, upstream, { budgetMs: 50 });
  const fast = spot(1, 'Fast');
  const slow = spot(2, 'Slow');

  const answers = await resolvePlaceMedia(deps, [fast, slow]);

  assert.equal(answers[fast.id].about.title, 'Fast');
  assert.deepEqual(answers[slow.id], { status: 'pending' });
  assert.equal(deferred.length, 1);

  release();
  await deferred[0]();

  assert.deepEqual(
    upstream.state.saved.map((row) => [row.key, row.status]),
    [
      [fast.key, 'found'],
      [slow.key, 'found'],
    ],
  );
});

test('at most 20 lookups start per request; the rest answer pending', async (t) => {
  const upstream = mediaUpstream();
  const { deps, deferred } = setup(t, upstream);
  const places = Array.from({ length: 25 }, (_, index) => spot(index + 1));

  const answers = await resolvePlaceMedia(deps, places);
  const statuses = Object.values(answers).map((answer) => answer.status);

  assert.equal(upstream.state.searches.length, 20);
  assert.equal(statuses.filter((status) => status === 'pending').length, 5);
  assert.equal(deferred.length, 0);
});

test('a throttle stops new lookups and caches every unstarted place until Retry-After', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: () => new Response('slow down', { status: 429, headers: { 'Retry-After': '3600' } }),
  });
  const { deps, errors } = setup(t, upstream);
  const places = Array.from({ length: 25 }, (_, index) => spot(index + 1));

  const answers = await resolvePlaceMedia(deps, places);

  assert.equal(upstream.state.searches.length, 4);
  assert.equal(upstream.state.saved.length, 25);

  for (const row of upstream.state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(row.expires_at, new Date(NOW.getTime() + 3_600_000).toISOString());
  }

  assert.ok(
    Object.values(answers).every((answer) => answer.status === 'ready'),
    'nothing is left pending for the app to poll',
  );
  assert.ok(
    errors.mock.calls.every((call) => !call.arguments.join(' ').includes('Place')),
    'logs never name a place',
  );
});

test('a place twice in a plan is looked up once and answered for both ids', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: () => Response.json(searchBody([article('Kyoto', 0, 1)])),
  });
  const { deps } = setup(t, upstream);
  const first = spot(1, 'Kyoto');
  const again = { ...first, id: 'b0000000-0000-4000-8000-000000000099' };

  const answers = await resolvePlaceMedia(deps, [first, again]);

  assert.equal(upstream.state.searches.length, 1);
  assert.equal(answers[first.id].about.title, 'Kyoto');
  assert.deepEqual(answers[again.id], answers[first.id]);
});

test('a pinned row is used even when expired or from an older lookup', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    rows: [
      cacheRow(place.key, {
        pinned: true,
        status: 'none',
        lookup_version: 0,
        page_title: null,
        page_url: null,
        extract: null,
        expires_at: '2020-01-01T00:00:00.000Z',
      }),
    ],
  });
  const { deps } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);

  assert.equal(upstream.state.searches.length, 0);
  assert.deepEqual(answers[place.id], { status: 'ready', about: null, photo: null });
});

test('an error answer or unreadable body is failed; pages without coordinates are none', async (t) => {
  const answers = {
    'Place 1': () => Response.json({ error: { code: 'maxlag', info: 'Waiting for a replica' } }),
    'Place 2': () => new Response('<html>', { status: 200 }),
    'Place 3': () => Response.json(searchBody([{ title: 'Place 3', extract: 'No coordinates.' }])),
  };
  const upstream = mediaUpstream({
    wikipedia: (url) => answers[url.searchParams.get('gsrsearch')](),
  });
  const { deps } = setup(t, upstream);

  await resolvePlaceMedia(deps, [spot(1), spot(2), spot(3)]);

  assert.deepEqual(Object.fromEntries(upstream.state.saved.map((row) => [row.key, row.status])), {
    [spot(1).key]: 'failed',
    [spot(2).key]: 'failed',
    [spot(3).key]: 'none',
  });
});

test('a failed cache write still answers, and logs only a code', async (t) => {
  const upstream = mediaUpstream({
    failWrite: true,
    wikipedia: () => Response.json(searchBody([article('Kyoto', 0, 1)])),
  });
  const { deps, errors } = setup(t, upstream);
  const place = spot(1, 'Kyoto');

  const answers = await resolvePlaceMedia(deps, [place]);

  assert.equal(answers[place.id].about.title, 'Kyoto');
  assert.deepEqual(
    errors.mock.calls.map((call) => call.arguments),
    [['[media]', 'Could not cache a lookup (42501).']],
  );
});

test('without a contact nothing is looked up; cached rows still answer', async (t) => {
  const cached = spot(1, 'Kyoto');
  const upstream = mediaUpstream({ rows: [cacheRow(cached.key, { lookup_version: 0 })] });
  const { deps } = setup(t, upstream, { contact: null });

  const answers = await resolvePlaceMedia(deps, [cached, spot(2)]);

  assert.equal(upstream.state.searches.length, 0);
  assert.equal(answers[cached.id].about.title, 'Tokyo');
  assert.deepEqual(answers[spot(2).id], { status: 'ready', about: null, photo: null });
});

test('every valid place is asked about, decision candidates included', () => {
  const candidate = objectRow('a1b2c3d4-0000-4000-8000-000000000101', 'place', {
    ...kyotoData,
    name: 'Nara',
    lat: 34.69,
    lng: 135.8,
  });
  const broken = objectRow('a1b2c3d4-0000-4000-8000-000000000102', 'place', { name: 'Broken' });
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [tripRow, tokyoRow, kyotoRow, candidate, broken],
    }),
  );

  assert.deepEqual(
    mediaPlaces(snapshot).map((place) => place.key),
    ['tokyo|JP|35.7|139.7', 'kyoto|JP|35.0|135.8', 'nara|JP|34.7|135.8'],
  );
});

test('the search and the match depend only on the key, not the raw name', async (t) => {
  const odd = objectRow('a1b2c3d4-0000-4000-8000-000000000103', 'place', {
    ...kyotoData,
    name: '-Kyōto~',
    lat: 35.04,
    lng: 135.77,
  });
  const places = mediaPlaces(
    mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID), { objects: [tripRow, odd] })),
  );
  const upstream = mediaUpstream({
    wikipedia: () => Response.json(searchBody([article('Kyoto', 35.0, 135.8)])),
  });
  const { deps } = setup(t, upstream);

  assert.deepEqual(
    places.map(({ key, name, lat, lng }) => ({ key, name, lat, lng })),
    [{ key: 'kyoto|JP|35.0|135.8', name: 'kyoto', lat: 35, lng: 135.8 }],
  );

  await resolvePlaceMedia(deps, places);

  assert.equal(upstream.state.searches[0].url.searchParams.get('gsrsearch'), 'kyoto');
});

const BUCKET = 'https://nexui-test.supabase.co/storage/v1/object/public/place-photos';
const hex = (data) => createHash('sha256').update(data).digest('hex');

// A search answer whose one article has a lead image.
const withImage = (name, lng, image) =>
  Response.json(searchBody([{ ...article(name, 0, lng), pageimage: image }]));

test('a usable lead image is copied into the bucket in two sizes and answered with its photo', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    wikipedia: () => withImage('Kyoto', 1, 'Kyoto_Skyline.jpg'),
    commons: () => Response.json(fileInfoBody('Kyoto_Skyline.jpg')),
  });
  const { deps } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);
  const [info] = upstream.state.infos;
  const [saved] = upstream.state.saved;
  const folder = hex(place.key).slice(0, 16);
  const name = hex(JPEG).slice(0, 12);
  const photo = {
    path: `${folder}/${name}-960.jpg`,
    thumbPath: `${folder}/${name}-500.jpg`,
    width: 960,
    height: 640,
  };
  const credit = {
    author: 'Kasa Fue',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Kyoto_Skyline.jpg',
  };

  assert.equal(info.url.searchParams.get('titles'), 'File:Kyoto_Skyline.jpg');
  assert.equal(info.headers.get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.deepEqual(
    upstream.state.downloads.map((download) => download.url.pathname.split('/').at(-1)).sort(),
    ['500px-Kyoto_Skyline.jpg', '960px-Kyoto_Skyline.jpg'],
  );
  assert.ok(upstream.state.downloads.every((download) => download.redirect === 'error'));
  assert.deepEqual(upstream.state.uploads.map((upload) => upload.path).sort(), [
    photo.thumbPath,
    photo.path,
  ]);

  for (const upload of upstream.state.uploads) {
    assert.equal(upload.headers.get('content-type'), 'image/jpeg');
    assert.equal(upload.headers.get('cache-control'), 'max-age=31536000');
    assert.equal(upload.headers.get('x-upsert'), 'true');
  }

  assert.equal(saved.status, 'found');
  assert.deepEqual(saved.photo, photo);
  assert.deepEqual(saved.credit, credit);
  assert.deepEqual(answers[place.id].photo, {
    url: `${BUCKET}/${photo.path}`,
    thumbUrl: `${BUCKET}/${photo.thumbPath}`,
    width: 960,
    height: 640,
    credit,
  });
});

test('a lead image that fails the photo rules keeps the article with no photo', async (t) => {
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);

  oversized.set(JPEG);

  const images = {
    Flagland: 'Flag_of_Kenya.svg',
    Nonfree: 'Nonfree_view.jpg',
    Webpage: 'Webpage_view.jpg',
    Huge: 'Huge_view.jpg',
  };
  const names = Object.keys(images);
  const nonFree = {
    extmetadata: { LicenseShortName: { value: 'Fair use' }, NonFree: { value: 'true' } },
  };
  const upstream = mediaUpstream({
    wikipedia: (url) => {
      const name = url.searchParams.get('gsrsearch');

      return withImage(name, names.indexOf(name) + 1, images[name]);
    },
    commons: (url) => {
      const file = url.searchParams.get('titles').slice('File:'.length);

      return Response.json(fileInfoBody(file, file === 'Nonfree_view.jpg' ? nonFree : {}));
    },
    images: (url) =>
      url.pathname.includes('Webpage')
        ? new Response('<html></html>', { headers: { 'Content-Type': 'image/jpeg' } })
        : new Response(oversized, { headers: { 'Content-Type': 'image/jpeg' } }),
  });
  const { deps } = setup(t, upstream);
  const places = names.map((name, index) => spot(index + 1, name));

  const answers = await resolvePlaceMedia(deps, places);

  assert.deepEqual(
    upstream.state.infos.map((info) => info.url.searchParams.get('titles')).sort(),
    ['File:Huge_view.jpg', 'File:Nonfree_view.jpg', 'File:Webpage_view.jpg'],
    'an SVG never reaches request 2',
  );
  assert.equal(upstream.state.downloads.length, 4, 'a non-free file is never downloaded');
  assert.equal(upstream.state.uploads.length, 0);

  for (const place of places) {
    assert.equal(answers[place.id].about.title, place.name);
    assert.equal(answers[place.id].photo, null);
  }

  assert.ok(
    upstream.state.saved.every(
      (row) => row.status === 'found' && row.photo === null && row.credit === null,
    ),
  );
});

test('a failed upload caches the place as failed, so no photo points at a missing file', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    wikipedia: () => withImage('Kyoto', 1, 'Kyoto_Skyline.jpg'),
    commons: () => Response.json(fileInfoBody('Kyoto_Skyline.jpg')),
    failUpload: (path) => path.endsWith('-500.jpg'),
  });
  const { deps, errors } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);
  const [saved] = upstream.state.saved;

  assert.equal(saved.status, 'failed');
  assert.equal(saved.photo, null);
  assert.equal(Date.parse(saved.expires_at) - NOW.getTime(), 15 * 60_000);
  assert.deepEqual(answers[place.id], { status: 'ready', about: null, photo: null });
  assert.ok(
    errors.mock.calls.some(
      (call) => call.arguments.join(' ') === '[media] Could not store a photo (500).',
    ),
  );
  assert.ok(errors.mock.calls.every((call) => !call.arguments.join(' ').includes('Kyoto')));
});

test('a throttled image download holds back the rest of the request like a throttled search', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: (url) => {
      const name = url.searchParams.get('gsrsearch');

      return withImage(name, Number(name.replace('Place ', '')), 'View.jpg');
    },
    commons: () => Response.json(fileInfoBody('View.jpg')),
    images: () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
  });
  const { deps } = setup(t, upstream);
  const places = Array.from({ length: 6 }, (_, index) => spot(index + 1));

  await resolvePlaceMedia(deps, places);

  assert.equal(upstream.state.searches.length, 4);
  assert.equal(upstream.state.saved.length, 6);

  for (const row of upstream.state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(row.expires_at, new Date(NOW.getTime() + 3_600_000).toISOString());
  }
});
