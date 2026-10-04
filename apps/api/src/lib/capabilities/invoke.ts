import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CapabilityRequest, ChangesetOp, GraphSnapshot } from '@nexui/types';

import {
  commitChangeset,
  type CommitResult,
  ChangesetInvalidError,
  loadSnapshot,
} from '#lib/graph';

import { findCapability } from './registry.ts';
import { createStager } from './stage.ts';
import { CapabilityError, type Capability } from './types.ts';

function stageUserCall(
  capability: Capability,
  snapshot: GraphSnapshot,
  input: unknown,
  clock: Date,
  newId: () => string,
): ChangesetOp[] {
  try {
    const stager = createStager({
      capabilities: [capability],
      snapshot,
      actor: 'user',
      runId: null,
      newId,
      clock: () => clock,
    });

    stager.call(capability.name, input);

    return stager.takeOps();
  } catch (error) {
    if (error instanceof CapabilityError) {
      throw new ChangesetInvalidError(error.message);
    }

    throw error;
  }
}

/**
 * Runs one capability the app's buttons may call (an insight's "Give it back", a decision's
 * pick) as the user, and commits it like a direct edit. No model is involved.
 */
export async function invokeCapability(
  db: SupabaseClient,
  intentId: string,
  request: CapabilityRequest,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<CommitResult> {
  const capability = findCapability(request.name);

  if (!capability?.callableByUser) {
    throw new ChangesetInvalidError("That action isn't available.");
  }

  const snapshot = await loadSnapshot(db, intentId);
  const ops = stageUserCall(capability, snapshot, request.input, clock, newId);

  return commitChangeset(db, { intentId, actor: 'user', ops }, clock, newId);
}
