import type { SupabaseClient } from '@supabase/supabase-js';

import type { GraphSnapshot, RunInput, RunRecord, RunRoute } from '@nexui/types';

import {
  ChangesetConflictError,
  ChangesetInvalidError,
  createIntent,
  discardIntent,
  findActiveIntent,
  loadSnapshot,
  logLine,
  revertEvent,
  type CommitResult,
} from '#lib/graph';
import type { Upload } from '#lib/http';
import { chooseTemplate, routeAsk } from '#lib/perception';
import { createRun, latestBuildRun, scheduleRun, workRun, type RunWorker } from '#lib/runs';
import { applyCapability } from '#lib/staging';
import {
  TEMPLATES,
  templateFor,
  UNSUPPORTED_GOAL,
  type IntakeRead,
  type TemplateDefinition,
  type TemplateIntake,
} from '#lib/templates';
import type { OpenSession } from '#lib/ai';

export interface Orchestrator {
  /** The user's client: the plan's reads and writes are theirs, under RLS. */
  db: SupabaseClient;
  /** The user the API verified, whom runs are queued for. */
  userId: string;
  /** Opens the AI session that perceives the goal or ask. */
  openSession: OpenSession;
  /** Claims and executes the run after the response, with its own client and session. */
  worker: RunWorker;
}

/**
 * What `startIntent` did with a goal (job search spec, section 2): seeded a plan and queued the
 * run that fills it in; seeded a plan that waits for its intake (`start` queues the run); saved
 * a goal no template fits; or found the plan of this template already going.
 */
export type StartedIntent =
  | { outcome: 'started'; snapshot: GraphSnapshot; runId: string }
  | { outcome: 'awaiting_resume'; snapshot: GraphSnapshot }
  | { outcome: 'unsupported' }
  | { outcome: 'existing_search'; intentId: string };

export interface StartedAsk {
  runId: string;
  route: RunRoute;
}

// A trip with no run would sit empty forever; the run's error is what the user sees.
async function discardTrip(db: SupabaseClient, intentId: string): Promise<void> {
  try {
    await discardIntent(db, intentId);
  } catch (error) {
    console.error('[intents]', logLine(error, 'Could not discard a trip without a run'));
  }
}

/**
 * CreateIntent (spec section F): Jev picks the template, the template seeds the intent at once,
 * and a reasoning run is queued, which the worker claims after the response to fill it in. A
 * template with an intake waits for `start` instead; a `singleActive` one answers with the plan
 * already going. A goal no template fits is saved as an intent with no template, workspace or
 * run. If Jev can't read the goal, its `PerceptionFailedError` stands and nothing is created. If
 * the run can't be created, the seeded plan is deleted and the error is rethrown.
 */
export async function startIntent(
  deps: Orchestrator,
  goal: string,
  timezone = 'UTC',
): Promise<StartedIntent> {
  const session = deps.openSession('create_intent', goal);
  const choice = await chooseTemplate(session.evaluationModel, goal, {
    providerOptions: session.providerOptions('perception'),
  });

  // Saved, not planned: no workspace, no run and no model call beyond Jev.
  if (choice === 'unsupported') {
    await createIntent(deps.db, { goal, template: null, timezone });

    return { outcome: 'unsupported' };
  }

  const template = TEMPLATES[choice];

  if (template.singleActive) {
    const existing = await findActiveIntent(deps.db, choice);

    if (existing) {
      return { outcome: 'existing_search', intentId: existing };
    }
  }

  const snapshot = await createIntent(deps.db, { goal, template: choice, timezone });

  if (template.intake) {
    return { outcome: 'awaiting_resume', snapshot };
  }

  let run: RunRecord;

  try {
    run = await createRun(deps.worker.db, {
      userId: deps.userId,
      intentId: snapshot.intent.id,
      kind: 'create_intent',
      input: {
        text: goal,
        route: 'reasoning',
        template: choice,
        perception: 'model',
      },
    });
  } catch (error) {
    await discardTrip(deps.db, snapshot.intent.id);

    throw error;
  }

  scheduleRun(() => workRun(deps.worker, run.id));

  return { outcome: 'started', snapshot, runId: run.id };
}

/**
 * UserAsk (spec section F): Jev routes the request to edit, fast or reasoning, and the run starts
 * after the response. Refused while another run is working on the intent.
 */
export async function startAsk(
  deps: Orchestrator,
  intentId: string,
  text: string,
): Promise<StartedAsk> {
  const snapshot = await loadSnapshot(deps.db, intentId);

  if (!snapshot.workspace) {
    throw new ChangesetInvalidError(UNSUPPORTED_GOAL);
  }

  const session = deps.openSession('ask', text);
  const route = await routeAsk(
    session.evaluationModel,
    { text, goal: snapshot.intent.goal, summary: snapshot.intent.summary.line },
    { providerOptions: session.providerOptions('perception') },
  );
  const run = await createRun(deps.worker.db, {
    userId: deps.userId,
    intentId,
    kind: 'ask',
    input: { text, route: route.value, perception: route.source },
  });

  scheduleRun(() => workRun(deps.worker, run.id));

  return { runId: run.id, route: route.value };
}

export interface StartedPlan {
  snapshot: GraphSnapshot;
  runId: string;
  /** What reading the upload found. */
  intake: IntakeRead['outcome'];
}

// The plan's template and its intake, refused for a plan without one (a trip, a saved goal).
function intakeOf(snapshot: GraphSnapshot): {
  template: TemplateDefinition;
  intake: TemplateIntake;
} {
  const template = templateFor(snapshot.intent.template);
  const intake = template?.intake;

  if (!template || !intake || !snapshot.workspace) {
    throw new ChangesetInvalidError("That action isn't available.");
  }

  return { template, intake };
}

// Checks the file, then reads it with the fast tier. The session matches the plan's goal, as
// its build run's will, so mock mode finds the same fixture.
async function readIntake(
  deps: Pick<Orchestrator, 'openSession'>,
  snapshot: GraphSnapshot,
  intake: TemplateIntake,
  file: Upload | null,
): Promise<IntakeRead> {
  const refusal = file ? intake.refuse(file) : null;

  if (refusal) {
    throw new ChangesetInvalidError(refusal);
  }

  const session = deps.openSession('create_intent', snapshot.intent.goal);

  return intake.read(file, {
    model: session.languageModel('fast'),
    providerOptions: session.providerOptions('fast'),
  });
}

// A plan marked started with no run would refuse every retry, so the start is undone.
async function undoStart(db: SupabaseClient, eventId: string): Promise<void> {
  try {
    await revertEvent(db, eventId);
  } catch (error) {
    console.error('[intents]', logLine(error, 'Could not undo a start without a run'));
  }
}

/**
 * Starts a plan that waited for its intake (job search spec, section 4): reads the upload, if
 * there is one, once; stores what it found as one changeset, which marks the plan started; then
 * queues the build run, which the worker claims after the response, with the read's usage in
 * its input. A read that fails still starts the plan. A plan already started is a 409, unless its
 * build failed: then it starts again, reading only a new file and keeping what the plan has
 * (Decision 20); a plan without an intake, or a file the intake refuses, a 400. If the run can't
 * be queued, the start is undone and the error rethrown.
 *
 * Two edge cases. Overlapping `start` calls can both pass the `started` check and both read the
 * upload, but `create_run` locks the intent row and refuses a second working run (NXU12), and
 * the loser's commit is undone, so at most one build runs; the cost is one extra read. And only
 * a `failed` build can be started again: a build the user stopped stays started, and its plan
 * gets roles from the scheduled scan that comes with PR 4.
 */
export async function startPlan(
  deps: Orchestrator,
  intentId: string,
  file: Upload | null,
): Promise<StartedPlan> {
  const snapshot = await loadSnapshot(deps.db, intentId);
  const { template, intake } = intakeOf(snapshot);
  const started = intake.started(snapshot);

  if (started) {
    const build = await latestBuildRun(deps.db, intentId);

    if (build && build.status !== 'failed') {
      throw new ChangesetConflictError('This plan has already started.');
    }
  }

  // The first start always reads; a later one reads only a new file.
  let read: IntakeRead = { outcome: 'none', input: {}, usage: null };
  let committed: CommitResult | null = null;

  if (!started || file) {
    read = await readIntake(deps, snapshot, intake, file);
    committed = await applyCapability(deps.db, intentId, {
      name: intake.capability,
      input: { ...read.input, start: true },
    });
  }

  const input: RunInput = {
    text: snapshot.intent.goal,
    route: 'reasoning',
    template: template.name,
    perception: 'model',
  };

  if (read.usage) {
    input.intake = read.usage;
  }

  let run: RunRecord;

  try {
    run = await createRun(deps.worker.db, {
      userId: deps.userId,
      intentId,
      kind: 'create_intent',
      input,
    });
  } catch (error) {
    if (committed) {
      await undoStart(deps.db, committed.event.id);
    }

    throw error;
  }

  scheduleRun(() => workRun(deps.worker, run.id));

  return { snapshot: committed?.snapshot ?? snapshot, runId: run.id, intake: read.outcome };
}

/**
 * Replaces a started plan's intake document (job search spec, section 4, "Later uploads") as
 * one changeset, with Undo; used from the next scan on. A file that can't be read changes
 * nothing: a 400 with the intake's message.
 */
export async function replaceIntake(
  deps: Pick<Orchestrator, 'db' | 'openSession'>,
  intentId: string,
  file: Upload,
): Promise<CommitResult> {
  const snapshot = await loadSnapshot(deps.db, intentId);
  const { intake } = intakeOf(snapshot);

  if (!intake.started(snapshot)) {
    throw new ChangesetConflictError('Start this plan first.');
  }

  const read = await readIntake(deps, snapshot, intake, file);

  if (read.outcome !== 'read') {
    throw new ChangesetInvalidError(intake.unreadable);
  }

  return applyCapability(deps.db, intentId, {
    name: intake.capability,
    input: { ...read.input, start: false },
  });
}
