/**
 * The travel eval's cases: spec section H's eight prompts, each with where its places should be.
 * `box` is [south, west, north, east] in degrees, loose enough for islands and border towns.
 * `days` is the length the prompt states, ±1 for how a model counts dates; `expectLengthQuestion`
 * means the prompt gives no length, so "How long is the trip?" should stay open. A case with
 * neither passes either way.
 */
export const CASES = [
  {
    name: 'japan-december',
    goal: 'Two weeks in Japan in December',
    countries: ['JP'],
    box: [24, 122, 46, 146],
    days: [13, 15],
    minStops: 2,
  },
  {
    name: 'chicago-weekend',
    goal: 'A weekend in Chicago',
    countries: ['US'],
    box: [41, -89, 43.2, -86],
    days: [2, 3],
    minStops: 1,
  },
  {
    name: 'portugal-road',
    goal: 'A 10-day road trip around Portugal',
    countries: ['PT'],
    box: [36.5, -10, 42.5, -6],
    days: [9, 11],
    minStops: 2,
  },
  {
    name: 'sea-backpacker',
    goal: 'Three weeks in Southeast Asia on a backpacker budget',
    countries: ['TH', 'VN', 'KH', 'LA', 'MY', 'SG', 'ID', 'PH', 'MM'],
    box: [-11, 92, 29, 141],
    days: [20, 22],
    minStops: 2,
  },
  {
    name: 'beach-warm',
    goal: 'A beach week somewhere warm',
    oneCountry: true,
    maxAbsLat: 35,
    days: [6, 8],
    minStops: 2,
  },
  {
    name: 'berlin-business',
    goal: 'A business trip to Berlin plus two free days',
    countries: ['DE', 'PL', 'CZ', 'AT', 'DK', 'NL'],
    box: [45, 2, 56, 20],
    minStops: 2,
  },
  {
    name: 'disney-family',
    goal: 'A family Disney trip',
    countries: ['US', 'FR', 'JP', 'CN', 'HK'],
    oneCountry: true,
    expectLengthQuestion: true,
    minStops: 1,
  },
  {
    name: 'iceland-ring',
    goal: "Driving Iceland's ring road in 10 days",
    countries: ['IS'],
    box: [63, -25, 67, -13],
    days: [9, 11],
    minStops: 2,
  },
];
