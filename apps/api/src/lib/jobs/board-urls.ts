import { boardSchema, type Board } from '@nexui/types';

import { BoardError, readPosting, type BoardDeps, type Posting } from './boards.ts';

/** What Nexui says about a URL that isn't a job board's (job search spec, section 5.5). */
export const NOT_A_BOARD =
  'Nexui can add roles from Greenhouse, Lever and Ashby job pages for now.';

export type BoardLink =
  | { kind: 'posting'; board: Board; job: string }
  | { kind: 'board'; board: Board }
  // An employer's careers site naming a Greenhouse job, until `resolveCareersLink` confirms it.
  | { kind: 'careers'; host: string; job: string; tokens: string[] };

const GREENHOUSE_HOSTS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);
const LEVER_HOSTS = new Map<string, 'eu' | null>([
  ['jobs.lever.co', null],
  ['jobs.eu.lever.co', 'eu'],
]);
const ASHBY_HOST = 'jobs.ashbyhq.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,12}$/;
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

function board(
  provider: Board['provider'],
  token: string | undefined,
  region?: 'eu' | null,
): Board | null {
  const candidate: Record<string, unknown> = { provider, token };

  if (region) {
    candidate.region = region;
  }

  const result = boardSchema.safeParse(candidate);

  return result.success ? result.data : null;
}

function posting(found: Board | null, job: string | undefined, pattern: RegExp): BoardLink | null {
  return found && job && pattern.test(job) ? { kind: 'posting', board: found, job } : null;
}

/**
 * Greenhouse tokens to try for a careers site's host (spikes note 2.4): its labels without
 * `www`, `careers`, `jobs` and the TLD, each also without a trailing careers, jobs or hq.
 *
 * @example
 * careersTokens('www.datadoghq.com') // ['datadoghq', 'datadog']
 */
export function careersTokens(host: string): string[] {
  const labels = host
    .split('.')
    .slice(0, -1)
    .filter((label) => !['www', 'careers', 'jobs'].includes(label));
  const tokens = labels
    .flatMap((label) => [label, label.replace(/(careers|jobs|hq)$/, '')])
    .filter((token) => /^[a-z0-9-]{2,80}$/.test(token));

  return [...new Set(tokens)].slice(0, 3);
}

/**
 * The board a pasted or found URL points at (spikes note 2.4), or null for any other URL, which
 * Nexui never fetches. Board hosts must match exactly; a URL with credentials, a port or an IP
 * host is refused. An employer's careers site counts only with Greenhouse's `gh_jid`, and only
 * once `resolveCareersLink` confirms it.
 */
export function parseBoardUrl(raw: string): BoardLink | null {
  let url: URL;
  let parts: string[];

  try {
    url = new URL(raw.trim());
    parts = url.pathname
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }

  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const [first, second, third] = parts;

  if (GREENHOUSE_HOSTS.has(host)) {
    if (first === 'embed') {
      return posting(
        board('greenhouse', url.searchParams.get('for') ?? undefined),
        url.searchParams.get('token') ?? undefined,
        NUMBER,
      );
    }

    if (second === 'jobs') {
      return posting(board('greenhouse', first), third, NUMBER);
    }

    const found = parts.length === 1 ? board('greenhouse', first) : null;

    return found ? { kind: 'board', board: found } : null;
  }

  const leverRegion = LEVER_HOSTS.get(host);

  if (leverRegion !== undefined || host === ASHBY_HOST) {
    const provider = host === ASHBY_HOST ? 'ashby' : 'lever';
    const found = board(provider, first, leverRegion);
    const suffix = provider === 'ashby' ? 'application' : 'apply';

    if (parts.length === 1) {
      return found ? { kind: 'board', board: found } : null;
    }

    if (parts.length === 2 || (parts.length === 3 && third === suffix)) {
      return posting(found, second, UUID);
    }

    return null;
  }

  const job = url.searchParams.get('gh_jid') ?? '';

  if (NUMBER.test(job) && host.includes('.') && !IP_HOST.test(host)) {
    const tokens = careersTokens(host);

    return tokens.length > 0 ? { kind: 'careers', host, job, tokens } : null;
  }

  return null;
}

/**
 * Confirms a careers-site link without fetching the site (spikes note 2.4): reads the job from
 * Greenhouse under each guessed token, and accepts it only when the posting's own URL has the
 * pasted host. A third-party careers host (Lyft's) stays refused.
 */
export async function resolveCareersLink(
  link: Extract<BoardLink, { kind: 'careers' }>,
  deps: BoardDeps,
): Promise<Posting | null> {
  for (const token of link.tokens) {
    let found: Posting | null;

    try {
      found = await readPosting({ provider: 'greenhouse', token }, link.job, deps);
    } catch (error) {
      if (error instanceof BoardError) {
        continue;
      }

      throw error;
    }

    if (found && new URL(found.url).hostname.toLowerCase() === link.host) {
      return found;
    }
  }

  return null;
}

/** The posting a link names, read from its board; null for a board link, or a posting gone. */
export async function postingFor(link: BoardLink, deps: BoardDeps): Promise<Posting | null> {
  if (link.kind === 'posting') {
    return readPosting(link.board, link.job, deps);
  }

  if (link.kind === 'careers') {
    return resolveCareersLink(link, deps);
  }

  return null;
}
