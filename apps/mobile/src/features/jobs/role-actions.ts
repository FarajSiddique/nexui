import {
  stageSchema,
  type CapabilityRequest,
  type CardAction,
  type ChangesetOp,
  type GraphObject,
  type OpportunityData,
  type Outcome,
  type PassReason,
  type Stage,
} from '@nexui/types';

import type { CapabilityAction } from '#features/workspace';

// The role as it shows at once: its new stage, with an outcome only while closed.
function moved(role: GraphObject, stage: Stage, outcome?: Outcome): ChangesetOp[] {
  const data: OpportunityData = { ...(role.data as OpportunityData), stage };

  if (stage === 'closed' && outcome) {
    data.outcome = outcome;
  } else {
    delete data.outcome;
  }

  return [{ op: 'update_object', id: role.id, patch: { data }, origin: 'direct' }];
}

/**
 * Moves a role to a stage, or closes it with an outcome, through `jobs.setStage`, shown at once.
 *
 * @example stageAction(role, 'closed', 'rejected')
 */
export function stageAction(role: GraphObject, stage: Stage, outcome?: Outcome): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'jobs.setStage',
      input: outcome ? { objectId: role.id, stage, outcome } : { objectId: role.id, stage },
    },
    optimistic: moved(role, stage, outcome),
  };
}

/** Passes on a role through `jobs.pass`, with the picker's reason or none, shown at once. */
export function passAction(role: GraphObject, reason: PassReason | null): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'jobs.pass',
      input: reason ? { objectId: role.id, reason } : { objectId: role.id },
    },
    optimistic: moved(role, 'closed', 'passed'),
  };
}

/**
 * A pipeline card's button (spec section 3.2): the doc's capability with `{ objectId, ...input }`.
 * The two job search knows, `jobs.setStage` and `jobs.pass`, show at once; any other waits for
 * the server.
 */
export function cardAction(
  role: GraphObject,
  action: CardAction,
  reason: PassReason | null,
): CapabilityAction {
  const input: CapabilityRequest['input'] = { ...action.input, objectId: role.id };
  const stage = stageSchema.safeParse(input.stage);

  if (action.capability === 'jobs.pass') {
    return passAction(role, reason);
  }

  if (action.capability === 'jobs.setStage' && stage.success) {
    return stageAction(role, stage.data);
  }

  return { type: 'capability', request: { name: action.capability, input }, optimistic: [] };
}

/**
 * Renames a role through `object.update` (Decision 2), shown at once: its object title follows
 * `data.title` on the server too. Null for an empty, too long or unchanged title.
 */
export function renameAction(role: GraphObject, title: string): CapabilityAction | null {
  const next = title.trim();
  const data = role.data as OpportunityData;

  if (next.length === 0 || next.length > 200 || next === data.title) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'object.update', input: { ref: role.id, data: { title: next } } },
    optimistic: [
      {
        op: 'update_object',
        id: role.id,
        patch: { title: next, data: { ...data, title: next } },
        origin: 'direct',
      },
    ],
  };
}
