// What models see for a trip. The template registries change where this text comes from, never
// the text: a failure here means a refactor changed a prompt, a tool description or a tool
// schema. To change it on purpose, rerun `node --experimental-strip-types
// tests/support/model-surface.mjs`, then `pnpm exec prettier --write
// tests/support/travel-model-surface.json`, and review the diff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { travelModelSurface } from './support/model-surface.mjs';

const expected = JSON.parse(
  readFileSync(new URL('./support/travel-model-surface.json', import.meta.url), 'utf8'),
);

test("a trip's tools, instructions and template question are unchanged", async () => {
  const surface = await travelModelSurface();

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
