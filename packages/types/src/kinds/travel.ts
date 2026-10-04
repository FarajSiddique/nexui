import { z } from 'zod';

import { idSchema, insightActionSchema } from '../primitives.ts';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const moneySchema = z.strictObject({
  amount: z.number().min(0).max(1_000_000_000),
  currency: currencySchema,
});

export type Money = z.infer<typeof moneySchema>;

const isoDateSchema = z.iso.date();

/** The trip's calculated figures, written only by `derive.trip` (spec section D). */
export const tripDerivedSchema = z.strictObject({
  totalDays: z.number().int().nullable(),
  allocatedDays: z.number().int(),
  unallocatedDays: z.number().int().nullable(),
  estCost: moneySchema.nullable(),
  costIncomplete: z.boolean(),
});

export type TripDerived = z.infer<typeof tripDerivedSchema>;

// A data field ending in `Id` (such as a stay's `placeId`) holds a graph object id: the model
// sees it as a ref, not a raw id, so don't use the `Id` suffix for an external id.
export const tripDataSchema = z
  .strictObject({
    destinations: z.array(z.string().trim().min(1).max(100)).max(30),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    totalDays: z.number().int().min(1).max(365).optional(),
    travelers: z.number().int().min(1).max(50).optional(),
    budget: moneySchema.optional(),
    pace: z.enum(['slow', 'balanced', 'fast']).optional(),
    currency: currencySchema,
    derived: tripDerivedSchema.optional(),
  })
  .refine((trip) => !trip.startDate === !trip.endDate, {
    message: 'Give both dates or neither',
    path: ['endDate'],
  })
  .refine((trip) => !trip.startDate || !trip.endDate || trip.startDate < trip.endDate, {
    message: 'The trip must end after it starts',
    path: ['endDate'],
  });

export const placeDataSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  country: z.string().regex(/^[A-Z]{2}$/),
  placeType: z.enum(['city', 'region', 'town', 'area', 'site']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  days: z.number().int().min(0).max(365),
  estDailyCost: moneySchema.optional(),
  why: z.string().max(500).optional(),
});

export const legDataSchema = z.strictObject({
  mode: z.enum(['flight', 'train', 'bus', 'car', 'ferry', 'other']),
  estHours: z.number().min(0).max(200).optional(),
  estCost: moneySchema.optional(),
});

export const stayDataSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  placeId: idSchema,
  nights: z.number().int().min(1).max(365),
  estNightly: moneySchema.optional(),
  url: z.url().max(2000).optional(),
});

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

export type TripData = z.infer<typeof tripDataSchema>;
export type PlaceData = z.infer<typeof placeDataSchema>;
export type LegData = z.infer<typeof legDataSchema>;
export type StayData = z.infer<typeof stayDataSchema>;
export type DecisionData = z.infer<typeof decisionDataSchema>;
export type OptionData = z.infer<typeof optionDataSchema>;
export type InsightData = z.infer<typeof insightDataSchema>;
export type ThingData = z.infer<typeof thingDataSchema>;
