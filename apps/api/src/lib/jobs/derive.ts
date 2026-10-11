import { isDeepStrictEqual } from 'node:util';

import {
  applyOps,
  followUpState,
  interviewTime,
  jobSourceSchema,
  searchFigures,
  searchParts,
  type ChangesetOp,
  type DocumentData,
  type GraphObject,
  type GraphSnapshot,
  type InsightAction,
  type InsightData,
  type InterviewData,
  type IntentSummary,
  type OpportunityData,
  type SearchData,
  type SearchDerived,
  type Stage,
} from '@nexui/types';

import { listOf } from '#lib/capabilities';

import { jobsContext } from './context.ts';
import { companyName, companyOf, sameRole } from './parts.ts';
import { PARTIAL_INSIGHT_KEY } from './seed.ts';

const DAY_MS = 86_400_000;

// Home's chips, most advanced stage first.
const CHIP_STAGES: readonly Stage[] = ['offer', 'interviewing', 'applied', 'interested', 'new'];

const HOUR_MS = 3_600_000;
const FOLLOW_UP_KEY = 'followup:';
const INTERVIEW_KEY = 'interview:';
const WITHDRAW_KEY = 'search.withdraw';

// The cards this derivation owns. Others (the resume card, a partial fit) are left alone.
const OWNED_KEYS: readonly string[] = [FOLLOW_UP_KEY, INTERVIEW_KEY, WITHDRAW_KEY];

const OPEN_APPLICATIONS: readonly Stage[] = ['applied', 'interviewing'];

function linkToSearch(id: string, searchId: string, newId: () => string): ChangesetOp {
  return {
    op: 'insert_relationship',
    id: newId(),
    sourceType: 'object',
    sourceId: id,
    targetType: 'object',
    targetId: searchId,
    type: 'part_of',
    metadata: null,
    origin: 'derived',
  };
}

function removeWithLinks(graph: GraphSnapshot, object: GraphObject): ChangesetOp[] {
  return [
    { op: 'delete_object', id: object.id, origin: 'derived' },
    ...graph.relationships
      .filter((edge) => edge.sourceId === object.id || edge.targetId === object.id)
      .map((edge): ChangesetOp => ({ op: 'delete_relationship', id: edge.id, origin: 'derived' })),
  ];
}

// The object something is `for`: an interview's or a draft's role or interview.
function forTarget(graph: GraphSnapshot, id: string): GraphObject | undefined {
  const edge = graph.relationships.find(
    (candidate) => candidate.type === 'for' && candidate.sourceId === id,
  );

  return edge ? graph.objects.find((object) => object.id === edge.targetId) : undefined;
}

// "tomorrow at 2:00 PM", "today", "on Friday at 9:30 AM", in the plan's time zone. A date with
// no time reads as the day alone.
function whenLabel(at: string, now: Date, timeZone: string): string {
  const dateOnly = at.length === 10;
  const time = interviewTime(at);
  const day = (moment: number): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(moment);
  const date = dateOnly ? at : day(time);
  let when: string;

  if (date === day(now.getTime())) {
    when = 'today';
  } else if (date === day(now.getTime() + DAY_MS)) {
    when = 'tomorrow';
  } else {
    // A date alone is noon UTC, so its weekday is read in UTC, never shifted by the plan's zone.
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: dateOnly ? 'UTC' : timeZone,
    });

    when = `on ${weekday.format(time)}`;
  }

  if (dateOnly) {
    return when;
  }

  // ICU may put a narrow no-break space before AM and PM; NFKC turns it into a plain space.
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(time)
    .normalize('NFKC');

  return `${when} at ${clock}`;
}

function followUpInsight(
  graph: GraphSnapshot,
  role: GraphObject,
  state: 'due' | 'close',
  now: Date,
): InsightData {
  const data = role.data as OpportunityData;
  const company = companyName(graph, role);
  const heardBack: InsightAction = {
    type: 'capability',
    label: 'Heard back',
    name: 'jobs.logContact',
    input: { objectId: role.id, direction: 'received' },
  };

  if (state === 'close') {
    return {
      text: `Still no reply from ${company}.`.slice(0, 160),
      detail: 'Two follow-ups went unanswered.',
      severity: 'attention',
      derivedKey: `${FOLLOW_UP_KEY}${role.id}`,
      actions: [
        {
          type: 'capability',
          label: 'Close it',
          name: 'jobs.setStage',
          input: { objectId: role.id, stage: 'closed', outcome: 'no_reply' },
        },
        heardBack,
      ],
    };
  }

  const since = Date.parse(data.lastContactAt ?? data.appliedAt ?? now.toISOString());
  const days = Math.floor((now.getTime() - since) / DAY_MS);

  return {
    text: `No reply from ${company} in ${days} days.`.slice(0, 160),
    severity: 'attention',
    derivedKey: `${FOLLOW_UP_KEY}${role.id}`,
    actions: [
      {
        type: 'ask',
        label: 'Draft a follow-up',
        prompt: `Draft a follow-up email for ${data.title} at ${company}`.slice(0, 300),
      },
      heardBack,
    ],
  };
}

function interviewInsight(
  graph: GraphSnapshot,
  interview: GraphObject,
  documents: readonly GraphObject[],
  now: Date,
  timeZone: string,
): InsightData | null {
  const data = interview.data as InterviewData;
  const at = interviewTime(data.at);

  if (at < now.getTime() || at > now.getTime() + 36 * HOUR_MS) {
    return null;
  }

  const briefed = documents.some(
    (doc) =>
      (doc.data as DocumentData).docType === 'brief' &&
      forTarget(graph, doc.id)?.id === interview.id,
  );

  if (briefed) {
    return null;
  }

  const role = forTarget(graph, interview.id);
  const company = role ? companyName(graph, role) : 'them';

  return {
    text: `${data.label} with ${company} ${whenLabel(data.at, now, timeZone)}.`.slice(0, 160),
    severity: 'attention',
    derivedKey: `${INTERVIEW_KEY}${interview.id}`,
    actions: [
      {
        type: 'ask',
        label: 'Prep me',
        prompt: `Prep me for my ${data.label} with ${company}`.slice(0, 300),
      },
    ],
  };
}

// The cards this changeset should leave, by derived key. A hired search keeps only the one
// about applications still open.
function wantedInsights(
  graph: GraphSnapshot,
  searchId: string,
  hired: boolean,
  now: Date,
  timeZone: string,
): Map<string, InsightData> {
  const wanted = new Map<string, InsightData>();
  const { roles, interviews, documents } = searchParts(graph, searchId);

  if (hired) {
    const open = roles.filter((role) =>
      OPEN_APPLICATIONS.includes((role.data as OpportunityData).stage),
    ).length;

    if (open > 0) {
      wanted.set(WITHDRAW_KEY, {
        text: `${open} other ${open === 1 ? 'application is' : 'applications are'} still open.`,
        severity: 'info',
        derivedKey: WITHDRAW_KEY,
        actions: [
          {
            type: 'ask',
            label: 'Draft withdrawal notes',
            prompt: 'Draft withdrawal notes for my other open applications',
          },
        ],
      });
    }

    return wanted;
  }

  for (const role of roles) {
    const state = followUpState(role.data as OpportunityData, now);

    if (state) {
      wanted.set(`${FOLLOW_UP_KEY}${role.id}`, followUpInsight(graph, role, state, now));
    }
  }

  for (const interview of interviews) {
    const insight = interviewInsight(graph, interview, documents, now, timeZone);

    if (insight) {
      wanted.set(`${INTERVIEW_KEY}${interview.id}`, insight);
    }
  }

  return wanted;
}

// Adds, updates and removes this derivation's cards so they match `wanted`.
function syncInsights(
  graph: GraphSnapshot,
  searchId: string,
  wanted: ReadonlyMap<string, InsightData>,
  newId: () => string,
): ChangesetOp[] {
  const ops: ChangesetOp[] = [];
  const kept = new Set<string>();

  for (const insight of searchParts(graph, searchId).insights) {
    const key = (insight.data as InsightData).derivedKey;

    if (key === undefined || !OWNED_KEYS.some((owned) => key.startsWith(owned))) {
      continue;
    }

    const next = wanted.get(key);

    if (!next || kept.has(key)) {
      ops.push(...removeWithLinks(graph, insight));
      continue;
    }

    kept.add(key);

    if (!isDeepStrictEqual(insight.data, next)) {
      ops.push({
        op: 'update_object',
        id: insight.id,
        patch: { title: next.text, data: next },
        origin: 'derived',
      });
    }
  }

  for (const [key, data] of wanted) {
    if (kept.has(key)) {
      continue;
    }

    const id = newId();

    ops.push(
      {
        op: 'insert_object',
        id,
        kind: 'insight',
        kindVersion: 1,
        title: data.text,
        status: null,
        data,
        source: { type: 'derived' },
        position: null,
        origin: 'derived',
      },
      linkToSearch(id, searchId, newId),
    );
  }

  return ops;
}

// Accepting an offer ends the search (spec section 3.3): the plan completes and roles still in
// New go. Riding in the acceptance's changeset, Undo restores all of it.
function hiredOps(graph: GraphSnapshot, search: GraphObject): ChangesetOp[] {
  const { roles } = searchParts(graph, search.id);
  const accepted = roles.some((role) => (role.data as OpportunityData).outcome === 'accepted');

  if ((search.data as SearchData).status === 'hired' || !accepted) {
    return [];
  }

  return [
    { op: 'update_intent', patch: { status: 'completed' }, origin: 'derived' },
    ...roles
      .filter((role) => (role.data as OpportunityData).stage === 'new')
      .flatMap((role) => removeWithLinks(graph, role)),
  ];
}

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
  const data = graph.objects.find((object) => object.id === search.id)?.data as SearchData;
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

// The partial-fit card goes once its role is in the plan, by its button or otherwise, and when
// the search ends in a hire.
function partialCardOps(graph: GraphSnapshot, searchId: string, hired: boolean): ChangesetOp[] {
  const { insights, roles } = searchParts(graph, searchId);
  const card = insights.find(
    (insight) => (insight.data as InsightData).derivedKey === PARTIAL_INSIGHT_KEY,
  );

  if (!card) {
    return [];
  }

  if (hired) {
    return removeWithLinks(graph, card);
  }

  const add = (card.data as InsightData).actions.find(
    (action) => action.type === 'capability' && action.name === 'jobs.addRole',
  );
  const input = add?.type === 'capability' ? add.input : {};
  const source = jobSourceSchema.safeParse(input.source);
  const url = typeof input.url === 'string' ? input.url : undefined;
  const added = roles.some((role) =>
    sameRole(role.data as OpportunityData, source.success ? source.data : undefined, url),
  );

  return added ? removeWithLinks(graph, card) : [];
}

/**
 * `derive.jobSearch` (job search spec, section 3.3): ends the search on an accepted offer,
 * recounts its figures, keeps the follow-up, interview and open-applications cards in step,
 * and rebuilds Home's summary, as derived ops for the same changeset. Deterministic; no model
 * call. `now` is the changeset's time, and dates read in the plan's time zone.
 */
export function deriveJobSearch(
  staged: GraphSnapshot,
  searchId: string,
  now: string,
  newId: () => string,
): ChangesetOp[] {
  const search = staged.objects.find(
    (object) => object.id === searchId && object.kind === 'search',
  );

  if (!search) {
    return [];
  }

  const clock = new Date(now);
  const timeZone = jobsContext(staged.intent)?.timezone ?? 'UTC';
  const ops: ChangesetOp[] = hiredOps(staged, search);
  const hired = ops.length > 0 || (search.data as SearchData).status === 'hired';
  // Later steps read the plan as this changeset leaves it.
  const settle = (): GraphSnapshot => applyOps(staged, ops, staged.intent.updatedAt);
  const figures = searchFigures(settle(), searchId, clock);
  const data: SearchData = { ...(search.data as SearchData), derived: figures };

  if (hired) {
    data.status = 'hired';
  }

  if (!isDeepStrictEqual(search.data, data)) {
    ops.push({ op: 'update_object', id: searchId, patch: { data }, origin: 'derived' });
  }

  ops.push(
    ...syncInsights(
      settle(),
      searchId,
      wantedInsights(settle(), searchId, hired, clock, timeZone),
      newId,
    ),
  );
  ops.push(...partialCardOps(settle(), searchId, hired));

  const summary = searchSummary(settle(), search, figures, clock, timeZone);

  if (!isDeepStrictEqual(staged.intent.summary, summary)) {
    ops.push({ op: 'update_intent', patch: { summary }, origin: 'derived' });
  }

  return ops;
}
