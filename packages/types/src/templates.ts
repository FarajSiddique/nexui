import type { Template } from './graph.ts';

/** How the app names a template's plans, and a goal that starts one. */
export interface TemplateExample {
  /** Its plans, plural, as they read in a sentence: "trips". */
  plans: string;
  /** An example goal, for the + sheet's placeholder and its "Try one" buttons. */
  goal: string;
}

/**
 * Every template's example, in the order the + sheet offers them. A template `templateSchema`
 * lists without one fails typecheck, so the app never offers a template the API can't plan,
 * and never misses one it can.
 */
export const TEMPLATE_EXAMPLES: Record<Template, TemplateExample> = {
  travel: { plans: 'trips', goal: 'A week in Lisbon in May' },
};
