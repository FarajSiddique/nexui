// Stand-ins for the place media code's network: Supabase's snapshot function and
// `place_media` table, and Wikipedia's API. Used by the lookup and media route tests.
import { getAdminClient } from '../../apps/api/src/lib/supabase/clients.ts';
import { pgError } from './graph-api.mjs';
import { supabaseEnv } from './supabase-auth.mjs';

export const CONTACT = 'ops@nexui.test';
export const NOW = new Date('2026-10-04T12:00:00Z');

/** The first bytes of a JPEG: enough for the lookup to accept it as one. */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/**
 * A Commons imageinfo answer (formatversion 2) for one file, with a 960px thumbnail, a CC BY-SA
 * licence and Kasa Fue as the author. Like the live API since 2026, the thumbnail is on
 * thumb.wikimedia.org with a tracking query. `overrides` replace fields of its `imageinfo` entry.
 */
export function fileInfoBody(file, overrides = {}) {
  return {
    batchcomplete: true,
    query: {
      pages: [
        {
          pageid: 1,
          ns: 6,
          title: `File:${file}`,
          imagerepository: 'local',
          imageinfo: [
            {
              thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/960px-${file}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
              thumbwidth: 960,
              thumbheight: 640,
              url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
              extmetadata: {
                Artist: {
                  value: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
                  source: 'commons-desc-page',
                },
                LicenseShortName: { value: 'CC BY-SA 4.0', source: 'commons-desc-page' },
                LicenseUrl: {
                  value: 'https://creativecommons.org/licenses/by-sa/4.0',
                  source: 'commons-desc-page',
                },
              },
              ...overrides,
            },
          ],
        },
      ],
    },
  };
}

/** A Wikipedia search answer (formatversion 2) with these pages, in search order. */
export function searchBody(pages) {
  return {
    batchcomplete: true,
    query: {
      pages: pages.map((page, index) => ({ pageid: index + 1, ns: 0, index: index + 1, ...page })),
    },
  };
}

/** One search result with its primary coordinates. */
export function article(title, lat, lon, extract = `${title} is a place.`) {
  return { title, coordinates: [{ lat, lon, primary: true, globe: 'earth' }], extract };
}

/** A `place_media` row as PostgREST returns it: `found` and current unless overridden. */
export function cacheRow(key, overrides = {}) {
  return {
    key,
    status: 'found',
    lookup_version: 2,
    pinned: false,
    page_title: 'Tokyo',
    page_url: 'https://en.wikipedia.org/wiki/Tokyo',
    extract: 'Tokyo is the capital of Japan.',
    photo: null,
    credit: null,
    fetched_at: '2026-10-01T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// The values of PostgREST's `in.(a,b,"c,d")` filter, as supabase-js writes it.
function inList(filter) {
  const inner = filter?.match(/^in\.\((.*)\)$/)?.[1] ?? '';

  return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map(
    ([, quoted, plain]) => quoted ?? plain,
  );
}

/**
 * Routes fetch for the media code. `snapshot` answers `get_intent_snapshot`, `rows` seed the
 * cache, and `wikipedia(url)` answers each search with a Response or a promise of one.
 * `commons(url)` answers request 2 (default: the file is missing), `images(url)` answers each
 * download (default: a JPEG), and `failUpload(path)` makes that upload fail. `failRead` and
 * `failWrite` make the cache's reads or writes fail. `state` records the searches, request 2s,
 * downloads and uploads made, and the rows saved.
 */
export function mediaUpstream({
  snapshot = null,
  rows = [],
  wikipedia = () => Response.json(searchBody([])),
  commons = () =>
    Response.json({
      batchcomplete: true,
      query: { pages: [{ ns: 6, title: 'File:Missing.jpg', missing: true }] },
    }),
  images = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }),
  failRead = false,
  failWrite = false,
  failUpload = () => false,
} = {}) {
  const state = {
    rows: new Map(rows.map((row) => [row.key, row])),
    searches: [],
    infos: [],
    downloads: [],
    uploads: [],
    saved: [],
    reads: 0,
  };

  const handler = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');

    if (url.hostname === 'commons.wikimedia.org') {
      state.infos.push({ url, headers: new Headers(init.headers) });

      return commons(url);
    }

    if (url.hostname === 'thumb.wikimedia.org' || url.hostname === 'upload.wikimedia.org') {
      state.downloads.push({ url, headers: new Headers(init.headers), redirect: init.redirect });

      return images(url);
    }

    const stored = url.pathname.match(/^\/storage\/v1\/object\/place-photos\/(.+)$/);

    if (stored && method === 'POST') {
      if (failUpload(stored[1])) {
        return Response.json(
          { statusCode: '500', error: 'internal', message: 'internal detail' },
          { status: 500 },
        );
      }

      state.uploads.push({ path: stored[1], headers: new Headers(init.headers), body: init.body });

      return Response.json({
        Id: `upload-${state.uploads.length}`,
        Key: `place-photos/${stored[1]}`,
      });
    }

    if (url.hostname === 'en.wikipedia.org') {
      state.searches.push({ url, headers: new Headers(init.headers) });

      return wikipedia(url);
    }

    if (url.pathname === '/rest/v1/rpc/get_intent_snapshot') {
      return Response.json(snapshot);
    }

    if (url.pathname === '/rest/v1/place_media' && method === 'GET') {
      state.reads += 1;

      if (failRead) {
        return pgError('XX000', 500);
      }

      const keys = inList(url.searchParams.get('key'));

      return Response.json(
        keys.flatMap((key) => (state.rows.has(key) ? [state.rows.get(key)] : [])),
      );
    }

    if (url.pathname === '/rest/v1/place_media' && method === 'POST') {
      if (failWrite) {
        return pgError('42501', 403);
      }

      const row = JSON.parse(init.body);

      state.saved.push(row);
      state.rows.set(row.key, { pinned: false, ...row });

      return new Response(null, { status: 201 });
    }

    return Response.json({ message: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  return { state, handler };
}

/** Sets WIKIMEDIA_CONTACT for one test; `null` unsets it. */
export function useContact(t, value = CONTACT) {
  const previous = process.env.WIKIMEDIA_CONTACT;

  if (value === null) {
    delete process.env.WIKIMEDIA_CONTACT;
  } else {
    process.env.WIKIMEDIA_CONTACT = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env.WIKIMEDIA_CONTACT;
    } else {
      process.env.WIKIMEDIA_CONTACT = previous;
    }
  });
}

/** The secret-key client the route uses, for calling the lookup directly. */
export function adminDb() {
  return getAdminClient(supabaseEnv);
}
