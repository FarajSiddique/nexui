import { z } from 'zod';

import {
  eventRecordSchema,
  graphSnapshotSchema,
  intentStatusSchema,
  intentSummarySchema,
  templateSchema,
} from './graph.ts';
import { storageUrlSchema } from './media.ts';
import { userOpSchema } from './ops.ts';
import { capabilityNameSchema, fitsFreeJson, idSchema, timestampSchema } from './primitives.ts';
import { runRouteSchema } from './runs.ts';

// POST /api/intents
export const createIntentRequestSchema = z.object({ goal: z.string().trim().min(3).max(500) });

// What Nexui did with the goal (job search spec, section 2): a plan seeded with its run queued,
// or a goal no template fits, saved with no plan and no run. PR 2 adds `awaiting_resume` and
// `existing_search`.
export const createIntentResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('started'), snapshot: graphSnapshotSchema, runId: idSchema }),
  z.object({ outcome: z.literal('unsupported') }),
]);

export type CreateIntentResponse = z.infer<typeof createIntentResponseSchema>;

// GET /api/intents: Home's cards, most recently active first.
export const intentListItemSchema = z.object({
  id: idSchema,
  goal: z.string(),
  template: templateSchema.nullable(),
  status: intentStatusSchema,
  summary: intentSummarySchema,
  lastActivityAt: timestampSchema,
  // The 500px photos of the plan's first three stops that have one, from the media cache.
  photos: z.array(storageUrlSchema).max(3),
});

export const intentListResponseSchema = z.object({ items: z.array(intentListItemSchema) });

export type IntentListItem = z.infer<typeof intentListItemSchema>;

// POST /api/intents/:id/changesets
export const changesetRequestSchema = z.object({ ops: z.array(userOpSchema).min(1).max(50) });

// Changesets and Undo answer with the logged event and the intent as it now is.
export const commitResponseSchema = z.object({
  event: eventRecordSchema,
  snapshot: graphSnapshotSchema,
});

export type CommitResponse = z.infer<typeof commitResponseSchema>;

// GET /api/changes: newest first; `cursor` is the last item's `seq`.
export const changesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  intentId: idSchema.optional(),
});

export type ChangesQuery = z.infer<typeof changesQuerySchema>;

export const changeItemSchema = eventRecordSchema.extend({
  intentGoal: z.string().nullable(),
  revertedByEventId: idSchema.nullable(),
});

export type ChangeItem = z.infer<typeof changeItemSchema>;

export const changesResponseSchema = z.object({
  items: z.array(changeItemSchema),
  nextCursor: z.string().nullable(),
});

export type ChangesResponse = z.infer<typeof changesResponseSchema>;

// POST /api/intents/:id/ask: answers 202 while the run works in the background.
export const askRequestSchema = z.object({ text: z.string().trim().min(2).max(1000) });

export const askResponseSchema = z.object({ runId: idSchema, route: runRouteSchema });

export type AskResponse = z.infer<typeof askResponseSchema>;

// POST /api/intents/:id/capabilities: an insight's or decision's button. Answers like a changeset.
export const capabilityRequestSchema = z.object({
  name: capabilityNameSchema,
  input: z.record(z.string(), z.json()).refine(fitsFreeJson, 'Too much input.'),
});

export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;

// GET /api/runs/:id and POST /api/runs/:id/cancel answer with `runRecordSchema`.
