import type { TemplateDefinition } from '#lib/templates';

import { TRAVEL_CAPABILITIES, TRAVEL_SCOPE } from './capabilities.ts';
import { deriveTrip, findShortenedPlace } from './derive.ts';
import { TRAVEL_PROMPT } from './prompt.ts';
import { seedTravelOps } from './seed.ts';

/** Trips (intent graph spec, section I): the first template, and the shape the others follow. */
export const TRAVEL_TEMPLATE: TemplateDefinition = {
  name: 'travel',
  anchorKind: 'trip',
  anchorRef: 'trip',
  kinds: TRAVEL_SCOPE.kinds,
  seed: seedTravelOps,
  derive: ({ before, staged, ops, anchorId, newId }) =>
    deriveTrip(staged, anchorId, findShortenedPlace(before, ops), newId),
  capabilities: TRAVEL_CAPABILITIES,
  prompt: TRAVEL_PROMPT,
};
