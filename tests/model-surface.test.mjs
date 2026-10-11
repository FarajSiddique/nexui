// What models see, per template. A failure here means a change moved a prompt, a tool
// description or a tool schema. To change one on purpose, rerun `node --experimental-strip-types
// tests/support/model-surface.mjs`, then `pnpm exec prettier --write tests/support/*.json`, and
// review the diff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { jobSearchModelSurface, travelModelSurface } from './support/model-surface.mjs';

const expectedOf = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

for (const [label, file, surfaceOf] of [
  ['a trip', './support/travel-model-surface.json', travelModelSurface],
  ['a job search', './support/job-search-model-surface.json', jobSearchModelSurface],
]) {
  test(`${label}'s tools, instructions and template question are unchanged`, async () => {
    const expected = expectedOf(file);
    const surface = await surfaceOf();

    assert.deepEqual(
      surface.tools.map((tool) => tool.name),
      expected.tools.map((tool) => tool.name),
    );

    for (const [index, tool] of surface.tools.entries()) {
      assert.deepEqual(tool, expected.tools[index], tool.name);
    }

    assert.deepEqual(surface.instructions, expected.instructions);
    assert.deepEqual(surface.chooseTemplate, expected.chooseTemplate);
  });
}
