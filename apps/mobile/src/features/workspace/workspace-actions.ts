import type { CapabilityRequest, ChangesetOp, InsightAction } from '@nexui/types';

/**
 * What a primitive or a details sheet reports upward (readiness doc, section 3.5). The primitive
 * that knows a capability builds its request and the ops that show it at once; the screen sends
 * it, opens a sheet or a link, and never names a template's capability.
 */
export type WorkspaceAction =
  | { type: 'ask'; prompt: string }
  | { type: 'open'; objectId: string }
  | { type: 'capability'; request: CapabilityRequest; optimistic: ChangesetOp[] }
  | { type: 'link'; url: string }
  | { type: 'upload'; docType: 'resume' }
  | { type: 'start' }
  | { type: 'copy'; text: string };

export type CapabilityAction = Extract<WorkspaceAction, { type: 'capability' }>;

/**
 * Settles a decision with the chosen option, or with none ("Keep the day free"). Only the server
 * knows what picking does, so nothing shows before it answers.
 */
export function resolveAction(decisionId: string, optionId: string | null): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'decision.resolve',
      input: optionId ? { decisionId, optionId } : { decisionId },
    },
    optimistic: [],
  };
}

/** An insight's button as an action. */
export function fromInsightAction(action: InsightAction): WorkspaceAction {
  switch (action.type) {
    case 'ask':
      return { type: 'ask', prompt: action.prompt };
    case 'capability':
      return {
        type: 'capability',
        request: { name: action.name, input: action.input },
        optimistic: [],
      };
    case 'upload':
      return { type: 'upload', docType: action.docType };
    case 'start':
      return { type: 'start' };
    case 'copy':
      return { type: 'copy', text: action.text };
  }
}
