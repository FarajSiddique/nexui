import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { instructionsFor } from '../../apps/api/src/lib/cognition/prompts.ts';
import { chooseTemplate } from '../../apps/api/src/lib/perception/perceive.ts';
import { TEMPLATES } from '../../apps/api/src/lib/templates/registry.ts';
import { Experimental_EvaluationMockModelV4 } from './ai.mjs';
import { flagsOn } from './flags.mjs';

/**
 * Everything a model sees for one template's plans: each tool's name, description, flags and
 * input schema in order (capabilities, then lookups), the run instructions for every kind and
 * route, and Jev's template question with the gate flags `flags` turns on. JSON round trip, so
 * it compares with the stored file exactly.
 */
export async function modelSurface(name, flags) {
  const template = TEMPLATES[name];
  const seen = [];
  const model = new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      seen.push(options);

      return { answers: { template: { type: 'choice', choice: 'travel' } }, warnings: [] };
    },
  });

  await chooseTemplate(model, 'Plan Japan', { flags });

  const surface = {
    tools: [
      ...template.capabilities.map((capability) => ({
        name: capability.name,
        description: capability.description,
        policy: capability.policy,
        exposeToModel: capability.exposeToModel,
        callableByUser: capability.callableByUser,
        input: capability.input.toJSONSchema(),
      })),
      ...(template.lookups ?? []).map((lookup) => ({
        name: lookup.name,
        description: lookup.description,
        perRun: lookup.perRun,
        input: lookup.input.toJSONSchema(),
      })),
    ],
    instructions: {
      create_intent: instructionsFor(template, 'create_intent', 'reasoning'),
      edit: instructionsFor(template, 'ask', 'edit'),
      fast: instructionsFor(template, 'ask', 'fast'),
      reasoning: instructionsFor(template, 'ask', 'reasoning'),
    },
    chooseTemplate: seen[0].questions.template,
  };

  return JSON.parse(JSON.stringify(surface));
}

/** What a model sees for a trip, with job search's flag off. */
export const travelModelSurface = () => modelSurface('travel', flagsOn());

/** What a model sees for a job search, with its flag on. */
export const jobSearchModelSurface = () => modelSurface('job_search', flagsOn('job-search'));

// `node --experimental-strip-types tests/support/model-surface.mjs` rewrites both expected files,
// for a change to what models see that is meant. Review their diffs like code.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, surfaceOf] of [
    ['./travel-model-surface.json', travelModelSurface],
    ['./job-search-model-surface.json', jobSearchModelSurface],
  ]) {
    writeFileSync(
      new URL(file, import.meta.url),
      `${JSON.stringify(await surfaceOf(), null, 2)}\n`,
    );
  }
}
