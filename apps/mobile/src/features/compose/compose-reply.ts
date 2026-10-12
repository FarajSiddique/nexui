import type { CreateIntentResponse } from '@nexui/types';

/**
 * What the + sheet shows under a sent message. A run started by `start` (`restart`) retries by
 * starting again; any other retries by sending the text again.
 */
export type Reply =
  | { type: 'run'; runId: string; restart: boolean }
  | { type: 'saved' }
  | { type: 'resume' }
  | { type: 'existing' };

/**
 * The sheet's next step after a new goal (job search spec, sections 2 and 4): stream the plan's
 * run, say the goal was saved, ask for the plan's resume, or offer the plan already going.
 */
export function replyFor(result: CreateIntentResponse): Reply {
  switch (result.outcome) {
    case 'started':
      return { type: 'run', runId: result.runId, restart: false };
    case 'unsupported':
      return { type: 'saved' };
    case 'awaiting_resume':
      return { type: 'resume' };
    case 'existing_search':
      return { type: 'existing' };
  }
}

/** The plan the sheet acts on next, or null after a saved goal: the next send starts a new plan. */
export function targetOf(result: CreateIntentResponse): string | null {
  switch (result.outcome) {
    case 'started':
    case 'awaiting_resume':
      return result.snapshot.intent.id;
    case 'existing_search':
      return result.intentId;
    case 'unsupported':
      return null;
  }
}
