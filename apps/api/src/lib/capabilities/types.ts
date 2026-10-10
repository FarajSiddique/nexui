import type { z } from 'zod';

import type {
  ChangesetOp,
  GraphObject,
  GraphSnapshot,
  KindName,
  ObjectSource,
  OptionData,
} from '@nexui/types';

import type { RefTable } from './refs.ts';

/** Who is calling: the model during a run, or the user pressing an insight's or decision's button. */
export type CapabilityActor = 'ai' | 'user';

export interface CapabilityContext {
  actor: CapabilityActor;
  runId: string | null;
  /** What the user asked the run, for a call the AI made; null for a button press. */
  request: string | null;
  /** The intent as it will be after the calls staged so far. */
  graph: GraphSnapshot;
  /** The workspace anchor, such as the trip. */
  anchorId: string;
  refs: RefTable;
  /** The provenance new objects get: `{ type: 'ai', runId }` or `{ type: 'user' }`. */
  source: ObjectSource;
  newId: () => string;
}

export interface CapabilityResult {
  /** The tool result the model sees. Small, and naming objects by ref. */
  output: Record<string, unknown>;
  ops: ChangesetOp[];
  /** One line for the run's progress, such as "Added Kyoto". */
  label: string;
  /** Refs this call introduces; they are claimed only once its ops validate. */
  refs?: Record<string, string>;
}

/**
 * A named, validated change to the graph (spec section E). `execute` is pure: it reads the
 * staged graph and returns ops, which the stager validates and the run commits.
 */
export interface Capability {
  name: string;
  /** The tool description models see. */
  description: string;
  input: z.ZodType<unknown>;
  /** `approval` leaves Nexui and would pause the run; slice 1 has none. */
  policy: 'internal' | 'approval';
  exposeToModel: boolean;
  /** The app's buttons may call it through `POST /api/intents/[id]/capabilities`. */
  callableByUser: boolean;
  execute(input: unknown, ctx: CapabilityContext): CapabilityResult;
}

/** A call the capability refuses. `message` is safe to show the model and the user. */
export class CapabilityError extends Error {}

export interface CapabilitySpec<I> extends Omit<Capability, 'input' | 'execute'> {
  input: z.ZodType<I>;
  execute(input: I, ctx: CapabilityContext): CapabilityResult;
}

/**
 * Types `execute` by its input schema, then erases the type for the registry. The stager parses
 * input with `input` before it calls `execute`.
 */
export function defineCapability<I>(spec: CapabilitySpec<I>): Capability {
  return { ...spec, execute: (input, ctx) => spec.execute(input as I, ctx) };
}

/**
 * The kinds a template's plans hold, which its generic capabilities are built for, and the
 * examples their descriptions use, in that template's terms.
 */
export interface CapabilityScope {
  /** The workspace anchor's kind, such as `trip`. */
  anchorKind: KindName;
  /** Every kind the template's plans hold, the anchor's included, in the order models read them. */
  kinds: readonly KindName[];
  examples: {
    /** New objects' refs: "kyoto or tokyo-kyoto". */
    objectRef: string;
    /** A new decision's ref: "rural-stop". */
    decisionRef: string;
    /** A metric an option compares, as JSON: '{"hoursFromKyoto": 1}'. */
    metric: string;
    /** A new section's id: "place-costs". */
    sectionId: string;
    /** A data field a comparison shows: "data.days". */
    field: string;
  };
}

/**
 * Names the parsed type of an input schema whose shape depends on the template, such as
 * `object.create`'s link inputs. The schema still parses every call; this only types it.
 */
export function shapedInput<I>(schema: z.ZodType): z.ZodType<I> {
  return schema as z.ZodType<I>;
}

/** A proposed option as parsed: the fields every template shares, then the template's own. */
export interface OptionInput {
  label: string;
  summary: string;
  pros?: string[] | undefined;
  cons?: string[] | undefined;
  metrics?: Record<string, number> | undefined;
  fit?: string | undefined;
  [field: string]: unknown;
}

/**
 * What a template's decision options carry beyond the shared fields, and what picking one does
 * (readiness doc, section 3.11). A trip's carry a place to add or a stop to extend; a template
 * that passes none gets plain options.
 */
export interface DecisionOptions {
  /** The template's own option fields, by name, such as a trip's `place`. */
  fields: Record<string, z.ZodType>;
  /** Sentences `decision.propose`'s description adds about those fields. */
  proposeHelp: string;
  /** Sentences `decision.resolve`'s description adds about what a pick does. */
  resolveHelp: string;
  /**
   * One proposed option's own fields, staged: what goes into the option's data, and the objects
   * it carries, made before the option, with refs under `optionRef`.
   */
  propose: (
    option: OptionInput,
    ctx: CapabilityContext,
    optionRef: string,
  ) => { data: Partial<OptionData>; ops: ChangesetOp[]; refs: Record<string, string> };
  /** Ops that carry out a chosen option. */
  choose: (ctx: CapabilityContext, option: GraphObject) => ChangesetOp[];
  /** Ops once a decision settles: what the options nobody chose carried goes. */
  settle: (
    ctx: CapabilityContext,
    decisionId: string,
    chosenOptionId: string | null,
  ) => ChangesetOp[];
}
