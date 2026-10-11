import {
  interviewTime,
  type GraphObject,
  type GraphSnapshot,
  type InterviewData,
} from '@nexui/types';

import { isDateOnly } from '#lib';

/**
 * The object `objectId` links to by `type`: a role's company is `at`, an interview's role is
 * `for` (job search spec, section 3.1).
 *
 * @example linkedTo(snapshot, roleId, 'at') // the role's company
 */
export function linkedTo(
  snapshot: GraphSnapshot,
  objectId: string,
  type: string,
): GraphObject | null {
  const edge = snapshot.relationships.find(
    (relationship) => relationship.sourceId === objectId && relationship.type === type,
  );

  return edge ? (snapshot.objects.find((object) => object.id === edge.targetId) ?? null) : null;
}

/** The objects of `kind` that link to `objectId` by `type`: a role's drafts are `for` it. */
export function linkedFrom(
  snapshot: GraphSnapshot,
  objectId: string,
  type: string,
  kind: string,
): GraphObject[] {
  const sources = new Set(
    snapshot.relationships
      .filter((relationship) => relationship.targetId === objectId && relationship.type === type)
      .map((relationship) => relationship.sourceId),
  );

  return snapshot.objects.filter((object) => object.kind === kind && sources.has(object.id));
}

/** The name of the company a role is `at`, or null. */
export function companyName(snapshot: GraphSnapshot, roleId: string): string | null {
  const name = linkedTo(snapshot, roleId, 'at')?.data.name;

  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * True while an interview is still ahead by the device clock (spec section 3.2: for display
 * only). One on a date with no time counts as ahead all that day.
 */
export function isUpcoming(at: string, now: Date): boolean {
  const end = isDateOnly(at) ? Date.parse(`${at}T23:59:59Z`) : interviewTime(at);

  return end >= now.getTime();
}

/** A role's interviews, soonest first. */
export function interviewsFor(snapshot: GraphSnapshot, roleId: string): GraphObject[] {
  const at = (object: GraphObject): number => interviewTime((object.data as InterviewData).at);

  return linkedFrom(snapshot, roleId, 'for', 'interview').sort((a, b) => at(a) - at(b));
}

/** A role's next interview by the device clock, or null. */
export function nextInterview(
  snapshot: GraphSnapshot,
  roleId: string,
  now: Date,
): InterviewData | null {
  const next = interviewsFor(snapshot, roleId).find((interview) =>
    isUpcoming((interview.data as InterviewData).at, now),
  );

  return next ? (next.data as InterviewData) : null;
}
