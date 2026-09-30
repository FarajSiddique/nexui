import type { SupabaseClient } from '@supabase/supabase-js';

import type { GraphSnapshot, RunRoute } from '@nexui/types';

import { createIntent } from '../graph/commit.ts';
import { ChangesetInvalidError } from '../graph/errors.ts';
import { loadSnapshot } from '../graph/snapshot.ts';
import { chooseTemplate, routeAsk } from '../perception/perceive.ts';
import { executeRun } from '../runs/execute.ts';
import { scheduleRun } from '../runs/schedule.ts';
import { createRun } from '../runs/store.ts';
import type { OpenSession } from '../ai/session.ts';

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

/**
 * CreateIntent (spec section F): Jev picks the template, the template seeds the intent at once,
 * and a reasoning run fills it in after the response. A goal that isn't a trip gets a plain
 * intent and no run.
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
  const run = await createRun(deps.db, {
    intentId: snapshot.intent.id,
    kind: 'create_intent',
    input: { text: goal, route: 'reasoning', template: 'travel', perception: template.source },
  });

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
