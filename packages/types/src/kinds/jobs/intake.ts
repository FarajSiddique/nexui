import { z } from 'zod';

// What the app reads of a job search's `context.jobs`: only whether `start` has queued its
// build. The API owns the rest (`apps/api/src/lib/jobs/context.ts`).
const startedSchema = z.object({ jobs: z.object({ startedAt: z.string().min(1) }) });

/**
 * True once `POST /api/intents/[id]/start` has queued a job search's build run.
 *
 * @example
 * jobSearchStarted({ jobs: { timezone: 'UTC', seen: [] } }) // false
 */
export function jobSearchStarted(context: Readonly<Record<string, unknown>>): boolean {
  return startedSchema.safeParse(context).success;
}
