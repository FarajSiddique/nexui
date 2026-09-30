import type { Experimental_EvaluationModel, LanguageModel } from 'ai';
import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from 'ai/test';

import type { RunKind } from '@nexui/types';

import { toolNameFor } from '../cognition/tools.ts';
import type { RunFixture } from './fixtures/types.ts';

/** The first fixture for `kind` whose phrases all appear in `text`, ignoring case. */
export function findFixture(
  fixtures: readonly RunFixture[],
  kind: RunKind,
  text: string,
): RunFixture | null {
  const normalized = text.toLowerCase();

  return (
    fixtures.find(
      (fixture) =>
        fixture.kind === kind && fixture.match.every((phrase) => normalized.includes(phrase)),
    ) ?? null
  );
}

const noUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * Replays the fixture's steps in order, then answers in text, which ends a tool loop. With no
 * fixture it answers in text at once, so the run changes nothing.
 */
export function mockLanguageModel(fixture: RunFixture | null): LanguageModel {
  let step = 0;

  return new MockLanguageModelV4({
    doGenerate: async () => {
      const index = step;
      const calls = fixture?.steps[index] ?? [];

      step += 1;

      if (calls.length === 0) {
        return {
          content: [{ type: 'text', text: 'Done.' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: noUsage,
          warnings: [],
        };
      }

      return {
        content: calls.map((call, n) => ({
          type: 'tool-call' as const,
          toolCallId: `mock-${index}-${n}`,
          toolName: toolNameFor(call.capability),
          input: JSON.stringify(call.input),
        })),
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: noUsage,
        warnings: [],
      };
    },
  });
}

/** Answers Jev's questions as the fixture recorded, or `travel` and `reasoning` without one. */
export function mockEvaluationModel(fixture: RunFixture | null): Experimental_EvaluationModel {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async ({ questions }) => {
      const answers: Record<string, { type: 'choice'; choice: string }> = {};

      for (const id of Object.keys(questions)) {
        if (id === 'template') {
          answers[id] = { type: 'choice', choice: fixture?.perception.template ?? 'travel' };
        }

        if (id === 'route') {
          answers[id] = { type: 'choice', choice: fixture?.perception.route ?? 'reasoning' };
        }
      }

      return { answers, warnings: [] };
    },
  });
}
