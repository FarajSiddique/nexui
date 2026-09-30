import type { z } from 'zod';

import type { ChangesetOp, GraphSnapshot, ObjectSource } from '@nexui/types';

import type { RefTable } from './refs.ts';

/** Who is calling: the model during a run, or the user pressing an insight's or decision's button. */
export type CapabilityActor = 'ai' | 'user';

export interface CapabilityContext {
  actor: CapabilityActor;
  runId: string | null;
  /** The intent as it will be after the calls staged so far. */
  graph: GraphSnapshot;
  /** The workspace anchor: the trip. */
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
