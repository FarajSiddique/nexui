import type { GraphObject } from '@nexui/types';

export interface AiMark {
  /** Nexui wrote it and the user hasn't touched it: highlighter plus the "Nexui" tag. */
  highlight: boolean;
  /** A proposal not yet chosen: drawn with a dashed outline. */
  tentative: boolean;
}

/**
 * Spec section D's one rule for marking what Nexui wrote, applied the same way by every
 * primitive. A user edit sets `source.reviewedAt`, which removes the highlighter.
 */
export function aiMarkFor(object: Pick<GraphObject, 'kind' | 'source'>): AiMark {
  return {
    highlight: object.source?.type === 'ai' && !object.source.reviewedAt,
    tentative: object.kind === 'option',
  };
}
