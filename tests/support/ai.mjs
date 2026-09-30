import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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
