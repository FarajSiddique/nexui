import type { SupabaseClient } from '@supabase/supabase-js';

import { placeDataSchema, placeMediaKey, type GraphSnapshot, type PlaceMedia } from '@nexui/types';

import { logLine } from '#lib/graph';

import { readRows, saveRow } from './cache.ts';
import {
  failedRow,
  isFresh,
  lookupRow,
  matchArticle,
  retryAfterMs,
  toPlaceMedia,
  type LookupPlace,
  type MediaRow,
  type MediaStatus,
} from './rules.ts';
import { searchArticles, WikipediaError, WikipediaThrottledError } from './wikipedia.ts';

/** At most this many lookups start per request, four at a time (spec section 4). */
export const MAX_LOOKUPS = 20;
const CONCURRENCY = 4;
const BUDGET_MS = 6_000;

const PENDING: PlaceMedia = { status: 'pending' };
const NOTHING: PlaceMedia = { status: 'ready', about: null, photo: null };

/** A place to answer for: its graph id, its cache key and what the lookup reads. */
export interface MediaPlace extends LookupPlace {
  id: string;
  key: string;
}

export interface MediaDeps {
  /** The secret-key client: the only one that can read or write `place_media`. */
  db: SupabaseClient;
  /** `WIKIMEDIA_CONTACT`. Null turns lookups off, so only cached places get details. */
  contact: string | null;
  /** Finishes work after the response is sent: `after()` in the route. */
  defer: (task: () => Promise<void>) => void;
  now?: () => Date;
  /** How long the request waits for lookups: 6 seconds unless a test says otherwise. */
  budgetMs?: number;
}

interface LookupResult {
  row: MediaRow;
  throttled: boolean;
}

let warnedOff = false;

/** Every valid place in a snapshot, decision candidates included, with its cache key. */
export function mediaPlaces(snapshot: GraphSnapshot): MediaPlace[] {
  return snapshot.objects.flatMap((object): MediaPlace[] => {
    const parsed = object.kind === 'place' ? placeDataSchema.safeParse(object.data) : null;

    if (!parsed?.success) {
      return [];
    }

    const { name, placeType, lat, lng } = parsed.data;

    return [{ id: object.id, key: placeMediaKey(parsed.data), name, placeType, lat, lng }];
  });
}

function warnLookupsOff(): void {
  if (!warnedOff) {
    warnedOff = true;
    console.error('[media]', 'Lookups are off: WIKIMEDIA_CONTACT is not set.');
  }
}

// Counts only. A failure is worth an error line; otherwise it's a development diagnostic.
function logCounts(counts: Record<MediaStatus, number>): void {
  const total = counts.found + counts.none + counts.failed;
  const line = `looked up ${total}: ${counts.found} found, ${counts.none} none, ${counts.failed} failed.`;

  if (counts.failed > 0) {
    console.error('[media]', line);
  } else if (total > 0 && process.env.NODE_ENV !== 'production') {
    console.info('[media]', line);
  }
}

// One lookup: search, match and cache. Never throws; a failure becomes a `failed` row.
async function lookUp(deps: MediaDeps, contact: string, place: MediaPlace): Promise<LookupResult> {
  const now = deps.now?.() ?? new Date();
  let row: MediaRow;
  let throttled = false;

  try {
    const articles = await searchArticles(place.name, contact);

    row = lookupRow(place.key, matchArticle(place, articles), now);
  } catch (error) {
    if (error instanceof WikipediaThrottledError) {
      throttled = true;
      row = failedRow(place.key, now, retryAfterMs(error.retryAfter, now));
    } else {
      row = failedRow(place.key, now);
    }

    console.error(
      '[media]',
      error instanceof WikipediaError || error instanceof WikipediaThrottledError
        ? error.message
        : 'A lookup failed.',
    );
  }

  try {
    await saveRow(deps.db, row, now);
  } catch (error) {
    console.error('[media]', logLine(error, 'Could not cache a lookup'));
  }

  return { row, throttled };
}

// True when `work` settles within `ms`.
async function settlesWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Looks places up four at a time until the queue is empty, the budget runs out or Wikipedia
// throttles us. Returns the rows finished within the budget; the rest finish through `defer`.
async function lookUpWithin(
  deps: MediaDeps,
  contact: string,
  places: readonly MediaPlace[],
): Promise<Map<string, MediaRow>> {
  const finished = new Map<string, MediaRow>();
  const queue = places.slice(0, MAX_LOOKUPS);
  const budget = deps.budgetMs ?? BUDGET_MS;
  const deadline = Date.now() + budget;
  const counts: Record<MediaStatus, number> = { found: 0, none: 0, failed: 0 };
  let throttled = false;

  const worker = async (): Promise<void> => {
    for (let place = queue.shift(); place; place = queue.shift()) {
      if (throttled || Date.now() >= deadline) {
        return;
      }

      const result = await lookUp(deps, contact, place);

      finished.set(place.key, result.row);
      counts[result.row.status] += 1;
      throttled ||= result.throttled;
    }
  };

  const work = Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() =>
    logCounts(counts),
  );

  if (!(await settlesWithin(work, budget))) {
    deps.defer(() => work);
  }

  return finished;
}

/**
 * Each place's media for the app, by place id (spec section 4). A fresh cache row answers at
 * once. Missing or expired ones are looked up, at most 20 per request and four at a time;
 * those done within the budget answer `ready` and the rest `pending`. Lookups still running at
 * the deadline finish after the response through `defer`; ones never started wait for the
 * app's next request. Without a contact nothing is looked up, and an uncached place answers
 * `ready` with nothing to show.
 */
export async function resolvePlaceMedia(
  deps: MediaDeps,
  places: readonly MediaPlace[],
): Promise<Record<string, PlaceMedia>> {
  const now = deps.now?.() ?? new Date();
  const unique = [...new Map(places.map((place) => [place.key, place])).values()];
  const cached = await readRows(
    deps.db,
    unique.map((place) => place.key),
  );
  const stale = unique.filter((place) => {
    const row = cached.get(place.key);

    return !row || !isFresh(row, now);
  });
  const { contact } = deps;

  if (!contact && stale.length > 0) {
    warnLookupsOff();
  }

  const looked = contact ? await lookUpWithin(deps, contact, stale) : new Map<string, MediaRow>();
  const answers: Record<string, PlaceMedia> = {};

  for (const place of places) {
    const done = looked.get(place.key);
    const row = cached.get(place.key);

    if (done) {
      answers[place.id] = toPlaceMedia(done);
    } else if (row && (!contact || isFresh(row, now))) {
      answers[place.id] = toPlaceMedia(row);
    } else {
      answers[place.id] = contact ? PENDING : NOTHING;
    }
  }

  return answers;
}
