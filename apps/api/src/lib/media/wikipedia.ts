import { z } from 'zod';

import type { Article } from './rules.ts';

const API_URL = 'https://en.wikipedia.org/w/api.php';
const TIMEOUT_MS = 4_000;

/** Wikipedia asked us to slow down (429 or 503). `message` holds only the status code. */
export class WikipediaThrottledError extends Error {
  readonly retryAfter: string | null;

  constructor(status: number, retryAfter: string | null) {
    super(`Wikipedia answered ${status}.`);
    this.retryAfter = retryAfter;
  }
}

/** Any other failed request: an HTTP error, a timeout or an answer we can't read. */
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

async function getJson(url: string, contact: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
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
