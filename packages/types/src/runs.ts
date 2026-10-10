import { z } from 'zod';

import { templateSchema } from './graph.ts';
import { capabilityNameSchema, idSchema, timestampSchema } from './primitives.ts';

export const runKindSchema = z.enum(['create_intent', 'ask']);

export type RunKind = z.infer<typeof runKindSchema>;

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'stopping',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * A run in one of these statuses is still working on its intent, so no other run may start.
 * Stop moves a running run to `stopping` until the step it was taking commits.
 */
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'stopping',
] as const satisfies readonly RunStatus[];

/**
 * @example
 * isActiveRunStatus('stopping') // true
 * isActiveRunStatus('cancelled') // false
 */
export function isActiveRunStatus(status: RunStatus | undefined): boolean {
  return status !== undefined && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/** How much work an ask needs, as Jev routed it (spec section F). */
export const runRouteSchema = z.enum(['edit', 'fast', 'reasoning']);

export type RunRoute = z.infer<typeof runRouteSchema>;

/**
 * What started a run. `template` is the one Jev chose for a create run; `perception` says whether
 * Jev answered or its fallback did. A recorded fixture replays `template` and `route`.
 */
export const runInputSchema = z.object({
  text: z.string().min(1).max(1000),
  route: runRouteSchema,
  template: templateSchema.optional(),
  perception: z.enum(['model', 'fallback']),
});

export type RunInput = z.infer<typeof runInputSchema>;

/**
 * One capability call in a run. `input` is what the model sent, with refs rather than ids, so a
 * finished run can be recorded as a fixture; it is null when it was too large to keep.
 */
export const runProgressEntrySchema = z.object({
  step: z.number().int().min(0),
  capability: capabilityNameSchema,
  label: z.string().max(200),
  ok: z.boolean(),
  ms: z.number().int().min(0),
  input: z.record(z.string(), z.json()).nullable(),
  error: z.string().max(300).optional(),
});

export type RunProgressEntry = z.infer<typeof runProgressEntrySchema>;

export const runRecordSchema = z.object({
  id: idSchema,
  intentId: idSchema.nullable(),
  kind: runKindSchema,
  status: runStatusSchema,
  input: runInputSchema,
  progress: z.array(runProgressEntrySchema),
  error: z.string().nullable(),
  modelUsage: z.object({
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    model: z.string().optional(),
  }),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export type RunRecord = z.infer<typeof runRecordSchema>;
