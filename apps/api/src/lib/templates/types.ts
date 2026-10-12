import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import type {
  AnchorKind,
  ChangesetOp,
  GraphSnapshot,
  KindName,
  RunRoute,
  Template,
} from '@nexui/types';

import type { AiSession, GatewayOptions, ModelTier } from '#lib/ai';
import type { Capability, LookupTool } from '#lib/capabilities';
import type { ModelMode } from '#lib/cognition';
import type { Upload } from '#lib/http';
import type { RunUsage } from '#lib/runs';

/**
 * What a template's code gets after a build run's model steps (`afterBuild`): the plan as the
 * steps left it, the run's AI session, settings, the network, and a way to stage the template's
 * capabilities as the run and commit them like a step.
 */
export interface TemplateWorkJob {
  snapshot: GraphSnapshot;
  anchorId: string;
  session: AiSession;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: Date;
  /** Stages one of the template's capabilities as the run; throws `CapabilityError` if refused. */
  call(name: string, input: unknown): Record<string, unknown>;
  /** Commits what `call` staged as one changeset, adding `usage` to the run's. */
  commit(usage: RunUsage | null): Promise<void>;
}

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

/** What a template's seed reads: the goal, and the device's time zone from the create request. */
export interface SeedInput {
  goal: string;
  timezone: string;
}

/** The model an intake reads with: the fast tier and its fallbacks. */
export interface IntakeAi {
  model: LanguageModel;
  providerOptions: GatewayOptions;
  /** How long the read may take; tests shorten it. */
  timeoutMs?: number;
}

/** What reading an upload found, as the input of the template's intake capability. */
export interface IntakeRead {
  outcome: 'read' | 'unreadable' | 'none';
  input: Record<string, unknown>;
  /** The read's model and tokens, which the build run adds to its usage. */
  usage: RunUsage | null;
}

/**
 * A document a template's plan takes before its build run, such as job search's resume (job
 * search spec, section 4). A template with one is seeded and waits (`awaiting_resume`);
 * `POST /api/intents/[id]/start` reads the upload, stores what it found through `capability`,
 * and queues the build run; `POST /api/intents/[id]/resume` replaces it later.
 */
export interface TemplateIntake {
  /** The code-only capability that stores a read: its `input`, plus `start`. */
  capability: string;
  /** The message for an upload `resume` can't read. */
  unreadable: string;
  /** True once the plan's build run was queued, after which `start` answers 409. */
  started(snapshot: GraphSnapshot): boolean;
  /** Refuses a file before any model call: the message to answer 400 with, or null. */
  refuse(file: Upload): string | null;
  /** Reads the upload, or records that there is none. Never throws for a bad file. */
  read(file: Upload | null, ai: IntakeAi): Promise<IntakeRead>;
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
  /** What models call the anchor, in refs and prompts: `trip`. */
  anchorRef: string;
  /** Every kind the template's plans hold, the anchor's included. */
  kinds: readonly KindName[];
  /** The sentence Jev reads when it picks a template for a new goal. */
  perception: string;
  /**
   * The key of a boolean Vercel flag (project `nexui-api`) that must be on for Jev to route new
   * goals here, so a template can ship before its app side or be switched off without a deploy
   * (job search's `job-search`). Without one, the template always routes.
   */
  gate?: string;
  /**
   * At most one of the user's plans of this template is going at once (job search spec,
   * section 8): a new goal for it answers `existing_search` with that plan.
   */
  singleActive?: boolean;
  /**
   * The template's own keys in `intents.context`, such as job search's `jobs`. Checked, with
   * the eval tag, on every `update_intent` (`contextSchemaFor`).
   */
  context: Record<string, z.ZodType>;
  /**
   * The plan's IANA time zone, for the date its runs are told is today (`promptFor`), such as
   * job search's `context.jobs.timezone`. Without one, or when it answers `undefined`, runs use
   * UTC.
   */
  timeZone?: (snapshot: GraphSnapshot) => string | undefined;
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
  /** A document its plans take before the build run, which then waits for `start`. */
  intake?: TemplateIntake;
  /**
   * Code a build run does after its model steps, such as job search's first scan. It runs only
   * while the run is still running. A failure is logged and the run still succeeds, since its
   * steps are committed; only a lost lease ends the run.
   */
  afterBuild?: (job: TemplateWorkJob) => Promise<void>;
  /** How models plan it. */
  prompt: TemplatePrompt;
  /** Budgets that replace the default for some routes (`routeBudget` in `runs/execute.ts`). */
  routes?: Partial<Record<RunRoute, RouteBudget>>;
}
