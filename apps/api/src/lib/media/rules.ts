import { aboutSchema, normalizePlaceName, type PlaceData, type PlaceMedia } from '@nexui/types';

/** Bumped when the lookup changes what it stores; rows from an older version count as expired. */
export const LOOKUP_VERSION = 1;

export type MediaStatus = 'found' | 'none' | 'failed';

/** A Wikipedia article from the search, with its primary coordinates. */
export interface Article {
  title: string;
  lat: number;
  lng: number;
  /** The lead image's file name from the page-image API, which only gives free files. */
  image: string | null;
  /** The plain-text introduction, up to three sentences; may be empty. */
  extract: string;
}

/** What the lookup reads from a place. */
export type LookupPlace = Pick<PlaceData, 'name' | 'placeType' | 'lat' | 'lng'>;

/** One `place_media` row as the code reads and writes it. */
export interface MediaRow {
  key: string;
  status: MediaStatus;
  lookupVersion: number;
  /** Set by an operator to keep a corrected row; refreshes skip it. */
  pinned: boolean;
  pageTitle: string | null;
  pageUrl: string | null;
  extract: string | null;
  expiresAt: string;
}

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_EXTRACT = 600;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How far an article may sit from the place: 75 km for a region or area, else 25 km. */
export function matchRadiusKm(placeType: PlaceData['placeType']): number {
  return placeType === 'region' || placeType === 'area' ? 75 : 25;
}

// 'Springfield' names 'Springfield' and 'Springfield, Illinois', not 'Springfield Armory'.
function titleNames(title: string, name: string): boolean {
  const wanted = normalizePlaceName(name);
  const comma = title.indexOf(',');

  return (
    normalizePlaceName(title) === wanted ||
    (comma > 0 && normalizePlaceName(title.slice(0, comma)) === wanted)
  );
}

/**
 * The article about a place, or null (spec section 2). Only articles within the radius count;
 * one titled with the place's name wins, else the nearest. Nothing in range means no match.
 *
 * @example
 * matchArticle({ name: 'Amalfi Coast', placeType: 'area', lat: 40.63, lng: 14.6 }, articles);
 * // the 'Amalfi Coast' article, even when 'Duchy of Amalfi' is nearer
 */
export function matchArticle(place: LookupPlace, articles: readonly Article[]): Article | null {
  const radius = matchRadiusKm(place.placeType);
  const inRange = articles
    .map((article) => ({ article, km: distanceKm(place, article) }))
    .filter((entry) => entry.km <= radius)
    .sort((a, b) => a.km - b.km)
    .map((entry) => entry.article);

  return inRange.find((article) => titleNames(article.title, place.name)) ?? inRange[0] ?? null;
}

/**
 * When a row should be looked up again: `found` after 90 days, `none` after 30, and `failed`
 * after 15 minutes or the Retry-After wait, whichever is later (at most a day).
 */
export function expiresAt(status: MediaStatus, now: Date, retryAfterMs = 0): Date {
  switch (status) {
    case 'found':
      return new Date(now.getTime() + 90 * DAY_MS);
    case 'none':
      return new Date(now.getTime() + 30 * DAY_MS);
    case 'failed':
      return new Date(now.getTime() + Math.min(Math.max(15 * MINUTE_MS, retryAfterMs), DAY_MS));
  }
}

/** A pinned row is always used; any other while it's current and from this lookup version. */
export function isFresh(row: MediaRow, now: Date): boolean {
  return (
    row.pinned || (row.lookupVersion >= LOOKUP_VERSION && Date.parse(row.expiresAt) > now.getTime())
  );
}

/**
 * The wait a Retry-After header asks for, in milliseconds: delay-seconds or an HTTP date. 0
 * when it's missing or unreadable.
 *
 * @example
 * retryAfterMs('120', new Date()) // 120000
 */
export function retryAfterMs(header: string | null, now: Date): number {
  const value = header?.trim() ?? '';

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const date = Date.parse(value);

  return Number.isNaN(date) ? 0 : Math.max(0, date - now.getTime());
}

/** An introduction on one line, cut to 600 characters at a word with an ellipsis. */
export function clipExtract(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (clean.length <= MAX_EXTRACT) {
    return clean;
  }

  const cut = clean.slice(0, MAX_EXTRACT - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * @example
 * articleUrl('Springfield, Illinois') // 'https://en.wikipedia.org/wiki/Springfield%2C_Illinois'
 */
export function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function emptyRow(key: string, status: MediaStatus, expires: Date): MediaRow {
  return {
    key,
    status,
    lookupVersion: LOOKUP_VERSION,
    pinned: false,
    pageTitle: null,
    pageUrl: null,
    extract: null,
    expiresAt: expires.toISOString(),
  };
}

/** The row a finished lookup writes: the matched article, or `none`. */
export function lookupRow(key: string, match: Article | null, now: Date): MediaRow {
  if (!match) {
    return emptyRow(key, 'none', expiresAt('none', now));
  }

  return {
    key,
    status: 'found',
    lookupVersion: LOOKUP_VERSION,
    pinned: false,
    pageTitle: match.title.slice(0, 200),
    pageUrl: articleUrl(match.title),
    extract: clipExtract(match.extract),
    expiresAt: expiresAt('found', now).toISOString(),
  };
}

/** The row a failed lookup writes; it's tried again after 15 minutes or the Retry-After wait. */
export function failedRow(key: string, now: Date, retryAfter = 0): MediaRow {
  return emptyRow(key, 'failed', expiresAt('failed', now, retryAfter));
}

/**
 * What the app is told about a row. Only a `found` row with a readable introduction has an
 * `about`; `none` and `failed` rows show nothing. Photos come in phase 2.
 */
export function toPlaceMedia(row: MediaRow): PlaceMedia {
  const about =
    row.status === 'found'
      ? aboutSchema.safeParse({ title: row.pageTitle, extract: row.extract, url: row.pageUrl })
      : null;

  return {
    status: 'ready',
    about: about?.success && about.data.extract.length > 0 ? about.data : null,
    photo: null,
  };
}
