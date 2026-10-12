/**
 * Size and complexity limits shared by every workspace. Each sits near the 95th percentile of the
 * code when it was added, so new code rarely meets them. Older code that already breaks one is
 * listed in the workspace's `eslint-suppressions.json`, which may only shrink: fixing a listed
 * function fails lint until `pnpm lint:prune` removes its entry.
 *
 * @example
 * // max-params: past four, take one object instead.
 * function scan({ search, boards, run, now }: ScanInput): Promise<ScanResult>
 */
export default {
  rules: {
    complexity: ['error', 12],
    'max-depth': ['error', 3],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 4],
  },
};
