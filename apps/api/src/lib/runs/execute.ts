import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { RunProgressEntry, RunRecord, RunRoute } from '@nexui/types';

import { CapabilityError, type Capability } from '#lib/capabilities';
import {
  instructionsFor,
  promptFor,
  runModel,
  type StepDecision,
  type StepReport,
  capabilityForTool,
  toModelTools,
  type ModelLookups,
} from '#lib/cognition';
import {
  changesetLabel,
  commitChangeset,
  NothingToCommitError,
  ChangesetConflictError,
  ChangesetInvalidError,
  GraphNotFoundError,
  logLine,
  loadSnapshot,
  RunLeaseLostError,
} from '#lib/graph';
import { createStager, templateOf, type Stager } from '#lib/staging';
import type { RouteBudget, TemplateDefinition } from '#lib/templates';
import type { AiSession } from '#lib/ai';

import { finishRun, recordRunStep, type RunUsage } from './store.ts';

export interface RunJob {
  /** The worker's service-role client; every run write names the run and its lease. */
  db: SupabaseClient;
  run: RunRecord;
  leaseId: string;
  session: AiSession;
}

export interface RunDeps {
  clock?: () => Date;
  newId?: () => string;
  capabilities?: readonly Capability[];
  /** Settings lookups read, such as API keys: `process.env` unless a test passes its own. */
  env?: Record<string, string | undefined>;
  /** Replaces the template's work after a build (`afterBuild`), for tests. */
  afterBuild?: TemplateDefinition['afterBuild'];
}

// Spec section F: edit and fast take one fast-tier step (plus one correction); reasoning plans
// with tools for up to 8 steps. A template may set its own.
const ROUTES: Record<RunRoute, RouteBudget> = {
  edit: { tier: 'fast', mode: 'single', maxSteps: 2 },
  fast: { tier: 'fast', mode: 'single', maxSteps: 2 },
  reasoning: { tier: 'reasoning', mode: 'loop', maxSteps: 8 },
};

/** A route's model budget: the template's own when it sets one, else the default. */
export function routeBudget(
  template: Pick<TemplateDefinition, 'routes'>,
  route: RunRoute,
): RouteBudget {
  return template.routes?.[route] ?? ROUTES[route];
}

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
  leaseId: string;
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

// The step's label: the calls that ran and still apply after any replay.
function stepLabel(
  entries: readonly RunProgressEntry[],
  skipped: readonly number[],
): string | undefined {
  return changesetLabel(
    entries
      .filter((entry, index) => entry.ok && !skipped.includes(index))
      .map((entry) => entry.label),
  );
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
          run: { id: step.runId, lease: step.leaseId },
          ops,
          restage: (current) => step.stager.restage(current),
          label: () => stepLabel(entries, step.stager.peekSkipped()),
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

  const status = await recordRunStep(step.db, step.runId, step.leaseId, entries, report.usage);

  if (failure) {
    throw failure.error;
  }

  return status === 'running' ? 'continue' : 'stop';
}

// The template's work after a build run's model steps commits as one changeset, labelled by its
// calls. Its calls stay out of the run's progress, which holds the model's alone, so a recorded
// fixture never replays a scan.
async function commitWork(step: StepContext, usage: RunUsage | null): Promise<void> {
  const ops = step.stager.takeOps();
  const entries = step.stager.takeEntries();

  if (ops.length > 0) {
    try {
      const committed = await commitChangeset(
        step.db,
        {
          intentId: step.intentId,
          actor: 'ai',
          run: { id: step.runId, lease: step.leaseId },
          ops,
          restage: (current) => step.stager.restage(current),
          label: () =>
            changesetLabel(entries.filter((entry) => entry.ok).map((entry) => entry.label)),
        },
        step.clock(),
        step.newId,
      );

      step.stager.reset(committed.snapshot);
    } catch (error) {
      if (!(error instanceof NothingToCommitError)) {
        throw error;
      }

      step.stager.reset(await loadSnapshot(step.db, step.intentId));
    }

    step.stager.takeSkipped();
  }

  await recordRunStep(step.db, step.runId, step.leaseId, [], usage);
}

// A build run's template work (`afterBuild`), such as job search's first scan. A Stop that
// landed after the last model step skips it. The model's steps are committed, so what the
// template adds after them never fails the run: only a lost lease ends it, since the run is no
// longer this worker's (Decision 11).
async function runAfterBuild(
  job: RunJob,
  step: StepContext,
  template: TemplateDefinition,
  deps: RunDeps,
): Promise<void> {
  const afterBuild = deps.afterBuild ?? template.afterBuild;

  if (job.run.kind !== 'create_intent' || !afterBuild) {
    return;
  }

  if ((await recordRunStep(step.db, step.runId, step.leaseId, [], null)) !== 'running') {
    return;
  }

  const snapshot = step.stager.graph();

  try {
    await afterBuild({
      snapshot,
      anchorId: snapshot.workspace?.doc.anchorId ?? '',
      session: job.session,
      env: deps.env ?? process.env,
      fetch: globalThis.fetch,
      now: step.clock(),
      call: (name, input) => step.stager.call(name, input),
      commit: (usage) => commitWork(step, usage),
    });
  } catch (error) {
    if (error instanceof RunLeaseLostError) {
      throw error;
    }

    console.error('[runs]', logLine(error, "A build run's work after its steps failed"));
  }
}

/**
 * Runs one claimed AI request to the end (spec section F). Each model step's calls commit as one
 * changeset, so Undo in Changes reverts a step; Stop lets the current step commit, then the
 * run ends cancelled; a failure keeps the committed steps. Never throws: the outcome is
 * written to the run, unless the lease moved on, when the run is no longer this worker's.
 */
export async function executeRun(job: RunJob, deps: RunDeps = {}): Promise<void> {
  const { db, run, leaseId, session } = job;
  const clock = deps.clock ?? ((): Date => new Date());
  const newId = deps.newId ?? randomUUID;

  try {
    const intentId = run.intentId;

    if (!intentId) {
      throw new GraphNotFoundError('Not found.');
    }

    // The opening step carries an intake read's usage, when one came before this build run.
    if ((await recordRunStep(db, run.id, leaseId, [], run.input.intake ?? null)) !== 'running') {
      return;
    }

    const snapshot = await loadSnapshot(db, intentId);
    const template = templateOf(snapshot);
    const capabilities = deps.capabilities ?? template.capabilities;
    const stager = createStager({
      capabilities,
      snapshot,
      actor: 'ai',
      runId: run.id,
      request: run.input.text,
      newId,
      clock,
    });
    const budget = routeBudget(template, run.input.route);
    const lookups: ModelLookups = {
      tools: template.lookups ?? [],
      // Read per call: the staged plan has moved on, and tests stub `fetch` after loading.
      context: () => ({
        graph: stager.graph(),
        refs: stager.refs,
        env: deps.env ?? process.env,
        fetch: globalThis.fetch,
        now: clock(),
      }),
    };
    const step: StepContext = {
      db,
      intentId,
      runId: run.id,
      leaseId,
      stager,
      clock,
      newId,
      capabilities,
    };
    const outcome = await runModel({
      model: session.languageModel(budget.tier),
      providerOptions: session.providerOptions(budget.tier),
      instructions: instructionsFor(template, run.kind, run.input.route),
      prompt: promptFor(snapshot, stager.refs, run.input.text),
      tools: toModelTools(capabilities, stager, lookups),
      mode: budget.mode,
      maxSteps: budget.maxSteps,
      onStep: (report) => commitStep(step, report),
    });

    if (outcome === 'invalid') {
      await finishRun(db, run.id, leaseId, 'failed', INVALID_RUN_ERROR);
    } else if (outcome === 'stopped') {
      await finishRun(db, run.id, leaseId, 'cancelled', null);
    } else {
      await runAfterBuild(job, step, template, deps);
      await finishRun(db, run.id, leaseId, 'succeeded', null);
    }
  } catch (error) {
    if (error instanceof RunLeaseLostError) {
      console.error('[runs]', 'A run moved on from this worker.');

      return;
    }

    console.error('[runs]', describeFailure(error));

    try {
      await finishRun(db, run.id, leaseId, 'failed', runErrorMessage(error));
    } catch {
      console.error('[runs]', 'Could not record a failed run.');
    }
  }
}
