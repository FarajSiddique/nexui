import { z } from 'zod';

import { idSchema, relTypeSchema, timestampSchema } from './primitives.ts';
import { workspaceDocSchema } from './workspace.ts';

export const actorSchema = z.enum(['user', 'derived', 'ai', 'system']);

export type Actor = z.infer<typeof actorSchema>;

export const intentStatusSchema = z.enum([
  'exploring',
  'active',
  'blocked',
  'completed',
  'archived',
]);
export const templateSchema = z.enum(['travel', 'job_search']);

export type Template = z.infer<typeof templateSchema>;

/** Who created an object. `reviewedAt` is set when the user edits something Nexui wrote. */
export const objectSourceSchema = z.strictObject({
  type: z.enum(['user', 'ai', 'derived', 'external']),
  runId: idSchema.optional(),
  url: z.url().max(2000).optional(),
  reviewedAt: timestampSchema.optional(),
});

export type ObjectSource = z.infer<typeof objectSourceSchema>;

/** Drives a Home card; rebuilt by the template's derivation after every changeset. */
export const intentSummarySchema = z.strictObject({
  line: z.string().max(200),
  badge: z
    .strictObject({
      text: z.string().min(1).max(60),
      tone: z.enum(['attention', 'ok', 'running']),
    })
    .optional(),
  strip: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(100),
        ai: z.boolean(),
        // The stop's media key (`placeMediaKey`), for Home's photos. A summary saved before
        // photos has none until its plan's next change.
        key: z.string().min(1).max(200).optional(),
      }),
    )
    .max(12)
    .optional(),
});

export type IntentSummary = z.infer<typeof intentSummarySchema>;

export const intentRecordSchema = z.object({
  id: idSchema,
  goal: z.string(),
  template: templateSchema.nullable(),
  status: intentStatusSchema,
  context: z.record(z.string(), z.unknown()),
  summary: intentSummarySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastActivityAt: timestampSchema,
});

export type IntentRecord = z.infer<typeof intentRecordSchema>;

export const graphObjectSchema = z.object({
  id: idSchema,
  intentId: idSchema,
  kind: z.string(),
  kindVersion: z.number().int().min(1),
  title: z.string().nullable(),
  status: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  source: objectSourceSchema.nullable(),
  position: z.number().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type GraphObject = z.infer<typeof graphObjectSchema>;

export const endpointTypeSchema = z.enum(['object', 'intent']);

export const relationshipSchema = z.object({
  id: idSchema,
  intentId: idSchema,
  sourceType: endpointTypeSchema,
  sourceId: idSchema,
  targetType: endpointTypeSchema,
  targetId: idSchema,
  type: relTypeSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestampSchema,
});

export type Relationship = z.infer<typeof relationshipSchema>;

export const workspaceRecordSchema = z.object({
  intentId: idSchema,
  version: z.number().int().min(1),
  doc: workspaceDocSchema,
  updatedAt: timestampSchema,
});

export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

/** One intent with its workspace and every live object and relationship. */
export const graphSnapshotSchema = z.object({
  intent: intentRecordSchema,
  workspace: workspaceRecordSchema.nullable(),
  objects: z.array(graphObjectSchema),
  relationships: z.array(relationshipSchema),
});

export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;

export const originSchema = z.enum(['direct', 'derived']);

/** One row change as the database logged it; `before`/`after` are raw snake_case rows. */
export const storedOpSchema = z.object({
  op: z.string(),
  table: z.enum(['objects', 'relationships', 'workspaces', 'intents']),
  id: idSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  origin: originSchema,
});

export const eventRecordSchema = z.object({
  id: idSchema,
  intentId: idSchema.nullable(),
  seq: z.number().int(),
  type: z.string(),
  actor: actorSchema,
  runId: idSchema.nullable(),
  revertsEventId: idSchema.nullable(),
  ops: z.array(storedOpSchema).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});

export type EventRecord = z.infer<typeof eventRecordSchema>;
