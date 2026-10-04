import { readdirSync } from 'node:fs';

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

import style from '@nexui/config/eslint-style';

const domains = readdirSync(new URL('./src/lib', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * Each `src/lib/<domain>/index.ts` is that domain's public surface, reached as `#lib/<domain>`
 * (see `imports` in package.json). Files inside a domain import siblings with `./`; everything
 * else goes through the barrel.
 *
 * @example
 * import { graphErrorResponse, loadSnapshot } from '#lib/graph';
 */
const barrelPatterns = [
  {
    regex: '^\\.\\./',
    message: "Import another domain through its barrel, e.g. '#lib/graph'.",
  },
  {
    regex: '^#lib/[^/]+/',
    message: "Import the domain barrel ('#lib/<domain>'), not a file inside it.",
  },
];

function restrictImports(extraPatterns = []) {
  return {
    'no-restricted-imports': ['error', { patterns: [...barrelPatterns, ...extraPatterns] }],
  };
}

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  prettier,
  style,
  {
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error', 'warn', 'info'] }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: '@nexui/**', group: 'internal' },
            { pattern: '#lib/**', group: 'internal', position: 'after' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: restrictImports(),
  },
  // A domain importing its own barrel loads itself in a cycle; use `./` there.
  ...domains.map((domain) => ({
    files: [`src/lib/${domain}/**/*.ts`],
    rules: restrictImports([
      {
        regex: `^#lib/${domain}$`,
        message: `Inside ${domain}, import the sibling file with './', not the '#lib/${domain}' barrel.`,
      },
    ]),
  })),
  // Barrels only re-export by name, so each domain's public surface reads in one place.
  {
    files: ['src/lib/*/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > :not(ExportNamedDeclaration[source])',
          message: "A barrel only re-exports: export { name } from './file.ts'.",
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'next-env.d.ts']),
]);
