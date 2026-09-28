import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Actor, ChangesetOp, EventRecord, GraphSnapshot } from '@nexui/types';

import { seedTravelOps } from '../templates/travel.ts';
import { GraphNotFoundError, mapRpcError } from './errors.ts';
import { mapEventRow } from './mappers.ts';
import { prepareChangeset } from './prepare.ts';
import { loadSnapshot } from './snapshot.ts';

export interface CommitInput {
  intentId: string;
  actor: Actor;
  runId?: string | null;
  ops: readonly ChangesetOp[];
}

export interface CommitResult {
  event: EventRecord;
  snapshot: GraphSnapshot;
}

/**
 * Validates, derives and commits a changeset in one database transaction, then returns the
 * logged event and the intent as it now is.
 */
export async function commitChangeset(
  db: SupabaseClient,
  input: CommitInput,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<CommitResult> {
  const before = await loadSnapshot(db, input.intentId);
  const ops = prepareChangeset(before, input.ops, input.actor, clock.toISOString(), newId);
  const { data, error } = await db.rpc('apply_changeset', {
    p_intent_id: input.intentId,
    p_actor: input.actor,
    p_run_id: input.runId ?? null,
    p_ops: ops,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return { event: mapEventRow(data), snapshot: await loadSnapshot(db, input.intentId) };
}

/**
 * Creates a travel intent with its seed trip, workspace and derived state in one transaction.
 * Slice 1 has one template; the intelligence plan routes goals with Jev.
 */
export async function createIntent(
  db: SupabaseClient,
  goal: string,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<GraphSnapshot> {
  const now = clock.toISOString();
  const intentId = newId();
  const empty: GraphSnapshot = {
    intent: {
      id: intentId,
      goal,
      template: 'travel',
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
  const ops = prepareChangeset(empty, seedTravelOps(goal, newId), 'system', now, newId);
  const { error } = await db.rpc('create_intent', {
    p_intent_id: intentId,
    p_goal: goal,
    p_template: 'travel',
    p_ops: ops,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return loadSnapshot(db, intentId);
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
