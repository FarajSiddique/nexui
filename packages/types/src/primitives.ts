import { z } from 'zod';

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });

/** The most characters a free-form JSON field (link metadata, action input) may serialize to. */
export const MAX_FREE_JSON_LENGTH = 2_000;

/** True when `value` serializes to at most `MAX_FREE_JSON_LENGTH` characters. */
export function fitsFreeJson(value: unknown): boolean {
  return JSON.stringify(value).length <= MAX_FREE_JSON_LENGTH;
}

/** Relationship types: part_of, option_of, leg_from, leg_to … */
export const relTypeSchema = z.string().regex(/^[a-z][a-z_]{0,39}$/);

/** Capability names such as `trip.setPlaceDays`. */
export const capabilityNameSchema = z
  .string()
  .max(60)
  .regex(/^[a-z]+(\.[a-zA-Z]+)+$/);

// Buttons an insight offers. They never carry model output as code: `ask` opens the + sheet
// prefilled, and `capability` names one registered, validated call.
export const insightActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ask'),
    label: z.string().min(1).max(40),
    prompt: z.string().min(1).max(300),
  }),
  z.strictObject({
    type: z.literal('capability'),
    label: z.string().min(1).max(40),
    name: capabilityNameSchema,
    input: z.record(z.string(), z.json()).refine(fitsFreeJson, 'Too much input.'),
  }),
]);

export type InsightAction = z.infer<typeof insightActionSchema>;
