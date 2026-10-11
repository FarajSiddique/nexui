import type { SupabaseClient } from '@supabase/supabase-js';

import type { GraphSnapshot, RunRecord, RunRoute } from '@nexui/types';

import {
  createIntent,
  discardIntent,
  ChangesetInvalidError,
  logLine,
  loadSnapshot,
} from '#lib/graph';
import { chooseTemplate, routeAsk } from '#lib/perception';
import { createRun, scheduleRun, workRun, type RunWorker } from '#lib/runs';
import { UNSUPPORTED_GOAL } from '#lib/templates';
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
 * run that fills it in, or saved a goal no template fits, with no plan and no run.
 */
export type StartedIntent =
  { outcome: 'started'; snapshot: GraphSnapshot; runId: string } | { outcome: 'unsupported' };

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
 * goal no template fits is saved as an intent with no template, workspace or run. If Jev can't read the goal, its
 * `PerceptionFailedError` stands and nothing is created. If the run can't be created, the
 * seeded plan is deleted and the error is rethrown.
 */
export async function startIntent(deps: Orchestrator, goal: string): Promise<StartedIntent> {
  const session = deps.openSession('create_intent', goal);
  const template = await chooseTemplate(session.evaluationModel, goal, {
    providerOptions: session.providerOptions('perception'),
  });

  // Saved, not planned: no workspace, no run and no model call beyond Jev.
  if (template === 'unsupported') {
    await createIntent(deps.db, goal, null);

    return { outcome: 'unsupported' };
  }

  const snapshot = await createIntent(deps.db, goal, template);
  let run: RunRecord;

  try {
    run = await createRun(deps.worker.db, {
      userId: deps.userId,
      intentId: snapshot.intent.id,
      kind: 'create_intent',
      input: {
        text: goal,
        route: 'reasoning',
        template,
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
