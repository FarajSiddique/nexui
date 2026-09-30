import {
  generateText,
  ToolChoiceViolationError,
  type LanguageModel,
  type StopCondition,
  type ToolSet,
} from 'ai';

import type { GatewayOptions } from '../ai/config.ts';
import type { RunUsage } from '../runs/store.ts';

/** `single`: one forced tool step plus one correction (edit, fast). `loop`: plan with tools. */
export type ModelMode = 'single' | 'loop';

export interface StepReport {
  step: number;
  /** Some tool call in the step was refused. */
  hadErrors: boolean;
  usage: RunUsage;
}

export type StepDecision = 'continue' | 'stop';

export interface RunModelInput {
  model: LanguageModel;
  providerOptions: GatewayOptions;
  instructions: string;
  prompt: string;
  tools: ToolSet;
  mode: ModelMode;
  maxSteps: number;
  /** Commits and records the step. `stop` ends the loop (a cancel); a throw fails it. */
  onStep: (report: StepReport) => Promise<StepDecision>;
}

export type ModelOutcome = 'finished' | 'stopped' | 'invalid';

/**
 * Runs the model's tool loop and hands each step to `onStep` before the next one starts.
 * `onStep` errors would be swallowed by the AI SDK's callback, so they are held here, stop the
 * loop through `stopWhen`, and are rethrown.
 */
export async function runModel(input: RunModelInput): Promise<ModelOutcome> {
  let outcome: ModelOutcome | null = null;
  let failure: { error: unknown } | null = null;
  let invalidStreak = 0;
  let lastClean = false;

  const stopWhen: StopCondition<ToolSet> = ({ steps }) =>
    outcome !== null ||
    failure !== null ||
    steps.length >= input.maxSteps ||
    (input.mode === 'single' && lastClean);

  try {
    await generateText({
      model: input.model,
      instructions: input.instructions,
      prompt: input.prompt,
      tools: input.tools,
      toolChoice: input.mode === 'single' ? 'required' : 'auto',
      stopWhen,
      maxRetries: 1,
      timeout: { totalMs: 240_000, stepMs: 90_000 },
      providerOptions: input.providerOptions,
      onStepEnd: async (step) => {
        if (outcome !== null || failure !== null) {
          return;
        }

        const hadErrors = step.content.some((part) => part.type === 'tool-error');

        invalidStreak = hadErrors ? invalidStreak + 1 : 0;
        lastClean = !hadErrors;

        try {
          const decision = await input.onStep({
            step: step.stepNumber,
            hadErrors,
            usage: {
              inputTokens: step.usage.inputTokens ?? 0,
              outputTokens: step.usage.outputTokens ?? 0,
              model: step.model.modelId,
            },
          });

          if (decision === 'stop') {
            outcome = 'stopped';
          } else if (invalidStreak >= 2) {
            outcome = 'invalid';
          }
        } catch (error) {
          failure = { error };
        }
      },
    });
  } catch (error) {
    // A forced step answered in text: the model found nothing to change.
    if (!ToolChoiceViolationError.isInstance(error)) {
      throw error;
    }
  }

  if (failure !== null) {
    throw (failure as { error: unknown }).error;
  }

  return (outcome as ModelOutcome | null) ?? 'finished';
}
