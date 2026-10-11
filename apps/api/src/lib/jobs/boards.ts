import { z } from 'zod';

import { jobKey, type Board, type JobSource, type Salary, type WorkMode } from '@nexui/types';

import { compact } from './parts.ts';
import { plainText, titleCase } from './text.ts';

/** One posting as a board's API gives it, in the shape the scan and the lookups use. */
export interface Posting {
  /** `provider:token:job`: the scan's dedupe key. */
  key: string;
  board: Board;
  job: string;
  company: string;
  title: string;
  /** The URL the board gives, often the employer's careers site. Never fetched. */
  url: string;
  location?: string;
  workMode?: WorkMode;
  salary?: Salary;
  /** When it was first posted; never Greenhouse's constantly refreshed `updated_at`. */
  postedAt?: string;
  /** The description as plain text, up to 4,000 characters; empty when a list leaves it out. */
  text: string;
}

export interface BoardDeps {
  /** Sent in the User-Agent so a board can reach us (`NEXUI_CONTACT`). */
  contact: string;
  fetch: typeof fetch;
  /** Ends every request early, such as when the scan's budget runs out. */
  signal?: AbortSignal;
  /** Answers by URL for one run, so an Ashby board is read once however many roles it has. */
  cache?: Map<string, Promise<unknown>>;
}

/** A board request that failed: a timeout, an HTTP error, or an answer that isn't JSON. */
export class BoardError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 10_000;
const PER_HOST = 4;
const MAX_TEXT = 4_000;
const GREENHOUSE = 'https://boards-api.greenhouse.io/v1/boards';
const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board';

const leverApi = (board: Board): string =>
  board.region === 'eu'
    ? 'https://api.eu.lever.co/v0/postings'
    : 'https://api.lever.co/v0/postings';

// Slots per host. A finished request hands its slot straight to the next one waiting.
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

async function slot(host: string): Promise<() => void> {
  const used = active.get(host) ?? 0;

  if (used < PER_HOST) {
    active.set(host, used + 1);
  } else {
    await new Promise<void>((resolve) => {
      waiting.set(host, [...(waiting.get(host) ?? []), resolve]);
    });
  }

  return () => {
    const next = waiting.get(host)?.shift();

    if (next) {
      next();
    } else {
      active.set(host, (active.get(host) ?? 1) - 1);
    }
  };
}

async function request(url: string, deps: BoardDeps): Promise<unknown> {
  const release = await slot(new URL(url).host);

  // The budget may have run out while this waited for its slot.
  if (deps.signal?.aborted) {
    release();

    throw new BoardError('The board did not answer.');
  }

  try {
    const signals = [AbortSignal.timeout(TIMEOUT_MS)];

    if (deps.signal) {
      signals.push(deps.signal);
    }

    let response: Response;

    try {
      response = await deps.fetch(url, {
        headers: { 'User-Agent': `Nexui/1.0 (${deps.contact})`, Accept: 'application/json' },
        signal: AbortSignal.any(signals),
        redirect: 'error',
      });
    } catch {
      throw new BoardError('The board did not answer.');
    }

    if (response.status === 404) {
      await response.body?.cancel();

      return null;
    }

    if (!response.ok) {
      await response.body?.cancel();

      throw new BoardError(`The board answered ${response.status}.`, response.status);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new BoardError('The board sent an unreadable answer.');
    }
  } finally {
    release();
  }
}

/**
 * GETs one board API URL as JSON (spikes note 2.5, item 9): our contact in the User-Agent, a
 * 10-second timeout, at most 4 requests at a time per host, no redirects. Null for a 404, which
 * is how a board says "gone". Anything else that fails throws `BoardError`, whose message holds
 * a status at most.
 */
function getJson(url: string, deps: BoardDeps): Promise<unknown> {
  const cached = deps.cache?.get(url);

  if (cached) {
    return cached;
  }

  const answer = request(url, deps);

  deps.cache?.set(url, answer);

  return answer;
}

const text = z.string().nullable().optional();
const amount = z.number().nullable().optional();

const greenhouseJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: text }).nullable().optional(),
  first_published: text,
  content: text,
  company_name: text,
  pay_input_ranges: z
    .array(z.object({ min_cents: amount, max_cents: amount, currency_type: text }))
    .nullable()
    .optional(),
});

const leverPosting = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: amount,
  categories: z.object({ location: text }).nullable().optional(),
  workplaceType: text,
  descriptionPlain: text,
  salaryRange: z.object({ min: amount, max: amount, currency: text }).nullable().optional(),
});

const ashbyJob = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  location: text,
  workplaceType: text,
  isRemote: z.boolean().nullable().optional(),
  isListed: z.boolean().nullable().optional(),
  publishedAt: text,
  descriptionPlain: text,
  compensation: z
    .object({
      summaryComponents: z
        .array(
          z.object({
            compensationType: text,
            currencyCode: text,
            minValue: amount,
            maxValue: amount,
          }),
        )
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const clean = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed.slice(0, 120) : undefined;
};

// Only an https URL reaches a role.
function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function isoTime(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const time = typeof value === 'number' ? value : Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function workModeOf(value: string | null | undefined): WorkMode | undefined {
  const mode = value?.toLowerCase().replace(/[^a-z]/g, '') ?? '';

  if (mode === 'remote' || mode === 'hybrid' || mode === 'onsite') {
    return mode;
  }

  if (/\bhybrid\b/i.test(value ?? '')) {
    return 'hybrid';
  }

  return /\bremote\b/i.test(value ?? '') ? 'remote' : undefined;
}

function salaryOf(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  divisor = 1,
): Salary | undefined {
  const code = currency?.trim().toUpperCase() ?? '';
  const low = typeof min === 'number' ? Math.round(min / divisor) : undefined;
  const high = typeof max === 'number' ? Math.round(max / divisor) : undefined;

  if (!/^[A-Z]{3}$/.test(code) || (low === undefined && high === undefined)) {
    return undefined;
  }

  if (low !== undefined && high !== undefined && low > high) {
    return undefined;
  }

  return compact<Salary>({ min: low, max: high, currency: code });
}

function posting(
  board: Board,
  job: string,
  fields: Omit<Posting, 'key' | 'board' | 'job'>,
): Posting {
  return compact<Posting>({ key: jobKey({ ...board, job }), board, job, ...fields });
}

function fromGreenhouse(board: Board, job: z.infer<typeof greenhouseJob>): Posting | null {
  const url = httpsUrl(job.absolute_url);
  const location = clean(job.location?.name);
  const pay = job.pay_input_ranges?.[0];

  if (!url) {
    return null;
  }

  return posting(board, String(job.id), {
    company: clean(job.company_name) ?? titleCase(board.token),
    title: job.title.trim().slice(0, 200),
    url,
    location,
    workMode: workModeOf(location),
    salary: salaryOf(pay?.min_cents, pay?.max_cents, pay?.currency_type, 100),
    postedAt: isoTime(job.first_published),
    text: job.content ? plainText(job.content).slice(0, MAX_TEXT) : '',
  });
}

function fromLever(board: Board, job: z.infer<typeof leverPosting>): Posting | null {
  const url = httpsUrl(job.hostedUrl);

  if (!url) {
    return null;
  }

  return posting(board, job.id, {
    company: titleCase(board.token),
    title: job.text.trim().slice(0, 200),
    url,
    location: clean(job.categories?.location),
    workMode: workModeOf(job.workplaceType),
    salary: salaryOf(job.salaryRange?.min, job.salaryRange?.max, job.salaryRange?.currency),
    postedAt: isoTime(job.createdAt),
    text: (job.descriptionPlain ?? '').trim().slice(0, MAX_TEXT),
  });
}

function fromAshby(board: Board, job: z.infer<typeof ashbyJob>): Posting | null {
  const url = httpsUrl(job.jobUrl);
  const pay = job.compensation?.summaryComponents?.find(
    (component) => component.compensationType === 'Salary',
  );

  if (!url || job.isListed === false) {
    return null;
  }

  return posting(board, job.id, {
    company: titleCase(board.token),
    title: job.title.trim().slice(0, 200),
    url,
    location: clean(job.location),
    workMode: job.isRemote ? 'remote' : workModeOf(job.workplaceType),
    salary: salaryOf(pay?.minValue, pay?.maxValue, pay?.currencyCode),
    postedAt: isoTime(job.publishedAt),
    text: (job.descriptionPlain ?? '').trim().slice(0, MAX_TEXT),
  });
}

// One item, parsed and mapped; a malformed item is skipped, not the whole board.
function parsed<T>(
  schema: z.ZodType<T>,
  item: unknown,
  map: (value: T) => Posting | null,
): Posting[] {
  const result = schema.safeParse(item);
  const mapped = result.success ? map(result.data) : null;

  return mapped ? [mapped] : [];
}

// The array under `key` in a board's answer; none for a 404.
function itemsOf(body: unknown, key: string | null): unknown[] {
  if (body === null) {
    return [];
  }

  const items = key === null ? body : (body as Record<string, unknown> | null)?.[key];

  if (!Array.isArray(items)) {
    throw new BoardError('The board sent an unexpected answer.');
  }

  return items;
}

async function readBoard(board: Board, deps: BoardDeps, limit: number): Promise<Posting[]> {
  const token = encodeURIComponent(board.token);

  switch (board.provider) {
    case 'greenhouse':
      return itemsOf(await getJson(`${GREENHOUSE}/${token}/jobs`, deps), 'jobs').flatMap((item) =>
        parsed(greenhouseJob, item, (job) => fromGreenhouse(board, job)),
      );
    case 'lever':
      return itemsOf(
        await getJson(`${leverApi(board)}/${token}?mode=json&limit=${limit}`, deps),
        null,
      ).flatMap((item) => parsed(leverPosting, item, (job) => fromLever(board, job)));
    case 'ashby':
      return itemsOf(
        await getJson(`${ASHBY}/${token}?includeCompensation=true`, deps),
        'jobs',
      ).flatMap((item) => parsed(ashbyJob, item, (job) => fromAshby(board, job)));
  }
}

const newestFirst = (a: Posting, b: Posting): number =>
  (b.postedAt ?? '').localeCompare(a.postedAt ?? '');

/**
 * A company's open roles on its board, newest first (spikes note 2.5, item 5). A Greenhouse list
 * has no descriptions or pay; `readPosting` adds them. Lever's lists are uncompressed and carry
 * every description, so they're capped at `limit`.
 */
export async function listPostings(board: Board, deps: BoardDeps, limit = 300): Promise<Posting[]> {
  return (await readBoard(board, deps, limit)).sort(newestFirst);
}

/**
 * One posting from its board, or null when it's gone (spikes note 2.5, item 4). Greenhouse and
 * Lever answer one GET, 404 when gone. Ashby has no such endpoint, so its board is read (once per
 * run, through `deps.cache`) and the id looked up; its job page can't tell, since it answers 200
 * for any id.
 */
export async function readPosting(
  board: Board,
  job: string,
  deps: BoardDeps,
): Promise<Posting | null> {
  const token = encodeURIComponent(board.token);
  const id = encodeURIComponent(job);

  switch (board.provider) {
    case 'greenhouse': {
      const body = await getJson(`${GREENHOUSE}/${token}/jobs/${id}?pay_transparency=true`, deps);

      return body === null
        ? null
        : (parsed(greenhouseJob, body, (one) => fromGreenhouse(board, one))[0] ?? null);
    }

    case 'lever': {
      const body = await getJson(`${leverApi(board)}/${token}/${id}?mode=json`, deps);

      return body === null
        ? null
        : (parsed(leverPosting, body, (one) => fromLever(board, one))[0] ?? null);
    }

    case 'ashby':
      return (await readBoard(board, deps, 0)).find((one) => one.job === job) ?? null;
  }
}

/**
 * A named company's board (spikes note 2.5, item 7): its name as a token, probed on Greenhouse,
 * Lever, Lever EU and Ashby in turn. The first with open roles wins, since an empty board answers
 * 200 too (Figma's Ashby board, Mistral's Lever board). Null when none has roles.
 */
export async function findBoard(name: string, deps: BoardDeps): Promise<Board | null> {
  const token = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!token) {
    return null;
  }

  const candidates: Board[] = [
    { provider: 'greenhouse', token },
    { provider: 'lever', token },
    { provider: 'lever', token, region: 'eu' },
    { provider: 'ashby', token },
  ];

  for (const board of candidates) {
    try {
      if ((await readBoard(board, deps, 1)).length > 0) {
        return board;
      }
    } catch (error) {
      if (!(error instanceof BoardError)) {
        throw error;
      }
    }
  }

  return null;
}

/** The role's `source`: its board and the board's id for it. */
export function postingSource(found: Posting): JobSource {
  return { ...found.board, job: found.job };
}
