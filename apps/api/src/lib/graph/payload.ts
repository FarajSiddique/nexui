import { isDeepStrictEqual } from 'node:util';

import {
  applyOps,
  type ChangeFigure,
  type ChangesetOp,
  type ChangesetPayload,
  type GraphSnapshot,
} from '@nexui/types';

import { templateFor } from '#lib/templates';

/** The label of a raw changeset, which has no capability to name it. */
export const DIRECT_EDIT_LABEL = 'Edited the plan';

const MAX_LABEL = 200;
const MAX_FIGURES = 12;

/**
 * One label for a changeset of several calls: the first call's, and how many more.
 *
 * @example
 * changesetLabel(['Added Kyoto', 'Added Osaka', 'Added Kyoto → Osaka']) // 'Added Kyoto and 2 more'
 */
export function changesetLabel(labels: readonly string[]): string | undefined {
  const [first] = labels;

  if (first === undefined || labels.length === 1) {
    return first;
  }

  return `${first} and ${labels.length - 1} more`;
}

// The anchor's derived figures, or null before its template first derived them.
function derivedOf(snapshot: GraphSnapshot, anchorId: string): Record<string, unknown> | null {
  const derived = snapshot.objects.find((object) => object.id === anchorId)?.data.derived;

  if (typeof derived !== 'object' || derived === null || Object.keys(derived).length === 0) {
    return null;
  }

  return derived as Record<string, unknown>;
}

// Cutting inside an emoji leaves half a surrogate pair, which Postgres rejects in jsonb.
const clipped = (text: string, max: number): string =>
  text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');

const shown = (value: unknown): string | null =>
  typeof value === 'number' || typeof value === 'string' ? clipped(String(value), 60) : null;

/**
 * The anchor figures a prepared changeset moves, in its template's order, before and after.
 * None on a plan's first derivation, when there is nothing to compare with.
 */
export function figureChanges(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
): ChangeFigure[] {
  const template = templateFor(before.intent.template);
  const anchorId = before.workspace?.doc.anchorId;
  const was = anchorId ? derivedOf(before, anchorId) : null;

  if (!template || !anchorId || !was) {
    return [];
  }

  const is = derivedOf(applyOps(before, ops, now), anchorId) ?? {};

  return template.figures.flatMap(({ key, label }): ChangeFigure[] =>
    isDeepStrictEqual(was[key], is[key])
      ? []
      : [{ label, before: shown(was[key]), after: shown(is[key]) }],
  );
}

/** The event's payload: only what this changeset has, within the database's limits. */
export function changesetPayload(
  label: string | undefined,
  figures: readonly ChangeFigure[],
): ChangesetPayload {
  const payload: ChangesetPayload = {};
  const text = label ? clipped(label, MAX_LABEL) : '';

  if (text) {
    payload.label = text;
  }

  if (figures.length > 0) {
    payload.figures = figures.slice(0, MAX_FIGURES);
  }

  return payload;
}
