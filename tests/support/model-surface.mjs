import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CAPABILITIES } from '../../apps/api/src/lib/capabilities/registry.ts';
import { instructionsFor } from '../../apps/api/src/lib/cognition/prompts.ts';
import { chooseTemplate } from '../../apps/api/src/lib/perception/perceive.ts';
import { Experimental_EvaluationMockModelV4 } from './ai.mjs';

/**
 * Everything a model sees for a trip: each tool's name, description, flags and input schema in
 * order, the run instructions for every kind and route, and Jev's template question. JSON round
 * trip, so it compares with the stored file exactly.
 */
export async function travelModelSurface() {
  const seen = [];
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      seen.push(options);

      return { answers: { template: { type: 'choice', choice: 'travel' } }, warnings: [] };
    },
  });

  await chooseTemplate(model, 'Plan Japan');

  const surface = {
    tools: CAPABILITIES.map((capability) => ({
      name: capability.name,
      description: capability.description,
      policy: capability.policy,
      exposeToModel: capability.exposeToModel,
      callableByUser: capability.callableByUser,
      input: capability.input.toJSONSchema(),
    })),
    instructions: {
      create_intent: instructionsFor('create_intent', 'reasoning'),
      edit: instructionsFor('ask', 'edit'),
      fast: instructionsFor('ask', 'fast'),
      reasoning: instructionsFor('ask', 'reasoning'),
    },
    chooseTemplate: seen[0].questions.template,
  };

  return JSON.parse(JSON.stringify(surface));
}

// `node --experimental-strip-types tests/support/model-surface.mjs` rewrites the expected file,
// for a change to what models see that is meant. Review its diff like code.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('./travel-model-surface.json', import.meta.url);

  writeFileSync(file, `${JSON.stringify(await travelModelSurface(), null, 2)}\n`);
}
