import { chicagoWeekend } from './chicago-weekend.ts';
import { japanAskFreeDays } from './japan-ask-free-days.ts';
import { japanDecember } from './japan-december.ts';
import type { RunFixture } from './types.ts';

/**
 * Recorded runs for `AI_PROVIDER=mock`; the first match wins. `japan-ask-free-days` answers the
 * unallocated insight's own question ("How should I use the N days I have free?"). Its proposal
 * names no existing objects, so it replays on any trip with a free day.
 */
export const FIXTURES: readonly RunFixture[] = [japanDecember, chicagoWeekend, japanAskFreeDays];
