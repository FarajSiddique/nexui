import { z } from 'zod';

import { timestampSchema, type Template } from '@nexui/types';

import { templateFor } from './registry.ts';

// The tag the eval scripts put on a plan they make (`scripts/eval-travel.mjs`).
const evalTagSchema = z.strictObject({
  suite: z.string().min(1).max(40),
  case: z.string().min(1).max(60),
  at: timestampSchema,
});

/**
 * What `intents.context` may hold for an intent of this template: the template's own keys and
 * the eval tag, nothing else (readiness doc, section 3.7). An intent without a template may hold
 * only the tag. `update_intent` replaces the whole context, so a write carries every key.
 */
export function contextSchemaFor(name: Template | null): z.ZodType {
  return z.strictObject({ eval: evalTagSchema.optional(), ...templateFor(name)?.context });
}
