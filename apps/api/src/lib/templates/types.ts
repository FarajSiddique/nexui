import type { AnchorKind, ChangesetOp, GraphSnapshot, KindName, Template } from '@nexui/types';

import type { Capability } from '#lib/capabilities';

/** What a template's derivation reads: the changeset as staged, and the plan before it. */
export interface DeriveInput {
  before: GraphSnapshot;
  staged: GraphSnapshot;
  /** The changeset's validated ops, before anything is derived. */
  ops: readonly ChangesetOp[];
  /** The workspace anchor, such as the trip. */
  anchorId: string;
  now: string;
  newId: () => string;
}

/**
 * One use case: everything the API needs to plan it, so nothing outside its folder names it
 * (readiness doc, section 3.1). `templateSchema` lists each one, and `TEMPLATES` must hold a
 * definition for every name it lists.
 */
export interface TemplateDefinition {
  name: Template;
  /** The kind of the workspace anchor, the object the plan is about. */
  anchorKind: AnchorKind;
  /** Every kind the template's plans hold, the anchor's included. */
  kinds: readonly KindName[];
  /** The ops that start a plan from its goal: the anchor and the workspace. */
  seed: (goal: string, newId: () => string) => ChangesetOp[];
  /** Ops derived from a staged changeset, committed with it. Deterministic; no model call. */
  derive: (input: DeriveInput) => ChangesetOp[];
  /** What runs and the app's buttons may call on the template's plans, in the order models see. */
  capabilities: readonly Capability[];
}
