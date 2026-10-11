import type { Experimental_EvaluationModel, LanguageModel } from 'ai';

import {
  jobKey,
  searchParts,
  type Board,
  type CompanyData,
  type DocumentData,
  type Fit,
  type GraphSnapshot,
  type OpportunityData,
  type ResumeProfile,
  type SearchData,
} from '@nexui/types';

import type { GatewayOptions } from '#lib/ai';
import type { RunUsage } from '#lib/runs';
import type { TemplateWorkJob } from '#lib/templates';

import { parseBoardUrl, type BoardLink } from './board-urls.ts';
import {
  BoardError,
  findBoard,
  listPostings,
  postingSource,
  readPosting,
  type BoardDeps,
  type Posting,
} from './boards.ts';
import { readJobsConfig, type JobsConfig } from './config.ts';
import { jobsContext } from './context.ts';
import { explainFits, type FitWords } from './explain.ts';
import { compact } from './parts.ts';
import { companyKey, isExcluded, type RoleInput } from './roles.ts';
import { PARTIAL_FIT, personOf, scoreRoles, STRONG_FIT } from './score.ts';
import { SearchError, searchBoards, searchQuery } from './search.ts';
import { matchesRole } from './text.ts';

/** The most candidates a scan confirms and scores (job search spec, section 8). */
export const MAX_CANDIDATES = 25;

/** The most roles a scan puts in New (spec section 0: at most 3 a day). */
export const MAX_NEW = 3;

/**
 * The find phase's share of the scan's budget (Decision 11): the named boards and the search's
 * hits stop here, so Jev and the explain call keep the rest.
 */
export const FIND_BUDGET_MS = 25_000;

const MAX_NAMED = 5;
const PER_COMPANY = 10;
const DAY_MS = 86_400_000;

/** What a scan reads from the plan. */
export interface ScanInput {
  search: SearchData;
  profile: ResumeProfile | null;
  /** Companies the user named, with their board when it's known. */
  targets: { id: string; name: string; board?: Board }[];
  /** Keys the plan has or a scan considered: never scored twice. */
  known: ReadonlySet<string>;
  /** Only roles posted in the last this-many days, or null for any age (the build's scan). */
  sinceDays: number | null;
}

export interface ScanDeps {
  config: JobsConfig;
  fetch: typeof fetch;
  now: Date;
  /** The scan's budget: every board request and the search stop when it runs out. */
  signal: AbortSignal;
  evaluation: { model: Experimental_EvaluationModel; providerOptions: GatewayOptions };
  explain: { model: LanguageModel; providerOptions: GatewayOptions };
}

/** A role the scan surfaces: what `jobs.surfaceMatches` adds, with its fit. */
export type FoundRole = RoleInput & { fit: Fit };

export interface ScanResult {
  /** At most 3, at 0.85 or higher, best first. */
  roles: FoundRole[];
  /** The best from 0.6 up to 0.85, for the partial-fit card. */
  partial: FoundRole | null;
  /**
   * The keys this scan showed or dropped, for `context.jobs.seen`. A fit the caps left out stays
   * unseen, so the next scan can surface it (Decision 19).
   */
  seen: string[];
  /** Boards found for named companies. */
  boards: { companyId: string; board: Board }[];
  /** The explain call's usage, when it ran. */
  usage: RunUsage | null;
}

/**
 * What a scan reads from a plan: the criteria, the resume's profile, the named companies, and
 * the keys of roles it has (in any stage) or has considered. Null without a search.
 */
export function scanInput(
  snapshot: GraphSnapshot,
  searchId: string,
  sinceDays: number | null,
): ScanInput | null {
  const search = snapshot.objects.find(
    (object) => object.id === searchId && object.kind === 'search',
  );

  if (!search) {
    return null;
  }

  const { roles, companies, documents } = searchParts(snapshot, searchId);
  const resume = documents.find((doc) => (doc.data as DocumentData).docType === 'resume');
  const held = roles.flatMap((role) => {
    const source = (role.data as OpportunityData).source;

    return source ? [jobKey(source)] : [];
  });

  return {
    search: search.data as SearchData,
    profile: (resume?.data as DocumentData | undefined)?.profile ?? null,
    targets: companies
      .filter((company) => (company.data as CompanyData).target)
      .map((company) => {
        const data = company.data as CompanyData;

        return compact({ id: company.id, name: data.name, board: data.board });
      }),
    known: new Set([...(jobsContext(snapshot.intent)?.seen ?? []), ...held]),
    sinceDays,
  };
}

// A board or search failure skips that step; anything else is a bug and propagates.
async function safely<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BoardError || error instanceof SearchError) {
      return null;
    }

    throw error;
  }
}

function fresh(posting: Posting, sinceDays: number | null, now: Date): boolean {
  if (sinceDays === null) {
    return true;
  }

  return (
    posting.postedAt !== undefined &&
    now.getTime() - Date.parse(posting.postedAt) <= sinceDays * DAY_MS
  );
}

type PostingLink = Extract<BoardLink, { kind: 'posting' }>;

// Step 1a: one named company's open roles that match a target role, with its board when this
// scan found it. A company whose board can't be read contributes nothing.
async function namedRoles(
  target: ScanInput['targets'][number],
  input: ScanInput,
  deps: ScanDeps,
  boardDeps: BoardDeps,
): Promise<{ found: ScanResult['boards'][number] | null; postings: Posting[] }> {
  const board = target.board ?? (await safely(() => findBoard(target.name, boardDeps)));

  if (!board) {
    return { found: null, postings: [] };
  }

  const listed = (await safely(() => listPostings(board, boardDeps))) ?? [];
  const postings = listed
    .filter((posting) => matchesRole(posting.title, input.search.roles))
    .filter((posting) => fresh(posting, input.sinceDays, deps.now))
    .slice(0, PER_COMPANY)
    .map((posting) => ({ ...posting, company: target.name }));

  return { found: target.board ? null : { companyId: target.id, board }, postings };
}

// Steps 1–3: named companies' boards, then one web search's hits, each confirmed on its board,
// minus what the plan has seen and the companies it never shows. The companies are read at once,
// and so are the hits, within the find phase's own budget (Decision 11), so one slow board
// can't use up the scan's time.
async function findCandidates(
  input: ScanInput,
  deps: ScanDeps,
  contact: string,
): Promise<{ candidates: Posting[]; boards: ScanResult['boards'] }> {
  const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(FIND_BUDGET_MS)]);
  const boardDeps: BoardDeps = { contact, fetch: deps.fetch, signal, cache: new Map() };
  const boards: ScanResult['boards'] = [];
  const pool: Posting[] = [];
  const employer = input.profile?.currentEmployer;
  // The current employer never surfaces, even if a model edited the never-show list.
  const isEmployer = (posting: Posting): boolean =>
    employer !== undefined &&
    [posting.company, posting.board.token].some(
      (name) => companyKey(name) === companyKey(employer),
    );
  const add = (posting: Posting): void => {
    const wanted =
      pool.length < MAX_CANDIDATES &&
      !input.known.has(posting.key) &&
      !pool.some((other) => other.key === posting.key) &&
      !isExcluded(input.search, posting.company, posting.board.token) &&
      !isEmployer(posting);

    if (wanted) {
      pool.push(posting);
    }
  };
  const named = await Promise.all(
    input.targets.slice(0, MAX_NAMED).map((target) => namedRoles(target, input, deps, boardDeps)),
  );

  // In the user's order, so the cap favours the companies they named first.
  for (const { found, postings } of named) {
    if (found) {
      boards.push(found);
    }

    postings.forEach(add);
  }

  const query = searchQuery(input.search);
  const key = deps.config.searchKey;

  if (key && query && pool.length < MAX_CANDIDATES) {
    const urls =
      (await safely(() =>
        searchBoards(query, { key, fetch: deps.fetch, now: deps.now, signal }),
      )) ?? [];
    const links: PostingLink[] = [];

    for (const url of urls) {
      const link = parseBoardUrl(url);

      if (link?.kind === 'posting' && !input.known.has(jobKey({ ...link.board, job: link.job }))) {
        links.push(link);
      }
    }

    // Every hit at once; `add` keeps the relevance order and the cap.
    const hits = await Promise.all(
      links.map((link) => safely(() => readPosting(link.board, link.job, boardDeps))),
    );

    for (const hit of hits) {
      if (hit) {
        add(hit);
      }
    }
  }

  // Step 2, confirm: a Greenhouse list has no text or pay, so those are read one by one, which
  // also proves each is still listed.
  const confirmed = await Promise.all(
    pool.map(async (posting) => {
      if (posting.text || posting.board.provider !== 'greenhouse') {
        return posting;
      }

      const detail = await safely(() => readPosting(posting.board, posting.job, boardDeps));

      return detail ? { ...detail, company: posting.company } : null;
    }),
  );

  return { candidates: confirmed.filter((posting) => posting !== null), boards };
}

/** Candidates by probability, ties to the newer posting (spikes note 4.1, item 3). */
export function rankRoles(
  candidates: readonly Pick<Posting, 'key' | 'postedAt'>[],
  scores: ReadonlyMap<string, number>,
): { strong: Posting[]; partial: Posting | null } {
  const score = (key: string): number => scores.get(key) ?? 0;
  const ranked = [...candidates].sort(
    (a, b) => score(b.key) - score(a.key) || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''),
  ) as Posting[];

  return {
    strong: ranked.filter((one) => score(one.key) >= STRONG_FIT).slice(0, MAX_NEW),
    partial:
      ranked.find((one) => score(one.key) >= PARTIAL_FIT && score(one.key) < STRONG_FIT) ?? null,
  };
}

function foundRole(posting: Posting, score: number, words: FitWords): FoundRole {
  return compact({
    company: compact({ name: posting.company, board: posting.board }),
    title: posting.title,
    url: posting.url,
    source: postingSource(posting),
    location: posting.location,
    workMode: posting.workMode,
    salary: posting.salary,
    postedAt: posting.postedAt,
    fit: { score: Math.round(score * 100) / 100, reasons: words.reasons, gaps: words.gaps },
  });
}

/**
 * The scan (job search spec, section 5.4): finds candidates on the named companies' boards and
 * through one web search, confirms each on its board, skips what the plan has seen and the
 * companies it never shows, scores the rest with one Jev call, explains the best with one
 * fast-tier call, and picks at most 3 for New and 1 partial fit. A failed score or explain
 * surfaces nothing and leaves `seen` alone, so the next scan tries again; boards it found are
 * kept either way. Without a contact for the boards it does nothing.
 */
export async function scanForRoles(input: ScanInput, deps: ScanDeps): Promise<ScanResult> {
  const nothing = (boards: ScanResult['boards']): ScanResult => ({
    roles: [],
    partial: null,
    seen: [],
    boards,
    usage: null,
  });
  const contact = deps.config.contact;

  if (!contact) {
    return nothing([]);
  }

  const { candidates, boards } = await findCandidates(input, deps, contact);

  if (candidates.length === 0) {
    return nothing(boards);
  }

  const person = personOf(input.search, input.profile);
  let scores: Map<string, number>;

  try {
    scores = await scoreRoles(person, candidates, deps.evaluation, deps.signal);
  } catch {
    console.error('[jobs]', 'Scoring roles failed.');

    return nothing(boards);
  }

  const { strong, partial } = rankRoles(candidates, scores);
  const chosen = partial ? [...strong, partial] : strong;
  // Shown or dropped goes into `seen`. A fit the caps left out, strong or partial, stays unseen,
  // so the next scan scores it again and can surface it (Decision 19).
  const shown = new Set(chosen.map((one) => one.key));
  // A candidate Jev left unanswered has no score: neither shown nor dropped, so it is tried again.
  const seen = candidates
    .filter((one) => {
      const score = scores.get(one.key);

      return shown.has(one.key) || (score !== undefined && score < PARTIAL_FIT);
    })
    .map((one) => one.key);

  if (chosen.length === 0) {
    return { roles: [], partial: null, seen, boards, usage: null };
  }

  let explained: Awaited<ReturnType<typeof explainFits>>;

  try {
    explained = await explainFits(person, chosen, deps.explain, deps.signal);
  } catch {
    console.error('[jobs]', 'Explaining roles failed.');

    return nothing(boards);
  }

  const found = (posting: Posting): FoundRole => {
    const words = explained.fits.get(posting.key) ?? { reasons: [], gaps: [] };

    return foundRole(posting, scores.get(posting.key) ?? 0, words);
  };

  return {
    roles: strong.map(found),
    partial: partial ? found(partial) : null,
    seen,
    boards,
    usage: explained.usage,
  };
}

/**
 * How long the build run's scan may take, so the run fits its function (Decision 11): 25 seconds
 * of it for the find phase (`FIND_BUDGET_MS`), the rest for Jev and the explain call.
 */
export const SCAN_BUDGET_MS = 45_000;

let warnedOff = false;

/**
 * Job search's `afterBuild`: the build run's one scan (job search spec, section 4, "What the
 * build run does"), so first matches come from the same code and caps as later ones. It reads
 * the named companies' open roles of any age and a week of search hits, then commits what it
 * found through `jobs.surfaceMatches` with the explain call's usage. Without a board contact it
 * does nothing, and says so once.
 */
export async function scanAfterBuild(job: TemplateWorkJob): Promise<void> {
  const config = readJobsConfig(job.env);

  if (!config.contact) {
    if (!warnedOff) {
      warnedOff = true;
      console.error('[jobs]', 'Board lookups are off: NEXUI_CONTACT is not set.');
    }

    return;
  }

  const input = scanInput(job.snapshot, job.anchorId, null);

  if (!input) {
    return;
  }

  const result = await scanForRoles(input, {
    config,
    fetch: job.fetch,
    now: job.now,
    signal: AbortSignal.timeout(SCAN_BUDGET_MS),
    evaluation: {
      model: job.session.evaluationModel,
      providerOptions: job.session.providerOptions('perception'),
    },
    explain: {
      model: job.session.languageModel('fast'),
      providerOptions: job.session.providerOptions('fast'),
    },
  });
  const found =
    result.roles.length > 0 ||
    result.partial !== null ||
    result.seen.length > 0 ||
    result.boards.length > 0;

  if (!found) {
    return;
  }

  const surface: Record<string, unknown> = {
    roles: result.roles,
    seen: result.seen,
    boards: result.boards,
  };

  if (result.partial) {
    surface.partial = result.partial;
  }

  try {
    job.call('jobs.surfaceMatches', surface);
  } catch {
    console.error('[jobs]', 'The scan’s matches were refused.');

    return;
  }

  await job.commit(result.usage);
}
