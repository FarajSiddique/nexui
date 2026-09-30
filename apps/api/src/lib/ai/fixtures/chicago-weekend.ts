import type { RunFixture } from './types.ts';

// Recorded from a live run (anthropic/claude-sonnet-5.5) by scripts/record-fixture.mjs.
export const chicagoWeekend: RunFixture = {
  name: 'chicago-weekend',
  kind: 'create_intent',
  match: ['chicago', 'weekend'],
  perception: {
    template: 'travel',
    route: 'reasoning',
  },
  steps: [
    [
      {
        capability: 'object.update',
        input: {
          ref: 'trip',
          data: {
            totalDays: 2,
            destinations: ['Chicago'],
          },
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'chicago',
          data: {
            lat: 41.8781,
            lng: -87.6298,
            why: 'Architecture, deep-dish pizza, lakefront and world-class museums fit neatly into a weekend.',
            days: 2,
            name: 'Chicago',
            country: 'US',
            placeType: 'city',
            estDailyCost: {
              amount: 250,
              currency: 'USD',
            },
          },
          kind: 'place',
          title: 'Chicago',
        },
      },
    ],
  ],
};
