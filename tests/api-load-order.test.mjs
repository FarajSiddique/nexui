// Every API domain must load on its own, whichever file a route, a test or the bundler loads
// first. Domains import each other through barrels; a cycle that uses another domain's export at
// module top level (a capability list, a schema) fails only for some entry orders, with a TDZ
// ReferenceError. Each domain loads first here in a fresh Node process, so no test's import order
// hides it. The second half pins the import directions that keep templates out of such cycles.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const LIB = new URL('../apps/api/src/lib/', import.meta.url);
const DOMAINS = readdirSync(LIB, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function loadFirst(domain) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      '--no-warnings',
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(new URL(`${domain}/index.ts`, LIB).href)});`,
    ]);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ domain, code, stderr: stderr.slice(0, 500) }));
  });
}

// The domains one domain imports at runtime. `import type` is erased, so it doesn't count.
function runtimeImports(domain) {
  const dir = new URL(`${domain}/`, LIB);
  const found = new Set();

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');

    for (const [, name] of source.matchAll(/^import (?!type )[^;]*? from '#lib\/([a-z]+)';/gm)) {
      found.add(name);
    }
  }

  return [...found].sort();
}

test('each API domain loads first in a fresh process', async () => {
  const results = await Promise.all(DOMAINS.map(loadFirst));

  for (const { domain, code, stderr } of results) {
    assert.equal(code, 0, `${domain} failed to load first: ${stderr}`);
  }
});

test('capability definitions load without the graph, so templates can build on them', () => {
  assert.deepEqual(
    runtimeImports('capabilities').filter((name) => name !== 'kinds'),
    [],
  );
  assert.deepEqual(runtimeImports('kinds'), []);
});

test('a template builds on capabilities, never on the graph that runs it', () => {
  assert.deepEqual(runtimeImports('travel'), ['capabilities']);

  // Templates sit at the top of the chain, so they may use only the domains below them.
  for (const name of runtimeImports('templates')) {
    assert.ok(['kinds', 'capabilities', 'travel'].includes(name), `templates imports ${name}`);
  }
});
