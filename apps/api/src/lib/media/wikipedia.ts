import { z } from 'zod';

import { imageType, type Article, type FileInfo, type ImageType } from './rules.ts';

const API_URL = 'https://en.wikipedia.org/w/api.php';
const TIMEOUT_MS = 4_000;
const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

/** The largest image we copy, in bytes: 2 MB, as the bucket allows. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** A downloaded image: its bytes and the format they show. */
export interface ImageFile {
  bytes: Uint8Array;
  type: ImageType;
}

/** Wikipedia or Commons asked us to slow down (429 or 503). `message` holds only the status code. */
export class WikipediaThrottledError extends Error {
  readonly retryAfter: string | null;

  constructor(status: number, retryAfter: string | null) {
    super(`Wikipedia answered ${status}.`);
    this.retryAfter = retryAfter;
  }
}

/** Any other failed request: an HTTP error, a timeout, a redirect or an answer we can't read. */
export class WikipediaError extends Error {}

const searchSchema = z.object({
  error: z.unknown().optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            title: z.string(),
            index: z.number().optional(),
            coordinates: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
            pageimage: z.string().optional(),
            extract: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const fileInfoSchema = z.object({
  error: z.unknown().optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            missing: z.boolean().optional(),
            imageinfo: z
              .array(
                z.object({
                  thumburl: z.string().optional(),
                  thumbwidth: z.number().optional(),
                  thumbheight: z.number().optional(),
                  descriptionurl: z.string().optional(),
                  extmetadata: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/** The User-Agent Wikimedia asks every client to send, with a way to reach us. */
export function userAgent(contact: string): string {
  return `Nexui/1.0 (${contact})`;
}

// Request 1: search, with each result's coordinates, lead image and three-sentence intro.
function searchUrl(name: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: name,
    gsrnamespace: '0',
    gsrlimit: '5',
    prop: 'pageimages|coordinates|extracts',
    piprop: 'name',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '5',
  });

  return `${API_URL}?${params.toString()}`;
}

// One request with our User-Agent and the 4-second timeout. A throttle or an HTTP error throws.
async function send(url: string, contact: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': userAgent(contact) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WikipediaError('Wikipedia did not answer.');
  }

  if (response.status === 429 || response.status === 503) {
    throw new WikipediaThrottledError(response.status, response.headers.get('Retry-After'));
  }

  if (!response.ok) {
    throw new WikipediaError(`Wikipedia answered ${response.status}.`);
  }

  return response;
}

async function getJson(url: string, contact: string): Promise<unknown> {
  const response = await send(url, contact);

  try {
    return await response.json();
  } catch {
    throw new WikipediaError('Wikipedia sent an unreadable answer.');
  }
}

/**
 * The top five articles for a name (spec section 2, request 1), in search order. Articles
 * without coordinates are left out, since they can't be matched.
 */
export async function searchArticles(name: string, contact: string): Promise<Article[]> {
  const parsed = searchSchema.safeParse(await getJson(searchUrl(name), contact));

  if (!parsed.success || parsed.data.error !== undefined) {
    throw new WikipediaError('Wikipedia sent an unexpected answer.');
  }

  const pages = [...(parsed.data.query?.pages ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );

  return pages.flatMap((page): Article[] => {
    const point = page.coordinates?.[0];

    if (!point) {
      return [];
    }

    return [
      {
        title: page.title,
        lat: point.lat,
        lng: point.lon,
        image: page.pageimage ?? null,
        extract: page.extract ?? '',
      },
    ];
  });
}

// Request 2: the file's 960px thumbnail and its credit metadata, from Commons.
function fileInfoUrl(file: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|NonFree',
    iiextmetadatalanguage: 'en',
  });

  return `${COMMONS_API_URL}?${params.toString()}`;
}

// One extmetadata field as text, or null when it's missing or blank.
function metaText(
  meta: Record<string, { value: unknown }> | undefined,
  name: string,
): string | null {
  const value = meta?.[name]?.value;

  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * What Commons says about a lead image (spec section 2, request 2), or null when the file isn't
 * on Commons or has no thumbnail. `photoSource` decides whether it's used.
 */
export async function fileInfo(file: string, contact: string): Promise<FileInfo | null> {
  const parsed = fileInfoSchema.safeParse(await getJson(fileInfoUrl(file), contact));

  if (!parsed.success || parsed.data.error !== undefined) {
    throw new WikipediaError('Commons sent an unexpected answer.');
  }

  const page = parsed.data.query?.pages?.[0];
  const info = page?.imageinfo?.[0];

  if (
    !page ||
    page.missing ||
    !info?.thumburl ||
    !info.descriptionurl ||
    info.thumbwidth === undefined ||
    info.thumbheight === undefined
  ) {
    return null;
  }

  const meta = info.extmetadata;
  const nonFree = metaText(meta, 'NonFree');

  return {
    thumbUrl: info.thumburl,
    thumbWidth: info.thumbwidth,
    thumbHeight: info.thumbheight,
    pageUrl: info.descriptionurl,
    artist: metaText(meta, 'Artist'),
    license: metaText(meta, 'LicenseShortName'),
    licenseUrl: metaText(meta, 'LicenseUrl'),
    nonFree: nonFree !== null && nonFree.trim().toLowerCase() !== 'false',
  };
}

/**
 * Downloads one size of a photo, without following redirects. Null when it isn't a JPEG, PNG
 * or WebP by its first bytes, or is over 2 MB: such a file never becomes a photo. A throttle,
 * an HTTP error, a redirect or a timeout throws, so the lookup is tried again.
 */
export async function downloadImage(url: string, contact: string): Promise<ImageFile | null> {
  const response = await send(url, contact, { redirect: 'error' });

  if (Number(response.headers.get('Content-Length') ?? 0) > MAX_PHOTO_BYTES) {
    await response.body?.cancel();

    return null;
  }

  let bytes: Uint8Array;

  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new WikipediaError('Wikipedia did not answer.');
  }

  const type = imageType(bytes);

  return type && bytes.byteLength <= MAX_PHOTO_BYTES ? { bytes, type } : null;
}
