import type { ChangesetOp, GraphSnapshot } from '@nexui/types';

import { templateFor } from './registry.ts';

/**
 * Runs the intent's template derivation over a staged changeset. An intent with no template, or
 * no workspace yet, derives nothing.
 */
export function deriveForTemplate(
  before: GraphSnapshot,
  staged: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
  newId: () => string,
): ChangesetOp[] {
  const template = templateFor(staged.intent.template);

  if (!template || !staged.workspace) {
    return [];
  }

  return template.derive({
    before,
    staged,
    ops,
    anchorId: staged.workspace.doc.anchorId,
    now,
    newId,
  });
}
