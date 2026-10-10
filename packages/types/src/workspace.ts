import { z } from 'zod';

import { kindNameSchema } from './kinds/registry.ts';
import { idSchema, relTypeSchema } from './primitives.ts';

/**
 * A figure a metric or allocation shows: `<anchor kind>.<figure>`, such as `trip.totalDays`, read
 * from the anchor's recomputed figures (`KIND_FIGURES`). A key for another anchor kind shows
 * nothing.
 */
export const derivedKeySchema = z
  .string()
  .max(60)
  .regex(/^[a-z]+\.[a-zA-Z]+$/);

export type DerivedKey = z.infer<typeof derivedKeySchema>;

// Top-level columns, or one key inside `data`.
const fieldPathSchema = z
  .string()
  .regex(/^(title|status|position|createdAt|updatedAt|data\.[A-Za-z][A-Za-z0-9]{0,39})$/);

export const refSchema = z.union([z.literal('intent'), z.strictObject({ objectId: idSchema })]);

export const fieldFilterSchema = z.strictObject({
  field: fieldPathSchema,
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.json(),
});

export type FieldFilter = z.infer<typeof fieldFilterSchema>;

export const graphQuerySchema = z.discriminatedUnion('from', [
  z.strictObject({
    from: z.literal('objects'),
    kind: z.union([kindNameSchema, z.array(kindNameSchema).min(1).max(8)]).optional(),
    related: z
      .strictObject({ type: relTypeSchema, to: refSchema, direction: z.enum(['out', 'in']) })
      .optional(),
    where: z.array(fieldFilterSchema).max(8).optional(),
    sort: z
      .union([
        z.literal('position'),
        z.strictObject({ field: fieldPathSchema, dir: z.enum(['asc', 'desc']) }),
      ])
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  z.strictObject({ from: z.literal('object'), id: idSchema }),
]);

export type GraphQuery = z.infer<typeof graphQuerySchema>;

const sectionBase = {
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  title: z.string().max(60).optional(),
  collapsed: z.boolean().optional(),
  // Lifted into the Open band while unresolved (spec section D).
  pin: z.literal('open').optional(),
};

const fieldSpecSchema = z.strictObject({
  field: fieldPathSchema,
  label: z.string().min(1).max(30),
  format: z.enum(['currency', 'days', 'hours', 'text']).optional(),
});

const metricSpecSchema = z.strictObject({
  label: z.string().min(1).max(30),
  derived: derivedKeySchema,
  format: z.enum(['days', 'currency', 'count']),
  emphasis: z.literal('whenPositive').optional(),
});

export const sectionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...sectionBase,
    type: z.literal('map'),
    places: graphQuerySchema,
    legs: graphQuerySchema.optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('route'),
    query: graphQuerySchema,
    editable: z.array(z.enum(['days', 'order'])).max(2),
    showUnallocated: z.boolean().optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('metric'),
    metrics: z.array(metricSpecSchema).min(1).max(4),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('allocation'),
    parts: graphQuerySchema,
    valueField: fieldPathSchema,
    labelField: fieldPathSchema,
    total: derivedKeySchema,
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('objectList'),
    query: graphQuerySchema,
    card: z.enum(['compact', 'rich']),
    empty: z.string().max(120).optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('comparison'),
    query: graphQuerySchema,
    fields: z.array(fieldSpecSchema).min(1).max(6),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('decision'),
    decisionId: idSchema,
    fields: z.array(fieldSpecSchema).max(6),
  }),
  z.strictObject({ ...sectionBase, type: z.literal('insight'), query: graphQuerySchema }),
]);

export type Section = z.infer<typeof sectionSchema>;

/** The workspace doc format this code writes and reads. */
export const WORKSPACE_DOC_VERSION = 1;

/**
 * Brings a stored workspace doc up to `WORKSPACE_DOC_VERSION` before it is parsed, as a kind's
 * `upgrade` does for object data. Format 1 is the only one so far, so a doc comes back as it was;
 * the first change to a section's shape adds its step here.
 */
export function upgradeWorkspace(doc: unknown): unknown {
  return doc;
}

// `version` is the doc format (1); the `workspaces.version` column counts revisions.
export const workspaceDocSchema = z
  .strictObject({
    version: z.literal(WORKSPACE_DOC_VERSION),
    anchorId: idSchema,
    sections: z.array(sectionSchema).max(30),
  })
  .refine((doc) => new Set(doc.sections.map((s) => s.id)).size === doc.sections.length, {
    message: 'Section ids must be unique',
    path: ['sections'],
  });

export type WorkspaceDoc = z.infer<typeof workspaceDocSchema>;
