import type { SupabaseClient } from '@supabase/supabase-js';

import { sessionOpener, type OpenSession } from '#lib/ai';
import { logLine } from '#lib/graph';
import { getAdminClient } from '#lib/supabase';

import { executeRun } from './execute.ts';
import { scheduleRun } from './schedule.ts';
import { claimRuns, reapRuns, type ClaimedRun } from './store.ts';

/** Outlasts the 300-second function limit, so a live worker never loses its lease. */
export const RUN_LEASE_SECONDS = 330;

/** The most runs one sweep claims; the rest wait for the next minute's sweep. */
export const RUN_SWEEP_LIMIT = 10;

export const DEFAULT_RUN_MAX_ACTIVE = 100;

/** What executes runs: the service-role client, the AI, and the cap on runs at once. */
export interface RunWorker {
  db: SupabaseClient;
  openSession: OpenSession;
  maxActive: number;
}

export interface SweepResult {
  reaped: number;
  claimed: number;
}

type Env = Record<string, string | undefined>;

/** `RUN_MAX_ACTIVE` as a positive whole number, or the default of 100. */
export function readRunMaxActive(env: Env = process.env): number {
  const value = Number(env.RUN_MAX_ACTIVE?.trim() || DEFAULT_RUN_MAX_ACTIVE);

  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RUN_MAX_ACTIVE;
}

/** The worker for this deployment. Throws `SupabaseConfigurationError` without the secret key. */
export function runWorker(env: Env = process.env): RunWorker {
  return {
    db: getAdminClient(env),
    openSession: sessionOpener(env),
    maxActive: readRunMaxActive(env),
  };
}

// A run reopens its AI session from what was asked; mock mode finds the same fixture again.
async function execute(worker: RunWorker, claimed: ClaimedRun): Promise<void> {
  const { run, leaseId } = claimed;

  await executeRun({
    db: worker.db,
    run,
    leaseId,
    session: worker.openSession(run.kind, run.input.text),
  });
}

/**
 * Claims one run and executes it: the request that created it calls this from `after()`. Does
 * nothing when the run is already claimed, finished or over the cap, since the cron's sweep
 * starts it then. Never throws.
 */
export async function workRun(worker: RunWorker, runId: string): Promise<void> {
  try {
    const [claimed] = await claimRuns(worker.db, {
      runId,
      limit: 1,
      leaseSeconds: RUN_LEASE_SECONDS,
      maxActive: worker.maxActive,
    });

    if (claimed) {
      await execute(worker, claimed);
    }
  } catch (error) {
    console.error('[runs]', logLine(error, 'Could not claim a run'));
  }
}

/**
 * The cron's pass over the queue: settles runs whose worker is gone, then claims runs nobody
 * started and schedules each to execute after the response.
 */
export async function sweepRuns(worker: RunWorker): Promise<SweepResult> {
  const reaped = await reapRuns(worker.db);
  const claimed = await claimRuns(worker.db, {
    runId: null,
    limit: RUN_SWEEP_LIMIT,
    leaseSeconds: RUN_LEASE_SECONDS,
    maxActive: worker.maxActive,
  });

  for (const run of claimed) {
    scheduleRun(() => execute(worker, run));
  }

  return { reaped, claimed: claimed.length };
}
