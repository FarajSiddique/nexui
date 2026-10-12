import type { IntentRecord, Template } from './graph.ts';
import { jobSearchStarted } from './kinds/jobs/intake.ts';

/** How the app names a template's plans, and a goal that starts one. */
export interface TemplateExample {
  /** Its plans, plural, as they read in a sentence: "trips". */
  plans: string;
  /** One plan with its article: "a trip". */
  one: string;
  /** The plan in a button's few words: "trip", as in "Open my trip". */
  short: string;
  /** An example goal, for the + sheet's placeholder and its "Try one" buttons. */
  goal: string;
}

/**
 * Every template's example, in the order the + sheet offers them, or null for a template whose
 * app side hasn't shipped. A template `templateSchema` lists without an entry fails typecheck, so
 * the app never offers a template it can't show.
 */
export const TEMPLATE_EXAMPLES: Record<Template, TemplateExample | null> = {
  travel: { plans: 'trips', one: 'a trip', short: 'trip', goal: 'A week in Lisbon in May' },
  job_search: {
    plans: 'job searches',
    one: 'a job search',
    short: 'search',
    goal: 'Find a senior designer role in Berlin',
  },
};

/**
 * A template that reads a document before its first run (job search spec, section 4): the + sheet's
 * step copy, and how the app tells the plan has started.
 */
export interface TemplateIntake {
  /** Above the step: "Planning this as a job search". */
  planning: string;
  title: string;
  detail: string;
  /** The button that picks a file. */
  add: string;
  /** The button that starts with none. */
  skip: string;
  /** Under the buttons. */
  note: string;
  /** While the file is read. */
  reading: string;
  /** In + when the plan started without the file it was sent. */
  unreadable: string;
  /** True once the plan's first run was queued: a new file then replaces the one it has. */
  started: (context: Readonly<Record<string, unknown>>) => boolean;
}

/** Each template's intake, or null for one that starts at once. */
export const TEMPLATE_INTAKES: Record<Template, TemplateIntake | null> = {
  travel: null,
  job_search: {
    planning: 'Planning this as a job search',
    title: 'Add your resume?',
    detail:
      "Nexui uses it to screen roles and tailor your drafts. It reads the PDF once and doesn't " +
      'keep the file.',
    add: 'Add resume (PDF)',
    skip: 'Continue without',
    note: 'Without it, Nexui searches on your goal alone. You can add it later from the plan.',
    reading: 'Reading your resume…',
    unreadable: "Couldn't read that PDF. Nexui started without it; add another from the plan.",
    started: jobSearchStarted,
  },
};

/**
 * Where a plan's upload goes: `start` before its first run, `resume` after, or null for a
 * template that takes no document.
 *
 * @example
 * intakeRoute({ template: 'job_search', context: { jobs: { startedAt: '…' } } }) // 'resume'
 */
export function intakeRoute(
  intent: Pick<IntentRecord, 'template' | 'context'>,
): 'start' | 'resume' | null {
  const intake = intent.template ? TEMPLATE_INTAKES[intent.template] : null;

  if (!intake) {
    return null;
  }

  return intake.started(intent.context) ? 'resume' : 'start';
}
