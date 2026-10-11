import type { z } from 'zod';

import { jsonError } from './responses.ts';

/**
 * A request body checked against its schema: `{ data }`, or the 400 to send with a message
 * safe to show the user.
 *
 * @example
 * const parsed = parseBody(askRequestSchema, read.body, 'Ask in 2 to 1000 characters.', headers);
 *
 * if (parsed instanceof Response) {
 *   return parsed;
 * }
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  message: string,
  headers: HeadersInit,
): { data: T } | Response {
  const parsed = schema.safeParse(body);

  return parsed.success ? { data: parsed.data } : jsonError(message, 400, headers);
}
