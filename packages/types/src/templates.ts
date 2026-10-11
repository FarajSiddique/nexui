import type { Template } from './graph.ts';

/** How the app names a template's plans, and a goal that starts one. */
export interface TemplateExample {
  /** Its plans, plural, as they read in a sentence: "trips". */
  plans: string;
  /** An example goal, for the + sheet's placeholder and its "Try one" buttons. */
  goal: string;
}

/**
 * Every template's example, in the order the + sheet offers them, or null for a template whose
 * app side hasn't shipped (job search, until its mobile PR). A template `templateSchema` lists
 * without an entry fails typecheck, so the app never offers a template it can't show.
 */
export const TEMPLATE_EXAMPLES: Record<Template, TemplateExample | null> = {
  travel: { plans: 'trips', goal: 'A week in Lisbon in May' },
  job_search: null,
};
