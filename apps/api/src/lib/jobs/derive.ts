import { isDeepStrictEqual } from 'node:util';

import {
  applyOps,
  interviewTime,
  searchFigures,
  searchParts,
  type ChangesetOp,
  type GraphObject,
  type GraphSnapshot,
  type InterviewData,
  type IntentSummary,
  type OpportunityData,
  type SearchData,
  type SearchDerived,
  type Stage,
} from '@nexui/types';

import { listOf } from '#lib/capabilities';

import { jobsContext } from './context.ts';
import { companyName, companyOf } from './parts.ts';

const DAY_MS = 86_400_000;

// Home's chips, most advanced stage first.
const CHIP_STAGES: readonly Stage[] = ['offer', 'interviewing', 'applied', 'interested', 'new'];

// "Thu" within a week, else "Oct 30", in the plan's time zone.
function dayLabel(at: number, now: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions =
    at - now.getTime() < 7 * DAY_MS
      ? { weekday: 'short', timeZone }
      : { month: 'short', day: 'numeric', timeZone };

  return new Intl.DateTimeFormat('en-US', options).format(at);
}

function lookingFor(search: SearchData): string {
  return search.roles.length > 0
    ? `Looking for ${listOf(search.roles, 'or')} roles`
    : 'Setting up your search';
}

// First match wins (spec section 3.3).
function searchBadge(
  graph: GraphSnapshot,
  search: SearchData,
  figures: SearchDerived,
  roles: readonly GraphObject[],
): IntentSummary['badge'] {
  if (search.status === 'hired') {
    const hired = roles.find((role) => (role.data as OpportunityData).outcome === 'accepted');
    const where = hired ? companyName(graph, hired) : 'a new job';

    return { text: `Hired at ${where}`.slice(0, 60), tone: 'ok' };
  }

  if (jobsContext(graph.intent)?.startedAt === undefined) {
    return { text: 'Ready to start', tone: 'attention' };
  }

  if (search.status === 'paused') {
    return { text: 'Paused', tone: 'quiet' };
  }

  if (figures.followUpsDue > 0) {
    return { text: 'Follow-up due', tone: 'attention' };
  }

  if (figures.new > 0) {
    return {
      text: `${figures.new} new ${figures.new === 1 ? 'role' : 'roles'}`,
      tone: 'attention',
    };
  }

  return undefined;
}

// One chip per company with a role in play or in New, most advanced first; AI-marked while a
// role there is still an unreviewed match in New.
function companyChips(
  graph: GraphSnapshot,
  roles: readonly GraphObject[],
): NonNullable<IntentSummary['strip']> {
  const chips = new Map<string, { label: string; ai: boolean }>();

  for (const stage of CHIP_STAGES) {
    for (const role of roles) {
      const data = role.data as OpportunityData;

      if (data.stage !== stage) {
        continue;
      }

      const company = companyOf(graph, role.id);
      const key = company?.id ?? role.id;
      const ai = stage === 'new' && role.source?.type === 'ai' && !role.source.reviewedAt;
      const chip = chips.get(key);

      if (chip) {
        chip.ai = chip.ai || ai;
      } else {
        chips.set(key, { label: companyName(graph, role).slice(0, 100), ai });
      }
    }
  }

  return [...chips.values()].slice(0, 12);
}

function searchSummary(
  graph: GraphSnapshot,
  search: GraphObject,
  figures: SearchDerived,
  now: Date,
  timeZone: string,
): IntentSummary {
  const data = search.data as SearchData;
  const { roles, interviews } = searchParts(graph, search.id);
  const parts: string[] = [];

  if (figures.new > 0) {
    parts.push(`${figures.new} new`);
  }

  if (figures.applied > 0) {
    parts.push(`${figures.applied} applied`);
  }

  const next = interviews
    .map((interview) => interviewTime((interview.data as InterviewData).at))
    .filter((at) => at >= now.getTime())
    .sort((a, b) => a - b)[0];

  if (next !== undefined) {
    parts.push(`interview ${dayLabel(next, now, timeZone)}`);
  }

  const line = parts.length > 0 ? parts.join(' · ') : lookingFor(data);
  const summary: IntentSummary = { line: line.slice(0, 200) };
  const badge = searchBadge(graph, data, figures, roles);
  const strip = companyChips(graph, roles);

  if (badge) {
    summary.badge = badge;
  }

  if (strip.length > 0) {
    summary.strip = strip;
    summary.stripStyle = 'chips';
  }

  return summary;
}

/**
 * `derive.jobSearch` (job search spec, section 3.3): recounts the search's figures and rebuilds
 * Home's summary, as derived ops for the same changeset. Deterministic; no model call. `now` is
 * the changeset's time, and dates read in the plan's time zone.
 */
export function deriveJobSearch(
  staged: GraphSnapshot,
  searchId: string,
  now: string,
): ChangesetOp[] {
  const search = staged.objects.find(
    (object) => object.id === searchId && object.kind === 'search',
  );

  if (!search) {
    return [];
  }

  const clock = new Date(now);
  const timeZone = jobsContext(staged.intent)?.timezone ?? 'UTC';
  const figures = searchFigures(staged, searchId, clock);
  const data: SearchData = { ...(search.data as SearchData), derived: figures };
  const ops: ChangesetOp[] = [];

  if (!isDeepStrictEqual(search.data, data)) {
    ops.push({ op: 'update_object', id: searchId, patch: { data }, origin: 'derived' });
  }

  // The summary reads the search as this changeset leaves it.
  const settled = applyOps(staged, ops, staged.intent.updatedAt);
  const summary = searchSummary(settled, search, figures, clock, timeZone);

  if (!isDeepStrictEqual(staged.intent.summary, summary)) {
    ops.push({ op: 'update_intent', patch: { summary }, origin: 'derived' });
  }

  return ops;
}
