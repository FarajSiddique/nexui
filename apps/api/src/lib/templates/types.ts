import type { z } from 'zod';

import type {
  AnchorKind,
  ChangesetOp,
  GraphSnapshot,
  KindName,
  RunRoute,
  Template,
} from '@nexui/types';

import type { ModelTier } from '#lib/ai';
import type { Capability, LookupTool } from '#lib/capabilities';
import type { ModelMode } from '#lib/cognition';

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

/** A route's model budget: the tier, whether it loops with tools, and its most steps. */
export interface RouteBudget {
  tier: ModelTier;
  mode: ModelMode;
  maxSteps: number;
}

/** The template's part of a run's instructions. The standing frame is cognition's. */
export interface TemplatePrompt {
  /** Who the model is: "Nexui’s trip planner". */
  role: string;
  /** What the anchor's ref names: "the trip itself". */
  anchor: string;
  /** The template's rules, after the one on fenced data and before the one on failed calls. */
  rules: readonly string[];
  /**
   * Fenced data beyond the goal, graph and request, such as a resume or a posting, and where it
   * comes from: the standing rule names both. A template without any keeps the shorter rule.
   */
  fences?: { tags: readonly string[]; from: string };
  /** The task of the run that fills in a new plan. */
  create: string;
  /** Each ask route's task. */
  ask: Record<RunRoute, string>;
}

/**
 * One use case: everything the API needs to plan it, so nothing outside its folder names it
 * (readiness doc, section 3.1). `templateSchema` lists each one, and `TEMPLATES` must hold a
 * definition for every name it lists.
 */
/** What a template's seed reads: the goal, and the device's time zone from the create request. */
export interface SeedInput {
  goal: string;
  timezone: string;
}

export interface TemplateDefinition {
  name: Template;
  /** The kind of the workspace anchor, the object the plan is about. */
  anchorKind: AnchorKind;
  /** What models call the anchor, in refs and prompts: `trip`. */
  anchorRef: string;
  /** Every kind the template's plans hold, the anchor's included. */
  kinds: readonly KindName[];
  /** The sentence Jev reads when it picks a template for a new goal. */
  perception: string;
  /**
   * An env var that must be `on` for Jev to route new goals here, so a template can ship before
   * its app side (job search's `JOB_SEARCH`). Without one, the template always routes.
   */
  gate?: string;
  /**
   * The template's own keys in `intents.context`, such as job search's `jobs`. Checked, with
   * the eval tag, on every `update_intent` (`contextSchemaFor`).
   */
  context: Record<string, z.ZodType>;
  /**
   * The anchor's `data.derived` figures that a changeset event's payload reports when a change
   * moves them.
   */
  figures: readonly { key: string; label: string }[];
  /** The ops that start a plan from its goal: the anchor and the workspace. */
  seed: (input: SeedInput, newId: () => string) => ChangesetOp[];
  /** Ops derived from a staged changeset, committed with it. Deterministic; no model call. */
  derive: (input: DeriveInput) => ChangesetOp[];
  /** What runs and the app's buttons may call on the template's plans, in the order models see. */
  capabilities: readonly Capability[];
  /** Read-only tools its runs' models get beside the capabilities (`toModelTools`). */
  lookups?: readonly LookupTool[];
  /** How models plan it. */
  prompt: TemplatePrompt;
  /** Budgets that replace the default for some routes (`routeBudget` in `runs/execute.ts`). */
  routes?: Partial<Record<RunRoute, RouteBudget>>;
}
