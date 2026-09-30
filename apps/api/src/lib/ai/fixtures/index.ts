import { chicagoWeekend } from './chicago-weekend.ts';
import { japanAskRural } from './japan-ask-rural.ts';
import { japanDecember } from './japan-december.ts';
import type { RunFixture } from './types.ts';

/**
 * Recorded runs for `AI_PROVIDER=mock`; the first match wins. An ask fixture's refs assume the
 * graph it was recorded on: `japan-ask-rural` follows `japan-december` and `try-run.mjs free-day`.
 */
export const FIXTURES: readonly RunFixture[] = [japanDecember, chicagoWeekend, japanAskRural];
