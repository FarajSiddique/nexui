import type { ChangesetOp, GraphSnapshot } from '@nexui/types';

import { deriveTrip, findShortenedPlace } from '../kinds/trip.ts';

/**
 * Runs the intent's template derivations over a staged changeset. Only travel exists in
 * slice 1; an intent with no template derives nothing.
 */
export function deriveForTemplate(
  before: GraphSnapshot,
  staged: GraphSnapshot,
  ops: readonly ChangesetOp[],
  newId: () => string,
): ChangesetOp[] {
  if (staged.intent.template !== 'travel' || !staged.workspace) {
    return [];
  }

  return deriveTrip(staged, staged.workspace.doc.anchorId, findShortenedPlace(before, ops), newId);
}
