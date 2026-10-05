import { z } from 'zod';

import { idSchema, insightActionSchema } from '../primitives.ts';
import { legDataSchema } from './travel/schemas.ts';

// Kinds every template uses. An option's `placeId`, `suggestedDays`, `leg` and `extendPlaceId`
// are what the travel template's decision options carry (a pick adds a place to the route);
// other templates leave them out.

export const decisionDataSchema = z.strictObject({
  question: z.string().trim().min(1).max(200),
  status: z.enum(['open', 'resolved', 'dismissed']),
  chosenOptionId: idSchema.optional(),
  tradeoff: z.string().max(400).optional(),
  derivedKey: z.string().max(60).optional(),
  /** What the user asked the run that proposed this, shown as "You asked …". */
  asked: z.string().max(300).optional(),
});

export const optionDataSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  placeId: idSchema.optional(),
  summary: z.string().max(400),
  pros: z.array(z.string().max(120)).max(8),
  cons: z.array(z.string().max(120)).max(8),
  metrics: z
    .record(z.string().max(40), z.number())
    .refine((metrics) => Object.keys(metrics).length <= 12, 'At most 12 metrics.'),
  fit: z.string().max(120).optional(),
  /** Days the proposer suggests for this option's place when the trip has none free. */
  suggestedDays: z.number().int().min(1).max(365).optional(),
  /** How to reach this option's place from `fromPlaceId`, the last stop when it was proposed. */
  leg: legDataSchema.extend({ fromPlaceId: idSchema }).optional(),
  /** A stop already on the route that gets the days instead, for an option with no place. */
  extendPlaceId: idSchema.optional(),
});

export const insightDataSchema = z.strictObject({
  text: z.string().trim().min(1).max(160),
  detail: z.string().max(300).optional(),
  severity: z.enum(['info', 'attention']),
  derivedKey: z.string().max(60).optional(),
  actions: z.array(insightActionSchema).max(2),
});

export const thingDataSchema = z.strictObject({
  fields: z
    .array(z.strictObject({ label: z.string().min(1).max(60), value: z.string().max(500) }))
    .max(30),
});

export type DecisionData = z.infer<typeof decisionDataSchema>;
export type OptionData = z.infer<typeof optionDataSchema>;
export type InsightData = z.infer<typeof insightDataSchema>;
export type ThingData = z.infer<typeof thingDataSchema>;
