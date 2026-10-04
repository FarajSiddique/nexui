import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/intents/[id]/media/route.ts';
import { setMediaScheduler } from '../apps/api/src/lib/media/schedule.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { intentMediaSchema, placeMediaKey } from '../packages/types/src/media.ts';
import { authed } from './support/graph-api.mjs';
import {
  INTENT_ID,
  KYOTO_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';
import {
  article,
  cacheRow,
  CONTACT,
  mediaUpstream,
  searchBody,
  useContact,
} from './support/media.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const DAY = 86_400_000;
const TOKYO_KEY = placeMediaKey(tokyoData);
const KYOTO_KEY = placeMediaKey(kyotoData);
const context = (id) => ({ params: Promise.resolve({ id }) });
const plan = (overrides) => snapshotRow(travelWorkspace(TRIP_ID), overrides);
const get = (id = INTENT_ID) =>
  GET(authed(`http://localhost/api/intents/${id}/media`), context(id));

// Each search (the key's normalized name) answers with that fixture place's article.
function wikipedia(url) {
  const place = url.searchParams.get('gsrsearch') === 'tokyo' ? tokyoData : kyotoData;

  return Response.json(searchBody([article(place.name, place.lat, place.lng)]));
}

// Lookups past the budget would call after(), which needs a Next.js request.
function setup(t, options) {
  const upstream = mediaUpstream(options);

  mockSupabaseAuth(t, upstream.handler);
  setMediaScheduler(() => {});
  t.after(() => setMediaScheduler(null));
  t.mock.method(console, 'info', () => {});

  return { state: upstream.state, errors: t.mock.method(console, 'error', () => {}) };
}

test('the media route requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const response = await GET(
    new Request(`http://localhost/api/intents/${INTENT_ID}/media`),
    context(INTENT_ID),
  );

  assert.equal(response.status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test("another user's plan or a bad id is 404, and nothing is read or looked up", async (t) => {
  useContact(t);
  const { state } = setup(t, { snapshot: null, wikipedia });

  assert.equal((await get()).status, 404);
  assert.equal((await get('nope')).status, 404);
  assert.equal(state.reads, 0);
  assert.equal(state.searches.length, 0);
});

test('a cache hit answers from the row without calling Wikipedia', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [
      cacheRow(TOKYO_KEY),
      cacheRow(KYOTO_KEY, { status: 'none', page_title: null, page_url: null, extract: null }),
    ],
  });

  const response = await get();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.searches.length, 0);
  assert.deepEqual(body, {
    places: {
      [TOKYO_ID]: {
        status: 'ready',
        about: {
          title: 'Tokyo',
          extract: 'Tokyo is the capital of Japan.',
          url: 'https://en.wikipedia.org/wiki/Tokyo',
        },
        photo: null,
      },
      [KYOTO_ID]: { status: 'ready', about: null, photo: null },
    },
  });
});

test('a miss asks Wikipedia with our User-Agent and caches the row', async (t) => {
  useContact(t);
  const { state } = setup(t, { snapshot: plan(), wikipedia });

  const body = await (await get()).json();
  const tokyo = state.saved.find((row) => row.key === TOKYO_KEY);
  const search = state.searches[0];

  assert.equal(state.searches.length, 2);
  assert.equal(search.headers.get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.equal(search.url.searchParams.get('generator'), 'search');
  assert.equal(search.url.searchParams.get('gsrlimit'), '5');
  assert.equal(search.url.searchParams.get('prop'), 'pageimages|coordinates|extracts');
  assert.equal(search.url.searchParams.get('exsentences'), '3');
  assert.equal(search.url.searchParams.get('explaintext'), '1');
  assert.deepEqual(
    { ...tokyo, fetched_at: undefined, expires_at: undefined },
    {
      key: TOKYO_KEY,
      status: 'found',
      lookup_version: 1,
      page_title: 'Tokyo',
      page_url: 'https://en.wikipedia.org/wiki/Tokyo',
      extract: 'Tokyo is a place.',
      photo: null,
      credit: null,
      fetched_at: undefined,
      expires_at: undefined,
    },
  );
  assert.equal(Date.parse(tokyo.expires_at) - Date.parse(tokyo.fetched_at), 90 * DAY);
  assert.equal(body.places[TOKYO_ID].about.title, 'Tokyo');
  assert.equal(body.places[KYOTO_ID].about.title, 'Kyoto');
});

test('a row from an older lookup version is looked up again', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [cacheRow(TOKYO_KEY, { lookup_version: 0 }), cacheRow(KYOTO_KEY)],
  });

  await get();

  assert.deepEqual(
    state.searches.map((search) => search.url.searchParams.get('gsrsearch')),
    ['tokyo'],
  );
});

test('a 429 caches the place as failed until Retry-After', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia: () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
  });

  const body = await (await get()).json();

  assert.equal(state.saved.length, 2);

  for (const row of state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.fetched_at), 3_600_000);
  }

  assert.deepEqual(body.places[TOKYO_ID], { status: 'ready', about: null, photo: null });
});

test('without WIKIMEDIA_CONTACT nothing is looked up; cached rows still answer', async (t) => {
  useContact(t, null);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [cacheRow(TOKYO_KEY, { expires_at: '2020-01-01T00:00:00.000Z' })],
  });

  const body = await (await get()).json();

  assert.equal(state.searches.length, 0);
  assert.equal(body.places[TOKYO_ID].about.title, 'Tokyo');
  assert.deepEqual(body.places[KYOTO_ID], { status: 'ready', about: null, photo: null });
});

test('candidates are answered too: punctuation is fine and a repeated place is asked once', async (t) => {
  useContact(t);
  const washington = {
    ...tokyoData,
    name: 'Washington, D.C.',
    country: 'US',
    lat: 38.9,
    lng: -77.04,
  };
  const candidate = 'a1b2c3d4-0000-4000-8000-000000000101';
  const repeat = 'a1b2c3d4-0000-4000-8000-000000000102';
  const { state } = setup(t, {
    snapshot: plan({
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(candidate, 'place', washington),
        objectRow(repeat, 'place', kyotoData),
      ],
    }),
    wikipedia,
    rows: [
      cacheRow(placeMediaKey(washington), {
        page_title: 'Washington, D.C.',
        page_url: 'https://en.wikipedia.org/wiki/Washington%2C_D.C.',
        extract: 'Washington, D.C. is the capital of the United States.',
      }),
    ],
  });

  const body = await (await get()).json();

  assert.equal(state.searches.length, 2);
  assert.equal(body.places[candidate].about.title, 'Washington, D.C.');
  assert.deepEqual(body.places[repeat], body.places[KYOTO_ID]);
});

test('a cache failure is a safe 500 that logs only a code', async (t) => {
  useContact(t);
  const { errors } = setup(t, { snapshot: plan(), wikipedia, failRead: true });

  const response = await get();

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not load place details. Try again.');
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'Could not load place details (XX000).',
  ]);
});

test('a malformed WIKIMEDIA_CONTACT is a 500 that names the variable', async (t) => {
  useContact(t, 'not a contact');
  const { errors } = setup(t, { snapshot: plan(), wikipedia });

  const response = await get();

  assert.equal(response.status, 500);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'WIKIMEDIA_CONTACT must be an email address or a URL.',
  ]);
});

test('the contract accepts only our bucket for photos and Wikipedia for articles', () => {
  const photo = (url) => ({
    url,
    thumbUrl: url,
    width: 960,
    height: 640,
    credit: {
      author: 'Kasa Fue',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  });
  const media = (entry) => intentMediaSchema.safeParse({ places: { [TOKYO_ID]: entry } });
  const ready = (overrides) => ({ status: 'ready', about: null, photo: null, ...overrides });
  const bucket = 'https://x.supabase.co/storage/v1/object/public';

  assert.equal(
    media(ready({ photo: photo(`${bucket}/place-photos/ab/cd-960.jpg`) })).success,
    true,
  );
  assert.equal(media(ready({ photo: photo('https://upload.wikimedia.org/x.jpg') })).success, false);
  assert.equal(media(ready({ photo: photo(`${bucket}/avatars/a.jpg`) })).success, false);
  assert.equal(
    media(ready({ photo: photo(`${bucket}/place-photos/../avatars/a.jpg`) })).success,
    false,
  );
  assert.equal(
    media(ready({ about: { title: 'x', extract: 'x', url: 'javascript:alert(1)' } })).success,
    false,
  );
  assert.equal(media({ status: 'pending' }).success, true);
});
