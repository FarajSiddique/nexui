import { setFlagReader } from '../../apps/api/src/lib/flags/flags.ts';

/** A flag check where only the named flags are on: `flagsOn('job-search')`. */
export const flagsOn =
  (...keys) =>
  async (key) =>
    keys.includes(key);

/** For one test, routes read only the named flags as on, and never reach Vercel. */
export function useFlags(t, ...keys) {
  setFlagReader(flagsOn(...keys));
  t.after(() => setFlagReader(null));
}
