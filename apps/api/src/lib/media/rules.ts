import {
  aboutSchema,
  normalizePlaceName,
  photoCreditSchema,
  photoSchema,
  type PhotoCredit,
  type PlaceData,
  type PlaceMedia,
} from '@nexui/types';

/** Bumped when the lookup changes what it stores; rows from an older version count as expired. */
export const LOOKUP_VERSION = 2;

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

/** An image format we copy, named by its file extension. */
export type ImageType = 'jpg' | 'png' | 'webp';

/** Each format's content type, for the upload. */
export const PHOTO_TYPES: Record<ImageType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** A copied photo as `place_media.photo` holds it: paths in the `place-photos` bucket. */
export interface StoredPhoto {
  /** The 960px copy. */
  path: string;
  /** The 500px copy. */
  thumbPath: string;
  width: number;
  height: number;
}

/** What a lookup adds to a `found` row when its photo was copied. */
export interface CopiedPhoto {
  photo: StoredPhoto;
  credit: PhotoCredit;
}

/** What Commons says about a lead image (request 2), before any rule is applied. */
export interface FileInfo {
  /** The 960px thumbnail, or the original when that is narrower. */
  thumbUrl: string;
  thumbWidth: number;
  thumbHeight: number;
  /** The file's description page. */
  pageUrl: string;
  /** `Artist`, as HTML. */
  artist: string | null;
  license: string | null;
  licenseUrl: string | null;
  nonFree: boolean;
}

/** A photo that passed the rules: where to download its two sizes, and its credit. */
export interface PhotoSource {
  /** 960px. */
  url: string;
  /** 500px. */
  thumbUrl: string;
  width: number;
  height: number;
  credit: PhotoCredit;
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
  /** The copied photo, or null: no usable lead image, a rejected file, or not `found`. */
  photo: StoredPhoto | null;
  credit: PhotoCredit | null;
  expiresAt: string;
}

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_EXTRACT = 600;
const MAX_AUTHOR = 120;
const MAX_LICENSE = 60;
const THUMB_WIDTH = 960;

// Words in a lead image's file name that mark a symbol or a map, not a photo of the place.
const NOT_A_PHOTO = new Set([
  'flag',
  'flags',
  'map',
  'maps',
  'locator',
  'logo',
  'logos',
  'seal',
  'emblem',
  'coa',
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

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

// Text on one line, cut at a word to `max` characters with an ellipsis.
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (clean.length <= max) {
    return clean;
  }

  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An introduction on one line, cut to 600 characters at a word with an ellipsis. */
export function clipExtract(text: string): string {
  return clip(text, MAX_EXTRACT);
}

/**
 * @example
 * articleUrl('Springfield, Illinois') // 'https://en.wikipedia.org/wiki/Springfield%2C_Illinois'
 */
export function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * True when a lead image's file name can be a photo (spec section 2): not an SVG, and not
 * named as a flag, coat of arms (`coa`, `Wappen`), map, locator map, logo, seal or emblem.
 * Words match whole, so 'Flagstaff' passes; `wappen` matches inside German compounds.
 *
 * @example
 * isUsableImage('Museumsinsel_Berlin.jpg') // true
 * isUsableImage('Coat_of_arms_of_Berlin.png') // false
 */
export function isUsableImage(file: string): boolean {
  const name = file.toLowerCase();

  if (name.endsWith('.svg') || name.includes('wappen') || /coat[\s_-]+of[\s_-]+arms/.test(name)) {
    return false;
  }

  const words = name.replace(/\.[a-z0-9]+$/, '').split(/[^\p{L}\p{N}]+/u);

  return !words.some((word) => NOT_A_PHOTO.has(word));
}

// One HTML entity as text; an unknown one stays as written.
function decodeEntity(entity: string, name: string): string {
  if (name.startsWith('#')) {
    const hex = name[1]?.toLowerCase() === 'x';
    const code = hex ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  }

  return ENTITIES[name.toLowerCase()] ?? entity;
}

/**
 * Commons' `Artist` HTML as plain text on one line, at most 120 characters: tags dropped and
 * entities decoded.
 *
 * @example
 * plainText('<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>') // 'Kasa Fue'
 */
export function plainText(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => decodeEntity(entity, name))
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:])/g, '$1');

  return clip(text, MAX_AUTHOR);
}

/**
 * The image format from a file's first bytes: JPEG, PNG or WebP, else null.
 *
 * @example imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])) // 'jpg'
 */
export function imageType(bytes: Uint8Array): ImageType | null {
  const text = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to));

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }

  if (text(0, 8) === '\x89PNG\r\n\x1a\n') {
    return 'png';
  }

  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    return 'webp';
  }

  return null;
}

// The URL when it's https on that host, else null.
function httpsOn(value: string, host: string): URL | null {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname === host ? url : null;
  } catch {
    return null;
  }
}

// A licence link as an http(s) URL; Commons sometimes leaves off the scheme.
function licenseLink(value: string | null): string | null {
  const raw = value?.trim() ?? '';

  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The photo that request 2 describes, or null when it fails the rules (spec section 2). It needs:
 * - a licence that isn't marked non-free;
 * - a 960px thumbnail on upload.wikimedia.org;
 * - a file page on Commons.
 *
 * The 500px URL is the 960px one with the width replaced; both are standard Wikimedia widths.
 *
 * @example
 * photoSource(info)?.thumbUrl
 * // 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/500px-Berlin.jpg'
 */
export function photoSource(info: FileInfo): PhotoSource | null {
  const license = clip(info.license ?? '', MAX_LICENSE);
  const large = httpsOn(info.thumbUrl, 'upload.wikimedia.org');
  const page = httpsOn(info.pageUrl, 'commons.wikimedia.org');
  const height = info.thumbHeight;

  if (info.nonFree || license.length === 0 || !large || !page) {
    return null;
  }

  if (info.thumbWidth !== THUMB_WIDTH || !Number.isInteger(height) || height <= 0) {
    return null;
  }

  // A narrower original comes back as itself, with no width in its URL.
  const small = large.href.replace(/\/960px-([^/]+)$/, '/500px-$1');

  if (small === large.href) {
    return null;
  }

  const credit: PhotoCredit = {
    author: plainText(info.artist ?? ''),
    license,
    sourceUrl: page.href,
  };
  const licenseUrl = licenseLink(info.licenseUrl);

  if (licenseUrl) {
    credit.licenseUrl = licenseUrl;
  }

  const parsed = photoCreditSchema.safeParse(credit);

  return parsed.success
    ? { url: large.href, thumbUrl: small, width: THUMB_WIDTH, height, credit: parsed.data }
    : null;
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
    photo: null,
    credit: null,
    expiresAt: expires.toISOString(),
  };
}

/** The row a finished lookup writes: the matched article and its copied photo, or `none`. */
export function lookupRow(
  key: string,
  match: Article | null,
  now: Date,
  copied: CopiedPhoto | null = null,
): MediaRow {
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
    photo: copied?.photo ?? null,
    credit: copied?.credit ?? null,
    expiresAt: expiresAt('found', now).toISOString(),
  };
}

/** The row a failed lookup writes; it's tried again after 15 minutes or the Retry-After wait. */
export function failedRow(key: string, now: Date, retryAfter = 0): MediaRow {
  return emptyRow(key, 'failed', expiresAt('failed', now, retryAfter));
}

/**
 * What the app is told about a row. Only a `found` row has an `about` (with a readable
 * introduction) or a `photo`, whose URLs `photoUrl` builds from the stored paths. A photo the
 * contract rejects, such as one on a local http Supabase, is left out rather than failing the
 * whole answer.
 */
export function toPlaceMedia(row: MediaRow, photoUrl: (path: string) => string): PlaceMedia {
  const found = row.status === 'found';
  const about = found
    ? aboutSchema.safeParse({ title: row.pageTitle, extract: row.extract, url: row.pageUrl })
    : null;
  const photo =
    found && row.photo && row.credit
      ? photoSchema.safeParse({
          url: photoUrl(row.photo.path),
          thumbUrl: photoUrl(row.photo.thumbPath),
          width: row.photo.width,
          height: row.photo.height,
          credit: row.credit,
        })
      : null;

  return {
    status: 'ready',
    about: about?.success && about.data.extract.length > 0 ? about.data : null,
    photo: photo?.success ? photo.data : null,
  };
}
