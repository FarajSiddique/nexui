import type { RunFixture } from './types.ts';

// Recorded from a live run (anthropic/claude-sonnet-5.5) by scripts/record-fixture.mjs.
export const japanAskFreeDays: RunFixture = {
  name: 'japan-ask-free-days',
  kind: 'ask',
  match: ['i have free'],
  perception: {
    route: 'reasoning',
  },
  steps: [
    [
      {
        capability: 'decision.propose',
        input: {
          ref: 'free-day',
          options: [
            {
              fit: 'Very easy add-on in the Kansai area, close to Osaka.',
              leg: {
                mode: 'train',
                estCost: {
                  amount: 6,
                  currency: 'USD',
                },
                estHours: 0.75,
              },
              cons: ['Quieter evenings', 'Overlaps with temple themes in Kyoto'],
              pros: ['Short, cheap transfer', 'Compact sights', 'Cool, pleasant in December'],
              label: 'Nara',
              place: {
                lat: 34.6851,
                lng: 135.8048,
                why: 'Deer park and giant Buddha, an easy step from Osaka.',
                days: 1,
                name: 'Nara',
                country: 'JP',
                placeType: 'city',
                estDailyCost: {
                  amount: 120,
                  currency: 'USD',
                },
              },
              metrics: {
                hoursFromOsaka: 0.75,
              },
              summary:
                'Add a day in Nara after Osaka for friendly deer, Todai-ji and Kasuga Taisha.',
            },
            {
              fit: 'Adds a very different, historically meaningful stop.',
              leg: {
                mode: 'train',
                estCost: {
                  amount: 60,
                  currency: 'USD',
                },
                estHours: 1.5,
              },
              cons: [
                'Tight for one day with Miyajima',
                'Higher transit cost and return to fly out',
              ],
              pros: ['Memorable, unique sights', 'Fast shinkansen'],
              label: 'Hiroshima and Miyajima',
              place: {
                lat: 34.3853,
                lng: 132.4553,
                why: 'Peace Memorial Park and nearby Miyajima island.',
                days: 1,
                name: 'Hiroshima',
                country: 'JP',
                placeType: 'city',
                estDailyCost: {
                  amount: 140,
                  currency: 'USD',
                },
              },
              metrics: {
                hoursFromOsaka: 1.5,
              },
              summary:
                'Take the bullet train west for the Peace Memorial and the Itsukushima shrine island.',
            },
            {
              fit: 'Tokyo is the biggest city and 3 days is tight.',
              cons: ['No new place on the route'],
              pros: ['No extra transit', 'Room for a day trip to Nikko or Kamakura'],
              label: 'Extra day in Tokyo',
              summary:
                'Give the day back to Tokyo for a slower pace, a day trip or more neighborhoods.',
            },
          ],
          question: 'How would you like to use your 1 free day?',
          tradeoff:
            'Adding a new stop gives variety but costs transit time; an extra day in a city you already visit is more relaxed.',
        },
      },
    ],
  ],
};
