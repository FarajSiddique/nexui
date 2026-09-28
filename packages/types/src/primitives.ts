import { z } from 'zod';

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });

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
    input: z.record(z.string(), z.json()),
  }),
]);

export type InsightAction = z.infer<typeof insightActionSchema>;
