import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  runRecordSchema,
  runStatusSchema,
  type RunInput,
  type RunKind,
  type RunProgressEntry,
  type RunRecord,
  type RunStatus,
} from '@nexui/types';

import { GraphNotFoundError, mapRpcError } from '#lib/graph';

/**
 * A queued, running or stopping run older than this has stopped: every run must finish within
 * 15 minutes of creation (two leases plus cron slack). `reap_runs` settles such runs; reading
 * them as failed is the backstop for when the cron isn't running.
 */
export const RUN_STALE_MS = 15 * 60 * 1000;

export const STALE_RUN_ERROR = 'This run stopped unexpectedly.';

/** Tokens one model step used, added to `runs.model_usage`. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

type Row = Record<string, unknown>;

/**
 * One `runs` row (snake_case, from a function's `to_jsonb` or a table read) in contract shape.
 * A run still active after `RUN_STALE_MS` reads as failed, so a client never waits on a run
 * nothing is executing.
 */
export function mapRunRow(row: unknown, now: Date = new Date()): RunRecord {
  const run = row as Row;
  const record = runRecordSchema.parse({
    id: run.id,
    intentId: run.intent_id,
    kind: run.kind,
    status: run.status,
    input: run.input,
    progress: run.progress,
    error: run.error,
    modelUsage: run.model_usage,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
  });
  const active = isActiveRunStatus(record.status);

  if (active && now.getTime() - Date.parse(record.createdAt) > RUN_STALE_MS) {
    return { ...record, status: 'failed', error: STALE_RUN_ERROR };
  }

  return record;
}

/**
 * Queues a run on one of the caller's intents, for a worker to claim. Throws a 409-mapped error
 * while another run works on the intent.
 */
export async function createRun(
  db: SupabaseClient,
  run: { intentId: string; kind: RunKind; input: RunInput },
): Promise<RunRecord> {
  const { data, error } = await db.rpc('create_run', {
    p_intent_id: run.intentId,
    p_kind: run.kind,
    p_input: run.input,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return mapRunRow(data);
}

/** A run a worker claimed, with the lease every write as that run must present. */
export interface ClaimedRun {
  run: RunRecord;
  leaseId: string;
}

export interface ClaimOptions {
  /** One run (the request that created it), or null for the oldest runs nobody claimed. */
  runId: string | null;
  limit: number;
  leaseSeconds: number;
  /** The most runs holding a live lease at once, across every worker. */
  maxActive: number;
}

/** Claims runs for this worker with the service-role client. Empty when there is nothing to do. */
export async function claimRuns(db: SupabaseClient, options: ClaimOptions): Promise<ClaimedRun[]> {
  const { data, error } = await db.rpc('claim_runs', {
    p_run_id: options.runId,
    p_limit: options.limit,
    p_lease_seconds: options.leaseSeconds,
    p_max_active: options.maxActive,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return ((data ?? []) as Row[]).map((row) => ({
    run: mapRunRow(row),
    leaseId: String(row.lease_id),
  }));
}

/**
 * Settles runs whose worker is gone or that passed the deadline: retried, failed or cancelled
 * (see `reap_runs`). Returns how many it settled.
 */
export async function reapRuns(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('reap_runs');

  if (error) {
    throw mapRpcError(error);
  }

  return Number(data);
}

/**
 * Marks the run running and appends one step's calls and usage. Returns the run's status:
 * anything but `running` (a cancel) means stop after this step. Throws `RunLeaseLostError` when
 * the lease moved on.
 */
export async function recordRunStep(
  db: SupabaseClient,
  runId: string,
  leaseId: string,
  entries: readonly RunProgressEntry[],
  usage: RunUsage | null,
): Promise<RunStatus> {
  const { data, error } = await db.rpc('run_record_step', {
    p_run_id: runId,
    p_lease_id: leaseId,
    p_entries: entries,
    p_usage: usage ?? {},
  });

  if (error) {
    throw mapRpcError(error);
  }

  return runStatusSchema.parse(data);
}

/**
 * Ends the run. A stopping run ends cancelled, or failed when `status` is failed; a finished run
 * keeps its status. `error` must be safe to show the user.
 */
export async function finishRun(
  db: SupabaseClient,
  runId: string,
  leaseId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  error: string | null,
): Promise<RunRecord> {
  const result = await db.rpc('run_finish', {
    p_run_id: runId,
    p_lease_id: leaseId,
    p_status: status,
    p_error: error,
  });

  if (result.error) {
    throw mapRpcError(result.error);
  }

  return mapRunRow(result.data);
}

/**
 * Asks the run to stop. A running run moves to `stopping` and finishes the step it is taking;
 * anything else not yet finished is cancelled at once. A finished run comes back unchanged.
 */
export async function cancelRun(db: SupabaseClient, runId: string): Promise<RunRecord> {
  const { data, error } = await db.rpc('cancel_run', { p_run_id: runId });

  if (error) {
    throw mapRpcError(error);
  }

  return mapRunRow(data);
}

/** One of the caller's runs, read through RLS. */
export async function getRun(
  db: SupabaseClient,
  runId: string,
  now: Date = new Date(),
): Promise<RunRecord> {
  const { data, error } = await db.from('runs').select('*').eq('id', runId).maybeSingle();

  if (error) {
    throw mapRpcError(error);
  }

  if (!data) {
    throw new GraphNotFoundError('Not found.');
  }

  return mapRunRow(data, now);
}

/** The caller's intents with a run still working on them, for Home's "Drafting" badge. */
export async function activeRunIntentIds(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<Set<string>> {
  const since = new Date(now.getTime() - RUN_STALE_MS).toISOString();
  const { data, error } = await db
    .from('runs')
    .select('intent_id')
    .in('status', [...ACTIVE_RUN_STATUSES])
    .gte('created_at', since)
    .limit(100);

  if (error) {
    throw mapRpcError(error);
  }

  return new Set((data ?? []).map((row: { intent_id: unknown }) => String(row.intent_id)));
}
