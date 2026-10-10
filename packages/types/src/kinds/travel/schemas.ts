import { z } from 'zod';

import { idSchema } from '../../primitives.ts';
import { currencySchema, moneySchema } from '../money.ts';

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

export type TripData = z.infer<typeof tripDataSchema>;
export type PlaceData = z.infer<typeof placeDataSchema>;
export type LegData = z.infer<typeof legDataSchema>;
export type StayData = z.infer<typeof stayDataSchema>;
