import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { setRunScheduler } from '../../apps/api/src/lib/runs/schedule.ts';

// Root tests have no dependencies of their own, so the AI SDK's test models load from the API.
const fromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));

export const { MockLanguageModelV4, Experimental_EvaluationMockModelV4 } = await import(
  pathToFileURL(fromApi.resolve('ai/test')).href
);

/** An evaluation model that always fails, as a Gateway outage would. */
export function failingEvaluationModel() {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async () => {
      throw new Error('gateway unavailable');
    },
  });
}

/** Pins AI_PROVIDER to mock for one test, whatever the shell exports. */
export function useMockAi(t) {
  const previous = process.env.AI_PROVIDER;

  process.env.AI_PROVIDER = 'mock';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = previous;
    }
  });
}

const stepUsage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

/** One model step that calls tools: `[['object_create', { … }], …]`. */
export function toolStep(calls) {
  return {
    content: calls.map(([toolName, input], index) => ({
      type: 'tool-call',
      toolCallId: `call-${index}`,
      toolName,
      input: JSON.stringify(input),
    })),
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage: stepUsage,
    warnings: [],
  };
}

/** One model step that only answers in text, which ends a tool loop. */
export function textStep(text = 'Done.') {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: stepUsage,
    warnings: [],
  };
}

/** A language model that plays `steps` in order, then text. `seen` collects each call's options. */
export function scriptedModel(steps, seen = []) {
  let index = 0;

  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.push(options);
      index += 1;

      return steps[index - 1] ?? textStep();
    },
  });
}

/** Collects scheduled runs instead of handing them to `after()`; run them with `await task()`. */
export function captureRuns(t) {
  const tasks = [];

  setRunScheduler((task) => {
    tasks.push(task);
  });
  t.after(() => setRunScheduler(null));

  return tasks;
}
