import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Actor, ChangesetOp, EventRecord, GraphSnapshot } from '@nexui/types';

import { seedTravelOps } from '#lib/templates';

import { GraphNotFoundError, mapRpcError } from './errors.ts';
import { mapEventRow } from './mappers.ts';
import { prepareChangeset } from './prepare.ts';
import { loadSnapshot } from './snapshot.ts';

export interface CommitInput {
  intentId: string;
  actor: Actor;
  /**
   * The run committing and its worker's lease. The commit then goes through
   * `run_apply_changeset`, which takes the user, intent and actor from the run.
   */
  run?: { id: string; lease: string } | null;
  ops: readonly ChangesetOp[];
  /**
   * Rebuilds `ops` over the snapshot the commit is about to apply to, when the intent moved on
   * since they were staged (a run's step). Null keeps `ops`.
   */
  restage?: (current: GraphSnapshot) => ChangesetOp[] | null;
}

export interface CommitResult {
  event: EventRecord;
  snapshot: GraphSnapshot;
}

/** Every op in the changeset was superseded by newer changes, so there is nothing to commit. */
export class NothingToCommitError extends Error {}

// Derives from a fresh snapshot and applies it. `apply_changeset` refuses with NXU08 if the
// intent's last activity moved since that snapshot, so derived values are never stale.
async function applyFromSnapshot(
  db: SupabaseClient,
  input: CommitInput,
  now: string,
  newId: () => string,
): Promise<{ data: unknown; error: { code?: string } | null }> {
  const before = await loadSnapshot(db, input.intentId);
  const staged = input.restage?.(before) ?? input.ops;

  if (input.restage && staged.length === 0) {
    throw new NothingToCommitError('Newer changes replaced everything in this step.');
  }

  const ops = prepareChangeset(before, staged, input.actor, now, newId);

  if (input.run) {
    return db.rpc('run_apply_changeset', {
      p_run_id: input.run.id,
      p_lease_id: input.run.lease,
      p_ops: ops,
      p_expected_activity_at: before.intent.lastActivityAt,
    });
  }

  return db.rpc('apply_changeset', {
    p_intent_id: input.intentId,
    p_actor: input.actor,
    p_run_id: null,
    p_ops: ops,
    p_expected_activity_at: before.intent.lastActivityAt,
  });
}

/**
 * Validates, derives and commits a changeset in one database transaction, then returns the
 * logged event and the intent as it now is. If another change landed between loading and
 * committing, it re-derives from the new state and tries once more before reporting a 409.
 */
export async function commitChangeset(
  db: SupabaseClient,
  input: CommitInput,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<CommitResult> {
  const now = clock.toISOString();
  let result = await applyFromSnapshot(db, input, now, newId);

  if (result.error?.code === 'NXU08') {
    result = await applyFromSnapshot(db, input, now, newId);
  }

  if (result.error) {
    throw mapRpcError(result.error);
  }

  return { event: mapEventRow(result.data), snapshot: await loadSnapshot(db, input.intentId) };
}

const NOT_A_TRIP_SUMMARY = 'Nexui can plan trips so far.';

/**
 * Creates an intent in one transaction. A travel intent gets its seed trip, workspace and derived
 * state; an intent with no template (Jev said it isn't a trip) gets only a summary line.
 */
export async function createIntent(
  db: SupabaseClient,
  goal: string,
  template: 'travel' | null = 'travel',
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<GraphSnapshot> {
  const now = clock.toISOString();
  const intentId = newId();
  const empty: GraphSnapshot = {
    intent: {
      id: intentId,
      goal,
      template,
      status: 'exploring',
      context: {},
      summary: { line: '' },
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    },
    workspace: null,
    objects: [],
    relationships: [],
  };
  const seed: ChangesetOp[] =
    template === 'travel'
      ? seedTravelOps(goal, newId)
      : [
          {
            op: 'update_intent',
            patch: { summary: { line: NOT_A_TRIP_SUMMARY } },
            origin: 'direct',
          },
        ];
  const ops = prepareChangeset(empty, seed, 'system', now, newId);
  const { error } = await db.rpc('create_intent', {
    p_intent_id: intentId,
    p_goal: goal,
    p_template: template,
    p_ops: ops,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return loadSnapshot(db, intentId);
}

/** Deletes an intent no run has started on, such as a trip whose run could not be created. */
export async function discardIntent(db: SupabaseClient, intentId: string): Promise<void> {
  const { error } = await db.rpc('discard_intent', { p_intent_id: intentId });

  if (error) {
    throw mapRpcError(error);
  }
}

/**
 * Deletes one of the caller's plans for good, with its graph, runs and change history. Refused
 * while a run is still working on it (`ChangesetConflictError`).
 */
export async function deleteIntent(db: SupabaseClient, intentId: string): Promise<void> {
  const { error } = await db.rpc('delete_intent', { p_intent_id: intentId });

  if (error) {
    throw mapRpcError(error);
  }
}

/** Undo (or Redo, on an Undo event): restores each row's earlier values. */
export async function revertEvent(db: SupabaseClient, eventId: string): Promise<CommitResult> {
  const { data, error } = await db.rpc('revert_event', { p_event_id: eventId });

  if (error) {
    throw mapRpcError(error);
  }

  const event = mapEventRow(data);

  if (!event.intentId) {
    throw new GraphNotFoundError('Not found.');
  }

  return { event, snapshot: await loadSnapshot(db, event.intentId) };
}
