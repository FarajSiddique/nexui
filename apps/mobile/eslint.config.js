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

// Imports run one way between src/ folders. The TypeScript resolver follows tsconfig's `@/`
// alias, so an aliased import counts the same as a relative one.
const importBoundaries = {
  files: ['src/**/*.{ts,tsx}'],
  settings: {
    'import/resolver': {
      typescript: { project: tsconfig },
    },
  },
  rules: {
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

module.exports = defineConfig([
  expo,
  prettier,
  style,
  importBoundaries,
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts'] },
]);
