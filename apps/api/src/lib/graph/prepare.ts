import {
  applyOps,
  GraphOpError,
  parseKindData,
  type Actor,
  type ChangesetOp,
  type GraphSnapshot,
} from '@nexui/types';

import { deriveForTemplate } from '../templates/index.ts';
import { ChangesetInvalidError } from './errors.ts';

/** A user's edit to something Nexui wrote clears its highlighter (spec section D). */
export function markReviewed(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  actor: Actor,
  now: string,
): ChangesetOp[] {
  if (actor !== 'user') {
    return [...ops];
  }

  return ops.map((op) => {
    if (op.op !== 'update_object') {
      return op;
    }

    const source = before.objects.find((object) => object.id === op.id)?.source;

    if (source?.type !== 'ai' || source.reviewedAt) {
      return op;
    }

    return { ...op, patch: { ...op.patch, source: { ...source, reviewedAt: now } } };
  });
}

function checkEndpoint(snapshot: GraphSnapshot, type: 'object' | 'intent', id: string): void {
  const exists =
    type === 'intent'
      ? id === snapshot.intent.id
      : snapshot.objects.some((object) => object.id === id);

  if (!exists) {
    throw new ChangesetInvalidError('That link points at something that no longer exists.');
  }
}

function checkData(kind: string, data: unknown): Record<string, unknown> {
  const parsed = parseKindData(kind, data);

  if (!parsed.ok) {
    throw new ChangesetInvalidError(parsed.message);
  }

  return parsed.data;
}

// A workspace doc may name objects inserted later in the same changeset, so its references
// are checked against the fully staged snapshot.
function checkWorkspace(snapshot: GraphSnapshot): void {
  const doc = snapshot.workspace?.doc;

  if (!doc) {
    return;
  }

  checkEndpoint(snapshot, 'object', doc.anchorId);

  for (const section of doc.sections) {
    if (section.type === 'decision') {
      checkEndpoint(snapshot, 'object', section.decisionId);
    }
  }
}

/**
 * Checks each op against the snapshot as it would be after the ops before it, and validates
 * object data against the kind registry. Returns the ops with their data as parsed.
 */
export function validateOps(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
): ChangesetOp[] {
  let running = before;
  const valid: ChangesetOp[] = [];

  for (const op of ops) {
    let checked: ChangesetOp = op;

    switch (op.op) {
      case 'insert_object':
        checked = { ...op, data: checkData(op.kind, op.data) };
        break;
      case 'update_object': {
        const current = running.objects.find((object) => object.id === op.id);

        if (!current) {
          throw new ChangesetInvalidError('That item no longer exists.');
        }

        if (op.patch.data) {
          checked = { ...op, patch: { ...op.patch, data: checkData(current.kind, op.patch.data) } };
        }

        break;
      }

      case 'insert_relationship':
        checkEndpoint(running, op.sourceType, op.sourceId);
        checkEndpoint(running, op.targetType, op.targetId);
        break;
      default:
        break;
    }

    try {
      running = applyOps(running, [checked], now);
    } catch (error) {
      if (error instanceof GraphOpError) {
        throw new ChangesetInvalidError('That item no longer exists.');
      }

      throw error;
    }

    valid.push(checked);
  }

  if (ops.some((op) => op.op === 'set_workspace')) {
    checkWorkspace(running);
  }

  return valid;
}

function rowKey(op: ChangesetOp): string {
  switch (op.op) {
    case 'insert_object':
    case 'update_object':
    case 'delete_object':
      return `objects:${op.id}`;
    case 'insert_relationship':
    case 'delete_relationship':
      return `relationships:${op.id}`;
    case 'set_workspace':
      return 'workspaces';
    case 'update_intent':
      return 'intents';
  }
}

const mergedOrigin = (a: ChangesetOp, b: ChangesetOp): 'direct' | 'derived' =>
  a.origin === 'direct' || b.origin === 'direct' ? 'direct' : 'derived';

// Combines two ops on the same row, or returns null when they cancel out.
function merge(first: ChangesetOp, next: ChangesetOp): ChangesetOp | null {
  const origin = mergedOrigin(first, next);

  if (first.op === 'insert_object' && next.op === 'update_object') {
    return { ...first, ...next.patch, origin };
  }

  if (first.op === 'update_object' && next.op === 'update_object') {
    return { ...first, patch: { ...first.patch, ...next.patch }, origin };
  }

  if (first.op === 'update_object' && next.op === 'delete_object') {
    return { ...next, origin };
  }

  if (
    (first.op === 'insert_object' && next.op === 'delete_object') ||
    (first.op === 'insert_relationship' && next.op === 'delete_relationship')
  ) {
    return null;
  }

  if (first.op === 'set_workspace' && next.op === 'set_workspace') {
    return { ...next, origin };
  }

  if (first.op === 'update_intent' && next.op === 'update_intent') {
    return { ...first, patch: { ...first.patch, ...next.patch }, origin };
  }

  throw new ChangesetInvalidError('Conflicting changes to one item.');
}

/** One op per row, as `apply_changeset` requires, in the order each row first appears. */
export function coalesceOps(ops: readonly ChangesetOp[]): ChangesetOp[] {
  const byRow = new Map<string, ChangesetOp | null>();

  for (const op of ops) {
    const key = rowKey(op);

    if (!byRow.has(key)) {
      byRow.set(key, op);
      continue;
    }

    const first = byRow.get(key);

    if (first === null || first === undefined) {
      throw new ChangesetInvalidError('Conflicting changes to one item.');
    }

    byRow.set(key, merge(first, op));
  }

  return [...byRow.values()].filter((op): op is ChangesetOp => op !== null);
}

/**
 * Turns requested ops into the full changeset to commit: marks reviews, validates, runs the
 * template's derivations on the staged result, merges per row, and validates the whole again.
 * Pure, so tests can check exactly what reaches the database.
 */
export function prepareChangeset(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  actor: Actor,
  now: string,
  newId: () => string,
): ChangesetOp[] {
  const valid = validateOps(before, markReviewed(before, ops, actor, now), now);
  const staged = applyOps(before, valid, now);
  const derived = deriveForTemplate(before, staged, valid, newId);

  return validateOps(before, coalesceOps([...valid, ...derived]), now);
}
