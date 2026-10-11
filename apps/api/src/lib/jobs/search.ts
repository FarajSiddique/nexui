import { z } from 'zod';

import type { SearchData } from '@nexui/types';

import { listOf } from '#lib/capabilities';

/** The six board hosts a web search is limited to (spikes note 3.4, item 2). */
export const BOARD_HOSTS = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
  'jobs.lever.co',
  'jobs.eu.lever.co',
  'jobs.ashbyhq.com',
] as const;

const SEARCH_URL = 'https://api.parallel.ai/v1/search';
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

/** One web search: an objective and up to three keyword queries, from criteria only. */
export interface SearchQuery {
  objective: string;
  queries: string[];
}

/** A web search that failed: a timeout, an HTTP error, or an answer we can't read. */
export class SearchError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Cuts text to the keyword query of 3 to 6 words that Parallel asks for.
 *
 * @example
 * keywords('Staff PM payments London hybrid remote now') // 'Staff PM payments London hybrid remote'
 */
export const keywords = (text: string): string =>
  text.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');

/**
 * The web search for a search's criteria (spikes note 3.4, items 2 and 3), built in code from its
 * roles, places, work modes and industries: never anything from the resume. Null while the
 * search has no roles.
 *
 * @example
 * searchQuery({ roles: ['Staff PM'], locations: ['London'], workModes: ['hybrid'], industries: [] })
 * // { objective: 'Open job postings for Staff PM roles in London.', queries: ['Staff PM London'] }
 */
export function searchQuery(
  search: Pick<SearchData, 'roles' | 'locations' | 'workModes' | 'industries'>,
): SearchQuery | null {
  if (search.roles.length === 0) {
    return null;
  }

  const remote = search.workModes.includes('remote');
  const places = remote ? [...search.locations, 'remote'] : [...search.locations];
  const queries = search.roles.flatMap((role) =>
    places.length > 0
      ? places.map((place) => keywords(`${role} ${place}`))
      : [keywords(`${role} jobs`)],
  );
  const parts = [`Open job postings for ${listOf(search.roles, 'or')} roles`];

  if (search.locations.length > 0) {
    parts.push(` in ${listOf(search.locations, 'or')}`);
  }

  if (remote) {
    parts.push(', remote welcome');
  }

  if (search.industries.length > 0) {
    parts.push(`, in ${listOf(search.industries, 'or')}`);
  }

  return {
    objective: `${parts.join('')}.`.slice(0, 500),
    queries: [...new Set(queries)].slice(0, 3),
  };
}

const answerSchema = z.object({ results: z.array(z.object({ url: z.string() })) });

function onBoardHost(url: string): boolean {
  try {
    return (BOARD_HOSTS as readonly string[]).includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * One Parallel web search (spikes note 3.4): the six board hosts, published in the last
 * `sinceDays` (7 by default), mode `fast`, 10 results, the key in `x-api-key`. Returns the hits'
 * URLs in relevance order, only those on a board host. Its output stays in the plan that asked;
 * nothing is cached across users. Throws `SearchError`, whose message holds a status at most.
 */
export async function searchBoards(
  query: SearchQuery,
  deps: {
    key: string;
    fetch: typeof fetch;
    now: Date;
    sinceDays?: number;
    signal?: AbortSignal;
  },
): Promise<string[]> {
  const after = new Date(deps.now.getTime() - (deps.sinceDays ?? 7) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const signals = [AbortSignal.timeout(TIMEOUT_MS)];

  if (deps.signal) {
    signals.push(deps.signal);
  }

  let response: Response;

  try {
    response = await deps.fetch(SEARCH_URL, {
      method: 'POST',
      redirect: 'error',
      headers: { 'x-api-key': deps.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: query.objective,
        search_queries: query.queries,
        mode: 'fast',
        advanced_settings: {
          source_policy: { include_domains: [...BOARD_HOSTS], after_date: after },
          max_results: 10,
        },
      }),
      signal: AbortSignal.any(signals),
    });
  } catch {
    throw new SearchError('The search did not answer.');
  }

  if (!response.ok) {
    await response.body?.cancel();

    throw new SearchError(`The search answered ${response.status}.`, response.status);
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new SearchError('The search sent an unreadable answer.');
  }

  const parsed = answerSchema.safeParse(body);

  if (!parsed.success) {
    throw new SearchError('The search sent an unexpected answer.');
  }

  return parsed.data.results
    .map((result) => result.url)
    .filter(onBoardHost)
    .slice(0, 10);
}
