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
import { executeRun, scheduleRun, createRun } from '#lib/runs';
import type { OpenSession } from '#lib/ai';

export interface Orchestrator {
  /** The user's client: every read and write is theirs, under RLS. */
  db: SupabaseClient;
  openSession: OpenSession;
}

export interface StartedIntent {
  snapshot: GraphSnapshot;
  /** The run filling in the trip, or null for a goal that isn't a trip. */
  runId: string | null;
}

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
 * and a reasoning run fills it in after the response. A goal that isn't a trip gets a plain
 * intent and no run. If its run can't be created, the seeded trip is deleted and the error is
 * rethrown.
 */
export async function startIntent(deps: Orchestrator, goal: string): Promise<StartedIntent> {
  const session = deps.openSession('create_intent', goal);
  const template = await chooseTemplate(session.evaluationModel, goal, {
    providerOptions: session.providerOptions('perception'),
  });

  if (template.value === 'none') {
    return { snapshot: await createIntent(deps.db, goal, null), runId: null };
  }

  const snapshot = await createIntent(deps.db, goal, 'travel');
  let run: RunRecord;

  try {
    run = await createRun(deps.db, {
      intentId: snapshot.intent.id,
      kind: 'create_intent',
      input: { text: goal, route: 'reasoning', template: 'travel', perception: template.source },
    });
  } catch (error) {
    await discardTrip(deps.db, snapshot.intent.id);

    throw error;
  }

  scheduleRun(() => executeRun({ db: deps.db, run, session }));

  return { snapshot, runId: run.id };
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
    throw new ChangesetInvalidError('Nexui can only change trips so far.');
  }

  const session = deps.openSession('ask', text);
  const route = await routeAsk(
    session.evaluationModel,
    { text, goal: snapshot.intent.goal, summary: snapshot.intent.summary.line },
    { providerOptions: session.providerOptions('perception') },
  );
  const run = await createRun(deps.db, {
    intentId,
    kind: 'ask',
    input: { text, route: route.value, perception: route.source },
  });

  scheduleRun(() => executeRun({ db: deps.db, run, session }));

  return { runId: run.id, route: route.value };
}
