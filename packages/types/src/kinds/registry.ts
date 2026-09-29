import { z } from 'zod';

import {
  decisionDataSchema,
  insightDataSchema,
  legDataSchema,
  optionDataSchema,
  placeDataSchema,
  stayDataSchema,
  thingDataSchema,
  tripDataSchema,
} from './travel.ts';

/** A registered object kind: its current version, schema, and how to upgrade older data. */
export interface KindDefinition {
  version: number;
  schema: z.ZodType;
  upgrade: (data: unknown, fromVersion: number) => unknown;
}

const unchanged = (data: unknown): unknown => data;

// Adding a kind means adding it here; the database needs no migration (spec section C).
export const KIND_REGISTRY = {
  trip: { version: 1, schema: tripDataSchema, upgrade: unchanged },
  place: { version: 1, schema: placeDataSchema, upgrade: unchanged },
  leg: { version: 1, schema: legDataSchema, upgrade: unchanged },
  stay: { version: 1, schema: stayDataSchema, upgrade: unchanged },
  decision: { version: 1, schema: decisionDataSchema, upgrade: unchanged },
  option: { version: 1, schema: optionDataSchema, upgrade: unchanged },
  insight: { version: 1, schema: insightDataSchema, upgrade: unchanged },
  thing: { version: 1, schema: thingDataSchema, upgrade: unchanged },
} satisfies Record<string, KindDefinition>;

export type KindName = keyof typeof KIND_REGISTRY;

export const kindNameSchema = z.enum(Object.keys(KIND_REGISTRY) as [KindName, ...KindName[]]);

export function isKindName(value: string): value is KindName {
  return Object.hasOwn(KIND_REGISTRY, value);
}

export type ParsedKindData =
  { ok: true; data: Record<string, unknown>; version: number } | { ok: false; message: string };

/**
 * Validates an object's `data` for its kind, upgrading older versions first.
 *
 * @example
 * parseKindData('place', { name: 'Tokyo', days: -1 }) // { ok: false, message: 'Invalid place: days …' }
 */
export function parseKindData(kind: string, data: unknown, version?: number): ParsedKindData {
  if (!isKindName(kind)) {
    return { ok: false, message: `Unknown kind "${kind}".` };
  }

  const definition: KindDefinition = KIND_REGISTRY[kind];
  const upgraded =
    version !== undefined && version < definition.version
      ? definition.upgrade(data, version)
      : data;
  const parsed = definition.schema.safeParse(upgraded);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'data';

    return { ok: false, message: `Invalid ${kind}: ${field} ${issue?.message ?? 'is invalid'}` };
  }

  return { ok: true, data: parsed.data as Record<string, unknown>, version: definition.version };
}
