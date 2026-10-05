import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CapabilityRequest, ChangesetOp, GraphSnapshot } from '@nexui/types';

import { CapabilityError, type Capability } from '#lib/capabilities';
import {
  commitChangeset,
  type CommitResult,
  ChangesetInvalidError,
  loadSnapshot,
} from '#lib/graph';
import { templateFor } from '#lib/templates';

import { createStager } from './stage.ts';

function stageUserCall(
  capability: Capability,
  snapshot: GraphSnapshot,
  input: unknown,
  clock: Date,
  newId: () => string,
): { ops: ChangesetOp[]; label: string | undefined } {
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

    return { ops: stager.takeOps(), label: stager.takeEntries()[0]?.label };
  } catch (error) {
    if (error instanceof CapabilityError) {
      throw new ChangesetInvalidError(error.message);
    }

    throw error;
  }
}

/**
 * Runs one capability the app's buttons may call (an insight's "Give it back", a decision's
 * pick) as the user, and commits it like a direct edit. Only the plan's template's capabilities
 * are offered. No model is involved.
 */
export async function invokeCapability(
  db: SupabaseClient,
  intentId: string,
  request: CapabilityRequest,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<CommitResult> {
  const snapshot = await loadSnapshot(db, intentId);
  const capability = templateFor(snapshot.intent.template)?.capabilities.find(
    (candidate) => candidate.name === request.name,
  );

  if (!capability?.callableByUser) {
    throw new ChangesetInvalidError("That action isn't available.");
  }

  const { ops, label } = stageUserCall(capability, snapshot, request.input, clock, newId);

  return commitChangeset(db, { intentId, actor: 'user', ops, label: () => label }, clock, newId);
}
