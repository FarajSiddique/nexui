// Runs the app's own ESLint config on probe files, so the import directions between the
// template folders hold as `pnpm lint` enforces them (readiness doc, section 6).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const { ESLint } = createRequire(`${mobile}package.json`)('eslint');
// A probe isn't on disk, and `import/no-cycle` throws when it can't resolve the file it lints.
const eslint = new ESLint({ cwd: mobile, overrideConfig: { rules: { 'import/no-cycle': 'off' } } });

async function refusals(file, source) {
  const [result] = await eslint.lintText(source, { filePath: `${mobile}${file}` });

  return result.messages.filter((message) => message.ruleId === 'import/no-restricted-paths')
    .length;
}

const probe = (from, name) =>
  `import { ${name} } from '${from}';\n\nexport const probe = ${name};\n`;

test(
  'features/workspace imports no template folder and not the registries',
  { timeout: 120_000 },
  async () => {
    assert.equal(
      await refusals('src/features/workspace/probe.ts', probe('#features/travel', 'RouteSection')),
      1,
    );
    assert.equal(
      await refusals('src/features/workspace/probe.ts', probe('#features/registry', 'SectionView')),
      1,
    );
  },
);

test(
  'a template folder imports the workspace, never the registries',
  { timeout: 120_000 },
  async () => {
    assert.equal(
      await refusals('src/features/travel/probe.ts', probe('#features/workspace', 'SectionFrame')),
      0,
    );
    assert.equal(
      await refusals('src/features/travel/probe.ts', probe('#features/registry', 'SectionView')),
      1,
    );
  },
);
