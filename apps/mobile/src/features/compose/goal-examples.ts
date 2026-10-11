import { TEMPLATE_EXAMPLES, type TemplateExample } from '@nexui/types';

/** Every template's example, in the order `TEMPLATE_EXAMPLES` lists them. */
export const GOAL_EXAMPLES: readonly TemplateExample[] = Object.values(TEMPLATE_EXAMPLES);

/**
 * What Nexui plans today, from each template's plans.
 *
 * @example
 * plansToday([{ plans: 'trips', goal: '…' }, { plans: 'job searches', goal: '…' }]);
 * // 'Today Nexui plans trips and job searches.'
 */
export function plansToday(examples: readonly TemplateExample[]): string {
  const plans = examples.map((example) => example.plans);
  const last = plans.at(-1) ?? '';
  const rest = plans.slice(0, -1);
  const list = rest.length > 0 ? `${rest.join(', ')} and ${last}` : last;

  return `Today Nexui plans ${list}.`;
}

/**
 * The example goal for the `turn`th new plan. Templates take turns, so with trips and job
 * searches the placeholder alternates between them (job search spec, section 2).
 *
 * @example
 * exampleGoal([trip, job], 3); // job.goal
 */
export function exampleGoal(examples: readonly TemplateExample[], turn: number): string {
  return examples[turn % examples.length]?.goal ?? '';
}

// How many new-plan placeholders this app session has shown.
let shown = 0;

/** The placeholder for the next new plan; each call takes the next template's turn. */
export function nextGoalPlaceholder(): string {
  const goal = exampleGoal(GOAL_EXAMPLES, shown);

  shown += 1;

  return goal;
}
