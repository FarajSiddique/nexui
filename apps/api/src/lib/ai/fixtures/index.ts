import { chicagoWeekend } from './chicago-weekend.ts';
import { japanAskFreeDays } from './japan-ask-free-days.ts';
import { japanDecember } from './japan-december.ts';
import { savedGoal } from './saved-goal.ts';
import type { RunFixture } from './types.ts';

/**
 * Recorded runs for `AI_PROVIDER=mock`; the first match wins. `japan-ask-free-days` answers the
 * unallocated insight's own question ("How should I use the N days I have free?"). It replays on
 * any trip with a free day. Its "Extra day in Tokyo" option extends `o4`, Tokyo on the
 * japan-december trip; elsewhere `o4` may be another stop, or none, which `decision.propose` drops.
 * `saved-goal` saves any goal that mentions a wedding, for the unsupported path.
 */
export const FIXTURES: readonly RunFixture[] = [
  japanDecember,
  chicagoWeekend,
  japanAskFreeDays,
  savedGoal,
];
