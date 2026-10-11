import { z } from 'zod';

import { timestampSchema, timeZoneSchema, type IntentRecord } from '@nexui/types';

/**
 * A job search's bookkeeping in `intents.context.jobs` (job search spec, section 3.1): the
 * device's time zone, when the build run was queued, and the last 300 job keys a scan
 * considered. None of it is plan content, so models never see it. PR 4 adds `scan` and
 * `nextCheckAt`.
 */
export const jobsContextSchema = z.strictObject({
  timezone: timeZoneSchema,
  startedAt: timestampSchema.optional(),
  seen: z.array(z.string().min(1).max(200)).max(300),
});

export type JobsContext = z.infer<typeof jobsContextSchema>;

/** The intent's job search bookkeeping, or null when it has none. */
export function jobsContext(intent: Pick<IntentRecord, 'context'>): JobsContext | null {
  const parsed = jobsContextSchema.safeParse(intent.context.jobs);

  return parsed.success ? parsed.data : null;
}

/** The whole context with `jobs` replaced: `update_intent` writes every key. */
export function withJobs(
  context: Record<string, unknown>,
  jobs: JobsContext,
): Record<string, unknown> {
  return { ...context, jobs };
}
