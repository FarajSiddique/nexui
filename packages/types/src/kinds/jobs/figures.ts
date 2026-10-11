import type { GraphObject, GraphSnapshot } from '../../graph.ts';
import { evaluateQuery } from '../../query.ts';
import type { KindName } from '../registry.ts';
import type { InterviewData, OpportunityData, SearchDerived, Stage } from './schemas.ts';

const DAY_MS = 86_400_000;

/** Past New and not closed: the roles the user is working on. */
export const IN_PLAY_STAGES: readonly Stage[] = ['interested', 'applied', 'interviewing', 'offer'];

/** Everything `part_of` a search, by kind, oldest first. */
export function searchParts(
  snapshot: GraphSnapshot,
  searchId: string,
): {
  roles: GraphObject[];
  companies: GraphObject[];
  interviews: GraphObject[];
  people: GraphObject[];
  documents: GraphObject[];
  insights: GraphObject[];
  decisions: GraphObject[];
} {
  const partOf = (kind: KindName): GraphObject[] =>
    evaluateQuery(snapshot, {
      from: 'objects',
      kind,
      related: { type: 'part_of', to: { objectId: searchId }, direction: 'out' },
      sort: { field: 'createdAt', dir: 'asc' },
    });

  return {
    roles: partOf('opportunity'),
    companies: partOf('company'),
    interviews: partOf('interview'),
    people: partOf('person'),
    documents: partOf('document'),
    insights: partOf('insight'),
    decisions: partOf('decision'),
  };
}

/**
 * An interview's time in milliseconds. A date with no time counts as noon UTC that day.
 *
 * @example
 * interviewTime('2026-10-21') === Date.parse('2026-10-21T12:00:00Z') // true
 */
export function interviewTime(at: string): number {
  return Date.parse(at.length === 10 ? `${at}T12:00:00Z` : at);
}

/**
 * Whether an applied role needs a nudge (spec section 3.3): `due` once it was applied for at
 * least 7 days ago with no contact in the last 7 days and fewer than 2 follow-ups sent; `close`
 * once 2 follow-ups have gone unanswered for 7 more days.
 */
export function followUpState(role: OpportunityData, now: Date): 'due' | 'close' | null {
  if (role.stage !== 'applied' || !role.appliedAt) {
    return null;
  }

  const sinceApplied = now.getTime() - Date.parse(role.appliedAt);
  const quiet = now.getTime() - Date.parse(role.lastContactAt ?? role.appliedAt);

  if (sinceApplied < 7 * DAY_MS || quiet < 7 * DAY_MS) {
    return null;
  }

  return role.followUps >= 2 ? 'close' : 'due';
}

/**
 * The search's figures from the graph, no model involved. "This week" is the next 7 days, so it
 * needs no time zone. The app passes no `now`; `derive.jobSearch` passes the changeset's.
 */
export function searchFigures(
  snapshot: GraphSnapshot,
  searchId: string,
  now: Date = new Date(),
): SearchDerived {
  const { roles, interviews } = searchParts(snapshot, searchId);
  const data = roles.map((role) => role.data as OpportunityData);
  const count = (stage: Stage): number => data.filter((role) => role.stage === stage).length;
  const from = now.getTime();
  const to = from + 7 * DAY_MS;

  return {
    new: count('new'),
    inPlay: data.filter((role) => IN_PLAY_STAGES.includes(role.stage)).length,
    applied: count('applied'),
    interviewing: count('interviewing'),
    offers: count('offer'),
    interviewsThisWeek: interviews.filter((interview) => {
      const at = interviewTime((interview.data as InterviewData).at);

      return at >= from && at < to;
    }).length,
    followUpsDue: data.filter((role) => followUpState(role, now) !== null).length,
  };
}
