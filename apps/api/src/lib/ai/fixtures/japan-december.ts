import type { RunFixture } from './types.ts';

// Recorded from a live run (anthropic/claude-sonnet-5.5) by scripts/record-fixture.mjs.
export const japanDecember: RunFixture = {
  name: 'japan-december',
  kind: 'create_intent',
  match: ['japan', 'december'],
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
            destinations: ['Tokyo', 'Kyoto', 'Osaka'],
          },
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'tokyo',
          data: {
            lat: 35.6762,
            lng: 139.6503,
            why: 'Winter illuminations, food and endless neighborhoods to explore.',
            days: 4,
            name: 'Tokyo',
            country: 'JP',
            placeType: 'city',
            estDailyCost: {
              amount: 180,
              currency: 'USD',
            },
          },
          kind: 'place',
          title: 'Tokyo',
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'kyoto',
          data: {
            lat: 35.0116,
            lng: 135.7681,
            why: 'Temples and late-autumn foliage lingering into early December.',
            days: 3,
            name: 'Kyoto',
            country: 'JP',
            placeType: 'city',
            estDailyCost: {
              amount: 160,
              currency: 'USD',
            },
          },
          kind: 'place',
          title: 'Kyoto',
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'osaka',
          data: {
            lat: 34.6937,
            lng: 135.5023,
            why: 'Street food and winter lights, with easy day trips to Nara.',
            days: 2,
            name: 'Osaka',
            country: 'JP',
            placeType: 'city',
            estDailyCost: {
              amount: 150,
              currency: 'USD',
            },
          },
          kind: 'place',
          title: 'Osaka',
        },
      },
    ],
    [
      {
        capability: 'object.create',
        input: {
          to: 'kyoto',
          ref: 'tokyo-kyoto',
          data: {
            mode: 'train',
            estCost: {
              amount: 130,
              currency: 'USD',
            },
            estHours: 2.3,
          },
          from: 'tokyo',
          kind: 'leg',
        },
      },
      {
        capability: 'object.create',
        input: {
          to: 'osaka',
          ref: 'kyoto-osaka',
          data: {
            mode: 'train',
            estCost: {
              amount: 6,
              currency: 'USD',
            },
            estHours: 0.5,
          },
          from: 'kyoto',
          kind: 'leg',
        },
      },
    ],
  ],
};
