import type { RunFixture } from './types.ts';

// Written by hand in the recorder's format; `node scripts/record-fixture.mjs` replaces it with a
// recording of a live run.
export const japanDecember: RunFixture = {
  name: 'japan-december',
  kind: 'create_intent',
  match: ['japan', 'december'],
  perception: { template: 'travel', route: 'reasoning' },
  steps: [
    [
      { capability: 'object.update', input: { ref: 'trip', data: { destinations: ['Japan'] } } },
      {
        capability: 'object.create',
        input: {
          ref: 'tokyo',
          kind: 'place',
          data: {
            name: 'Tokyo',
            country: 'JP',
            placeType: 'city',
            lat: 35.68,
            lng: 139.69,
            days: 4,
            why: 'Food halls, neighbourhoods and winter illuminations.',
          },
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'kyoto',
          kind: 'place',
          data: {
            name: 'Kyoto',
            country: 'JP',
            placeType: 'city',
            lat: 35.01,
            lng: 135.77,
            days: 3,
            why: 'Temples are quiet and crisp in December.',
          },
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'osaka',
          kind: 'place',
          data: {
            name: 'Osaka',
            country: 'JP',
            placeType: 'city',
            lat: 34.69,
            lng: 135.5,
            days: 2,
            why: 'Street food, and an easy base for Nara.',
          },
        },
      },
    ],
    [
      {
        capability: 'object.create',
        input: {
          ref: 'tokyo-kyoto',
          kind: 'leg',
          from: 'tokyo',
          to: 'kyoto',
          data: { mode: 'train', estHours: 2.25 },
        },
      },
      {
        capability: 'object.create',
        input: {
          ref: 'kyoto-osaka',
          kind: 'leg',
          from: 'kyoto',
          to: 'osaka',
          data: { mode: 'train', estHours: 0.5 },
        },
      },
    ],
  ],
};
