import type { RunFixture } from './types.ts';

// Written by hand, not recorded: Jev's answer for a goal no template fits, so mock mode can save
// a goal. No run starts, so there are no steps.
export const savedGoal: RunFixture = {
  name: 'saved-goal',
  kind: 'create_intent',
  match: ['wedding'],
  perception: { template: 'unsupported' },
  steps: [],
};
