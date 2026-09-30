import type { RunFixture } from './types.ts';

// Recorded from a live run (anthropic/claude-sonnet-5.5) by scripts/record-fixture.mjs.
export const japanAskRural: RunFixture = {
  name: 'japan-ask-rural',
  kind: 'ask',
  match: ['rural'],
  perception: {
    route: 'reasoning',
  },
  steps: [
    [
      {
        capability: 'decision.propose',
        input: {
          ref: 'rural-stop',
          options: [
            {
              fit: 'Closest rural escape from Osaka, so it fits the end of the route.',
              cons: ['Very cold', 'Some temple lodging books up early'],
              pros: [
                'About 1.5 hours from Osaka',
                'Overnight temple stay with vegetarian meals',
                'Snow is possible in December',
              ],
              label: 'Koyasan (temple stay)',
              place: {
                lat: 34.2136,
                lng: 135.5856,
                why: 'Temple lodging and misty cedar forests in the mountains south of Osaka.',
                name: 'Koyasan',
                country: 'JP',
                placeType: 'town',
                estDailyCost: {
                  amount: 200,
                  currency: 'USD',
                },
              },
              metrics: {
                hoursFromOsaka: 1.5,
              },
              summary:
                'Mountain monastery town with a temple lodging, forest cemetery and quiet winter mornings.',
            },
            {
              fit: 'Relaxing, rural, and good for the cold months, with a slower pace after the cities.',
              cons: ['About 2.5 to 3 hours from Osaka', 'Ryokan can be pricey'],
              pros: ['Public onsen hopping', 'Winter crab season', 'Traditional ryokan'],
              label: 'Kinosaki Onsen',
              place: {
                lat: 35.6256,
                lng: 134.8064,
                why: 'Historic hot-spring town with seven public baths and winter crab dinners.',
                name: 'Kinosaki Onsen',
                country: 'JP',
                placeType: 'town',
                estDailyCost: {
                  amount: 250,
                  currency: 'USD',
                },
              },
              metrics: {
                hoursFromOsaka: 2.7,
              },
              summary:
                'Small hot-spring town where you stroll between public bathhouses in yukata.',
            },
            {
              fit: 'Gives the most classic rural winter scenery.',
              cons: ['About 4 hours from Osaka or Kyoto', 'One day is tight for the travel'],
              pros: [
                'UNESCO gassho-zukuri villages',
                'Winter light-up events',
                'Preserved old town in Takayama',
              ],
              label: 'Shirakawa-go & Takayama',
              place: {
                lat: 36.2575,
                lng: 136.9061,
                why: 'Snow-covered thatched farmhouse village in the mountains of Gifu.',
                name: 'Shirakawa-go',
                country: 'JP',
                placeType: 'town',
                estDailyCost: {
                  amount: 170,
                  currency: 'USD',
                },
              },
              metrics: {
                hoursFromOsaka: 4,
              },
              summary:
                'Thatched-roof farmhouse villages in the Japanese Alps, often under snow in December.',
            },
          ],
          question: 'Where would you like to spend your spare day somewhere rural?',
          tradeoff:
            'Closer places leave more of the day for the destination. Farther ones give more dramatic winter scenery but cost travel time.',
        },
      },
    ],
  ],
};
