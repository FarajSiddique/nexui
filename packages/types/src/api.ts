import { z } from 'zod';

import {
  eventRecordSchema,
  graphSnapshotSchema,
  intentStatusSchema,
  intentSummarySchema,
  templateSchema,
} from './graph.ts';
import { userOpSchema } from './ops.ts';
import { idSchema, timestampSchema } from './primitives.ts';

// POST /api/intents
export const createIntentRequestSchema = z.object({ goal: z.string().trim().min(3).max(500) });

// GET /api/intents: Home's cards, most recently active first.
export const intentListItemSchema = z.object({
  id: idSchema,
  goal: z.string(),
  template: templateSchema.nullable(),
  status: intentStatusSchema,
  summary: intentSummarySchema,
  lastActivityAt: timestampSchema,
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
