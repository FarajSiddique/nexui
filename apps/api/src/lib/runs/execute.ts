import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { RunProgressEntry, RunRecord, RunRoute } from '@nexui/types';

import { CAPABILITIES } from '../capabilities/registry.ts';
import { createStager, type Stager } from '../capabilities/stage.ts';
import { CapabilityError, type Capability } from '../capabilities/types.ts';
import { instructionsFor, promptFor } from '../cognition/prompts.ts';
import {
  runModel,
  type ModelMode,
  type StepDecision,
  type StepReport,
} from '../cognition/run-model.ts';
import { capabilityForTool, toModelTools } from '../cognition/tools.ts';
import { commitChangeset, NothingToCommitError } from '../graph/commit.ts';
import {
  ChangesetConflictError,
  ChangesetInvalidError,
  GraphNotFoundError,
} from '../graph/errors.ts';
import { logLine } from '../graph/respond.ts';
import { loadSnapshot } from '../graph/snapshot.ts';
import { finishRun, recordRunStep } from './store.ts';
import type { AiSession, ModelTier } from '../ai/session.ts';

export interface RunJob {
  db: SupabaseClient;
  run: RunRecord;
  session: AiSession;
}

export interface RunDeps {
  clock?: () => Date;
  newId?: () => string;
  capabilities?: readonly Capability[];
}

// Spec section F: edit and fast take one fast-tier step (plus one correction); reasoning plans
// with tools for up to 8 steps.
const ROUTES: Record<RunRoute, { tier: ModelTier; mode: ModelMode; maxSteps: number }> = {
  edit: { tier: 'fast', mode: 'single', maxSteps: 2 },
  fast: { tier: 'fast', mode: 'single', maxSteps: 2 },
  reasoning: { tier: 'reasoning', mode: 'loop', maxSteps: 8 },
};

export const INVALID_RUN_ERROR = "Nexui couldn't make a valid change.";
export const FAILED_RUN_ERROR = "Nexui couldn't finish this.";
export const SKIPPED_STEP_ERROR = 'You changed this while Nexui was working, so Nexui skipped it.';

function runErrorMessage(error: unknown): string {
  if (error instanceof GraphNotFoundError) {
    return 'This plan no longer exists.';
  }

  if (
    error instanceof ChangesetInvalidError ||
    error instanceof ChangesetConflictError ||
    error instanceof CapabilityError
  ) {
    return error.message;
  }

  return FAILED_RUN_ERROR;
}

// AI SDK errors have stable names such as AI_APICallError, which are safe to log.
function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name.startsWith('AI_')) {
    return `A run failed (${error.name}).`;
  }

  return logLine(error, 'A run failed');
}

interface StepContext {
  db: SupabaseClient;
  intentId: string;
  runId: string;
  stager: Stager;
  clock: () => Date;
  newId: () => string;
  capabilities: readonly Capability[];
}

// Flips each entry `restage` dropped to ok:false, so progress shows why nothing committed for it.
function markSkipped(entries: RunProgressEntry[], indexes: readonly number[]): void {
  const dropped = new Set(indexes);

  entries.forEach((entry, index) => {
    if (dropped.has(index)) {
      entry.ok = false;
      entry.error = SKIPPED_STEP_ERROR;
    }
  });
}

// Commits the step's ops as one changeset, then records the step. If the user changed the intent
// meanwhile, the step is replayed over their changes first. A commit error is recorded first and
// then thrown, which fails the run with its steps so far kept.
async function commitStep(step: StepContext, report: StepReport): Promise<StepDecision> {
  for (const call of report.refused) {
    const name = capabilityForTool(call.toolName, step.capabilities);

    if (name) {
      step.stager.recordRefused(name, call.input);
    }
  }

  const ops = step.stager.takeOps();
  const entries = step.stager.takeEntries().map((entry) => ({ ...entry, step: report.step }));
  let failure: { error: unknown } | null = null;

  if (ops.length > 0) {
    try {
      const committed = await commitChangeset(
        step.db,
        {
          intentId: step.intentId,
          actor: 'ai',
          runId: step.runId,
          ops,
          restage: (current) => step.stager.restage(current),
        },
        step.clock(),
        step.newId,
      );

      markSkipped(entries, step.stager.takeSkipped());
      step.stager.reset(committed.snapshot);
    } catch (error) {
      if (error instanceof NothingToCommitError) {
        markSkipped(entries, step.stager.takeSkipped());
        step.stager.reset(await loadSnapshot(step.db, step.intentId));
      } else {
        failure = { error };
      }
    }
  }

  const status = await recordRunStep(step.db, step.runId, entries, report.usage);

  if (failure) {
    throw failure.error;
  }

  return status === 'running' ? 'continue' : 'stop';
}

/**
 * Runs one AI request to the end (spec section F). Each model step's calls commit as one
 * changeset, so Undo in Changes reverts a step; Stop lets the current step commit, then the
 * run ends cancelled; a failure keeps the committed steps. Never throws: the outcome is
 * written to the run.
 */
export async function executeRun(job: RunJob, deps: RunDeps = {}): Promise<void> {
  const { db, run, session } = job;
  const clock = deps.clock ?? ((): Date => new Date());
  const newId = deps.newId ?? randomUUID;
  const capabilities = deps.capabilities ?? CAPABILITIES;

  try {
    const intentId = run.intentId;

    if (!intentId) {
      throw new GraphNotFoundError('Not found.');
    }

    if ((await recordRunStep(db, run.id, [], null)) !== 'running') {
      return;
    }

    const snapshot = await loadSnapshot(db, intentId);
    const stager = createStager({
      capabilities,
      snapshot,
      actor: 'ai',
      runId: run.id,
      request: run.input.text,
      newId,
      clock,
    });
    const route = ROUTES[run.input.route];
    const step: StepContext = { db, intentId, runId: run.id, stager, clock, newId, capabilities };
    const outcome = await runModel({
      model: session.languageModel(route.tier),
      providerOptions: session.providerOptions(route.tier),
      instructions: instructionsFor(run.kind, run.input.route),
      prompt: promptFor(snapshot, stager.refs, run.input.text),
      tools: toModelTools(capabilities, stager),
      mode: route.mode,
      maxSteps: route.maxSteps,
      onStep: (report) => commitStep(step, report),
    });

    if (outcome === 'invalid') {
      await finishRun(db, run.id, 'failed', INVALID_RUN_ERROR);
    } else if (outcome === 'stopped') {
      await finishRun(db, run.id, 'cancelled', null);
    } else {
      await finishRun(db, run.id, 'succeeded', null);
    }
  } catch (error) {
    console.error('[runs]', describeFailure(error));

    try {
      await finishRun(db, run.id, 'failed', runErrorMessage(error));
    } catch {
      console.error('[runs]', 'Could not record a failed run.');
    }
  }
}
