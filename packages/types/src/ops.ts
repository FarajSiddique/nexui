import { z } from 'zod';

import {
  endpointTypeSchema,
  intentStatusSchema,
  intentSummarySchema,
  objectSourceSchema,
  originSchema,
} from './graph.ts';
import { KIND_REGISTRY, isKindName } from './kinds/registry.ts';
import { idSchema, relTypeSchema, timestampSchema } from './primitives.ts';
import { workspaceDocSchema } from './workspace.ts';

const hasKeys = (patch: object): boolean => Object.keys(patch).length > 0;

const titleSchema = z.string().trim().min(1).max(200).nullable();
const statusSchema = z.string().min(1).max(40).nullable();
const dataSchema = z.record(z.string(), z.unknown());
const positionSchema = z.number().nullable();
const metadataSchema = z.record(z.string(), z.unknown()).nullable();
const kindSchema = z.string().regex(/^[a-z_]{1,40}$/);

const relationshipFields = {
  id: idSchema,
  sourceType: endpointTypeSchema,
  sourceId: idSchema,
  targetType: endpointTypeSchema,
  targetId: idSchema,
  type: relTypeSchema,
};

/** Every change the graph accepts. Only the API builds these; clients send `UserOp`s. */
export const changesetOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('insert_object'),
    id: idSchema,
    kind: kindSchema,
    kindVersion: z.number().int().min(1),
    title: titleSchema,
    status: statusSchema,
    data: dataSchema,
    source: objectSourceSchema,
    position: positionSchema,
    origin: originSchema,
  }),
  z.strictObject({
    op: z.literal('update_object'),
    id: idSchema,
    expectedUpdatedAt: timestampSchema.optional(),
    patch: z
      .strictObject({
        title: titleSchema.optional(),
        status: statusSchema.optional(),
        data: dataSchema.optional(),
        source: objectSourceSchema.optional(),
        position: positionSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
    origin: originSchema,
  }),
  z.strictObject({ op: z.literal('delete_object'), id: idSchema, origin: originSchema }),
  z.strictObject({
    op: z.literal('insert_relationship'),
    ...relationshipFields,
    metadata: metadataSchema,
    origin: originSchema,
  }),
  z.strictObject({ op: z.literal('delete_relationship'), id: idSchema, origin: originSchema }),
  z.strictObject({ op: z.literal('set_workspace'), doc: workspaceDocSchema, origin: originSchema }),
  z.strictObject({
    op: z.literal('update_intent'),
    patch: z
      .strictObject({
        status: intentStatusSchema.optional(),
        summary: intentSummarySchema.optional(),
        context: dataSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
    origin: originSchema,
  }),
]);

export type ChangesetOp = z.infer<typeof changesetOpSchema>;

/** What a client may send: object and relationship edits, never provenance or layout. */
export const userOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('insert_object'),
    id: idSchema,
    kind: kindSchema,
    title: titleSchema.optional(),
    status: statusSchema.optional(),
    data: dataSchema,
    position: positionSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('update_object'),
    id: idSchema,
    expectedUpdatedAt: timestampSchema.optional(),
    patch: z
      .strictObject({
        title: titleSchema.optional(),
        status: statusSchema.optional(),
        data: dataSchema.optional(),
        position: positionSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
  }),
  z.strictObject({ op: z.literal('delete_object'), id: idSchema }),
  z.strictObject({
    op: z.literal('insert_relationship'),
    ...relationshipFields,
    metadata: metadataSchema.optional(),
  }),
  z.strictObject({ op: z.literal('delete_relationship'), id: idSchema }),
]);

export type UserOp = z.infer<typeof userOpSchema>;

/** Turns a client's ops into changeset ops: user-sourced, `direct`, current kind version. */
export function fromUserOps(ops: readonly UserOp[]): ChangesetOp[] {
  return ops.map((op): ChangesetOp => {
    switch (op.op) {
      case 'insert_object':
        return {
          op: 'insert_object',
          id: op.id,
          kind: op.kind,
          kindVersion: isKindName(op.kind) ? KIND_REGISTRY[op.kind].version : 1,
          title: op.title ?? null,
          status: op.status ?? null,
          data: op.data,
          source: { type: 'user' },
          position: op.position ?? null,
          origin: 'direct',
        };
      case 'insert_relationship':
        return { ...op, metadata: op.metadata ?? null, origin: 'direct' };
      default:
        return { ...op, origin: 'direct' };
    }
  });
}
