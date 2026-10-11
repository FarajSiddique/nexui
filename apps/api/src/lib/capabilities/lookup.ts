import type { z } from 'zod';

import type { GraphSnapshot } from '@nexui/types';

import type { RefTable } from './refs.ts';

type Env = Record<string, string | undefined>;

/** What a lookup reads besides its input: the plan as staged, its refs, settings and the network. */
export interface LookupContext {
  graph: GraphSnapshot;
  refs: RefTable;
  env: Env;
  fetch: typeof fetch;
  now: Date;
}

/**
 * A read-only call a model may make during a run, such as a web search or a job posting (job
 * search spec, section 5.5). It changes nothing, so step replay never repeats it, and it answers
 * `{ error }` for a failure the model should read, never throwing.
 */
export interface LookupTool {
  name: string;
  /** The tool description models see. */
  description: string;
  input: z.ZodType<unknown>;
  /** The most calls one run may make (spec section 8: 3 web searches, 10 board lookups). */
  perRun: number;
  execute(input: unknown, ctx: LookupContext): Promise<Record<string, unknown>>;
}

export interface LookupSpec<I> extends Omit<LookupTool, 'input' | 'execute'> {
  input: z.ZodType<I>;
  execute(input: I, ctx: LookupContext): Promise<Record<string, unknown>>;
}

/** Types `execute` by its input schema, then erases the type, as `defineCapability` does. */
export function defineLookup<I>(spec: LookupSpec<I>): LookupTool {
  return { ...spec, execute: (input, ctx) => spec.execute(input as I, ctx) };
}
