import { experimental_evaluate, type Experimental_EvaluationModel } from 'ai';

import type { RunRoute, Template } from '@nexui/types';

import type { GatewayOptions } from '#lib/ai';
import { TEMPLATES } from '#lib/templates';

/** A template, or `none` for a goal no template fits. */
export type TemplateChoice = Template | 'none';

/** A perception answer, and whether Jev gave it or the fallback did. */
export interface Perceived<T> {
  value: T;
  source: 'model' | 'fallback';
}

export interface PerceptionOptions {
  providerOptions?: GatewayOptions;
  timeoutMs?: number;
}

/** Perception runs before the response is sent, so it gets a short budget. */
export const PERCEPTION_TIMEOUT_MS = 5_000;

// The routing build (job search spec, section 2) replaces `none` with `unsupported`.
const NO_TEMPLATE =
  'Anything that is not a trip, such as a job search, a project, a purchase or a habit.';

// Each template's own sentence, then `none`: a new template teaches routing by existing.
function templateCriteria(): Record<TemplateChoice, string> {
  const criteria = {} as Record<TemplateChoice, string>;

  for (const template of Object.values(TEMPLATES)) {
    criteria[template.name] = template.perception;
  }

  criteria.none = NO_TEMPLATE;

  return criteria;
}

/**
 * Jev's template question for a new goal (spec section F). If Jev can't answer, the goal is
 * treated as a trip, because travel is the only template in slice 1.
 */
export async function chooseTemplate(
  model: Experimental_EvaluationModel,
  goal: string,
  options: PerceptionOptions = {},
): Promise<Perceived<TemplateChoice>> {
  try {
    const result = await experimental_evaluate({
      model,
      state: { goal },
      questions: {
        template: {
          type: 'choice',
          instructions: 'Someone typed this goal to start a plan. Which template fits it?',
          criteria: templateCriteria(),
        },
      },
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? PERCEPTION_TIMEOUT_MS),
      maxRetries: 1,
      providerOptions: options.providerOptions,
    });

    return { value: result.answers.template.choice, source: 'model' };
  } catch {
    console.error('[perception]', 'Template routing failed; treating the goal as a trip.');

    return { value: 'travel', source: 'fallback' };
  }
}

export interface AskContext {
  text: string;
  goal: string;
  /** The intent's summary line, so Jev knows what exists. */
  summary: string;
}

/**
 * Jev's route question for an ask: `edit` and `fast` use the fast tier for one step, and
 * `reasoning` plans with tools (spec section F). If Jev can't answer, the ask gets `reasoning`,
 * which can do anything the others can.
 */
export async function routeAsk(
  model: Experimental_EvaluationModel,
  ask: AskContext,
  options: PerceptionOptions = {},
): Promise<Perceived<RunRoute>> {
  try {
    const result = await experimental_evaluate({
      model,
      state: { goal: ask.goal, plan: ask.summary, request: ask.text },
      questions: {
        route: {
          type: 'choice',
          instructions: 'Someone asked Nexui to change their plan. How much work does it need?',
          criteria: {
            edit:
              'One direct change to something already in the plan, such as giving a stop 3 ' +
              'days, renaming it or removing it.',
            fast: 'A small addition, or a change to how the plan is shown, done in one step.',
            reasoning:
              'Ideas, suggestions, comparisons or several coordinated changes, such as ' +
              'finding somewhere new to go or reworking the route.',
          },
        },
      },
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? PERCEPTION_TIMEOUT_MS),
      maxRetries: 1,
      providerOptions: options.providerOptions,
    });

    return { value: result.answers.route.choice, source: 'model' };
  } catch {
    console.error('[perception]', 'Ask routing failed; using the reasoning tier.');

    return { value: 'reasoning', source: 'fallback' };
  }
}
