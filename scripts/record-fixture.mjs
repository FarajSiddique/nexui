#!/usr/bin/env node
/**
 * Records a succeeded live run as a mock fixture, so AI_PROVIDER=mock replays it. Needs the API
 * running and a QA session from `node scripts/qa-session.mjs > .qa/session.json`.
 *
 * node scripts/record-fixture.mjs <runId> <name> <phrase,phrase> [.qa/session.json] [apiUrl]
 *
 * Writes apps/api/src/lib/ai/fixtures/<name>.ts. Add it to FIXTURES in fixtures/index.ts, then
 * run `pnpm fix` and `pnpm test`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [runId, name, phrases, sessionPath = '.qa/session.json', api = 'http://localhost:3000'] =
  process.argv.slice(2);

if (!runId || !/^[a-z][a-z0-9-]*$/.test(name ?? '') || !phrases) {
  console.error('Usage: record-fixture.mjs <runId> <name> <phrase,phrase> [session] [apiUrl]');
  process.exit(1);
}

const { session } = JSON.parse(readFileSync(sessionPath, 'utf8'));
const response = await fetch(`${api}/api/runs/${runId}`, {
  headers: { Authorization: `Bearer ${session.access_token}` },
});
const run = await response.json();

if (!response.ok) {
  throw new Error(`GET /api/runs/${runId} → ${response.status} ${JSON.stringify(run)}`);
}

if (run.status !== 'succeeded') {
  throw new Error(`The run is ${run.status}; record a run that succeeded.`);
}

if (run.progress.length >= 100 || run.progress.some((entry) => entry.input === null)) {
  throw new Error('This run was too large to keep in full, so it cannot be recorded.');
}

// Calls grouped by model step, in order. Steps with no recorded calls are left out: in replay, a
// step without calls ends the run.
const steps = [];

for (const entry of run.progress) {
  steps[entry.step] ??= [];
  steps[entry.step].push({ capability: entry.capability, input: entry.input });
}

const perception =
  run.kind === 'create_intent'
    ? { template: run.input.template ?? 'travel', route: run.input.route }
    : { route: run.input.route };
const fixture = {
  name,
  kind: run.kind,
  match: phrases
    .split(',')
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length > 0),
  perception,
  steps: steps.filter(Boolean),
};
const exportName = name.replace(/-([a-z0-9])/g, (_, next) => next.toUpperCase());
const path = `apps/api/src/lib/ai/fixtures/${name}.ts`;

writeFileSync(
  path,
  `import type { RunFixture } from './types.ts';\n\n` +
    `// Recorded from a live run (${run.modelUsage.model ?? 'unknown model'}) by ` +
    `scripts/record-fixture.mjs.\n` +
    `export const ${exportName}: RunFixture = ${JSON.stringify(fixture, null, 2)};\n`,
);
console.log(
  `wrote ${path}: ${fixture.steps.length} steps. Add ${exportName} to FIXTURES, then pnpm fix.`,
);
