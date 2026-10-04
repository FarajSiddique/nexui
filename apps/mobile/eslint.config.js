const fs = require('node:fs');
const path = require('node:path');

const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

const style = require('@nexui/config/eslint-style').default;

const tsconfig = require.resolve('./tsconfig.json');
// Read from disk, so a new src/ folder is off-limits to the zoned folders until it gets a zone.
const SRC_FOLDERS = fs
  .readdirSync(path.join(path.dirname(tsconfig), 'src'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * A zone that stops files in `src/<target>` importing any other src folder but `allowed`. See
 * "Where code lives" in docs/architecture/mobile.md.
 *
 * @example
 * onlyImports('ui', ['theme']) // ui/ may import theme/ and itself, nothing else in src/
 */
function onlyImports(target, allowed) {
  const folders = [target, ...allowed].map((folder) => `${folder}/`);
  const list =
    folders.length > 1 ? `${folders.slice(0, -1).join(', ')} and ${folders.at(-1)}` : folders[0];

  return {
    target: `./src/${target}`,
    from: SRC_FOLDERS.filter((folder) => folder !== target && !allowed.includes(folder)).map(
      (folder) => `./src/${folder}`,
    ),
    message: `${target}/ may only import from ${list} (see "Where code lives" in docs/architecture/mobile.md).`,
  };
}

// Imports run one way between src/ folders. The TypeScript resolver follows the `#` imports in
// package.json, so a barrel import counts the same as a relative one.
const importBoundaries = {
  files: ['src/**/*.{ts,tsx}'],
  settings: {
    'import/resolver': {
      typescript: { project: tsconfig },
    },
  },
  rules: {
    // Barrels make a cycle easy to close; Metro warns about require cycles at runtime.
    'import/no-cycle': 'error',
    'import/no-restricted-paths': [
      'error',
      {
        basePath: path.dirname(tsconfig),
        zones: [
          onlyImports('features', ['ui', 'theme', 'data', 'lib']),
          onlyImports('ui', ['theme']),
          onlyImports('theme', []),
          onlyImports('data', []),
          onlyImports('lib', []),
        ],
      },
    ],
  },
};

// Barrel domains: data, lib, theme, ui and each features/<area>. Routes in app/ have no barrel.
const DOMAINS = SRC_FOLDERS.filter((folder) => folder !== 'app').flatMap((folder) =>
  folder === 'features'
    ? fs
        .readdirSync(path.join(path.dirname(tsconfig), 'src', folder), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `features/${entry.name}`)
    : [folder],
);

/**
 * Each domain's index.ts is its public surface, reached as `#<domain>` through the `imports` map
 * in package.json. Metro, tsc and Node all resolve it.
 *
 * @example
 * import { Button } from '#ui';
 * import { useSessionStore } from '#features/auth';
 */
const barrelPatterns = [
  { regex: '^@/', message: "Import through the folder's barrel, e.g. '#ui' or '#features/auth'." },
  {
    regex: '^#(?!features/)[^/]+/',
    message: "Import the folder's barrel ('#lib', '#ui'), not a file inside it.",
  },
  {
    regex: '^#features/[^/]+/',
    message: "Import the feature's barrel ('#features/<area>'), not a file inside it.",
  },
];

function restrictImports(upward, extraPatterns = []) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: upward,
            message: "Import another folder through its barrel, e.g. '#lib' or '#features/home'.",
          },
          ...barrelPatterns,
          ...extraPatterns,
        ],
      },
    ],
  };
}

function ownBarrel(domain) {
  return {
    regex: `^#${domain}$`,
    message: `Inside ${domain}/, import the file with './', not the '#${domain}' barrel.`,
  };
}

const barrels = [
  { files: ['src/**/*.{ts,tsx}'], rules: restrictImports('^\\.\\./') },
  ...DOMAINS.map((domain) => ({
    files: [`src/${domain}/**/*.{ts,tsx}`],
    rules: restrictImports('^\\.\\./', [ownBarrel(domain)]),
  })),
  // A feature's subfolder (workspace/sections) may reach its own feature with one '../'.
  ...DOMAINS.filter((domain) => domain.startsWith('features/')).map((domain) => ({
    files: [`src/${domain}/*/**/*.{ts,tsx}`],
    rules: restrictImports('^\\.\\./\\.\\./', [ownBarrel(domain)]),
  })),
  {
    files: ['src/*/index.ts', 'src/features/*/index.ts'],
    ignores: ['src/app/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > :not(ExportNamedDeclaration[source])',
          message: "A barrel only re-exports: export { name } from './file'.",
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,js}'],
    rules: {
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: '@nexui/**', group: 'internal' },
            { pattern: '#{*,features/*}', group: 'internal', position: 'after' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
        },
      ],
    },
  },
];

module.exports = defineConfig([
  expo,
  prettier,
  style,
  importBoundaries,
  ...barrels,
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts'] },
]);
