import type { RunRecord } from '@nexui/types';

/** What the + sheet offers once an ask from inside a plan is done. */
export type AfterAsk = 'choice' | 'plan' | null;

/**
 * `choice` when the run put a question to the user, `plan` for any other run that succeeded,
 * and null while it works or after it failed or stopped (the run card offers Retry then).
 *
 * @example
 * afterAsk({ status: 'succeeded', progress: [{ capability: 'decision.propose', ok: true, … }] })
 * // 'choice'
 */
export function afterAsk(run: Pick<RunRecord, 'status' | 'progress'> | undefined): AfterAsk {
  if (run?.status !== 'succeeded') {
    return null;
  }

  return run.progress.some((entry) => entry.ok && entry.capability === 'decision.propose')
    ? 'choice'
    : 'plan';
}
