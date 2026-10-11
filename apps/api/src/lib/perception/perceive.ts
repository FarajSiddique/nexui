import { experimental_evaluate, type Experimental_EvaluationModel } from 'ai';

import type { RunRoute, Template } from '@nexui/types';

import type { GatewayOptions } from '#lib/ai';
import { TEMPLATES } from '#lib/templates';

/** A template, or `unsupported` for a goal no template fits: saved, but not planned. */
export type TemplateChoice = Template | 'unsupported';

/** An ask's route, and whether Jev gave it or the fallback did. */
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

/** Jev couldn't say which template fits a goal. `message` is safe to show the user. */
export class PerceptionFailedError extends Error {}

// The last choice. It names no template, so a new template never has to edit it.
const UNSUPPORTED = 'Anything else, such as a move, a wedding, buying a car or hiring for a team.';

// Each template's own sentence, then `unsupported`: a new template teaches routing by existing.
function templateCriteria(): Record<TemplateChoice, string> {
  const criteria = {} as Record<TemplateChoice, string>;

  for (const template of Object.values(TEMPLATES)) {
    criteria[template.name] = template.perception;
  }

  criteria.unsupported = UNSUPPORTED;

  return criteria;
}

/**
 * Jev's template question for a new goal (spec section F): each template's `perception`
 * sentence, then `unsupported`. Nexui doesn't guess (job search spec, section 2): if Jev fails,
 * runs out of time or picks a choice it wasn't offered (the AI SDK refuses that answer), this
 * throws `PerceptionFailedError` and the caller creates nothing.
 *
 * @example
 * await chooseTemplate(session.evaluationModel, 'Plan my wedding next June'); // 'unsupported'
 */
export async function chooseTemplate(
  model: Experimental_EvaluationModel,
  goal: string,
  options: PerceptionOptions = {},
): Promise<TemplateChoice> {
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

    return result.answers.template.choice;
  } catch {
    console.error('[perception]', 'Template routing failed.');

    throw new PerceptionFailedError("Nexui couldn't read that goal. Try again.");
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
