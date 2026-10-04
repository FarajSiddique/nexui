import assert from 'node:assert/strict';
import test from 'node:test';

import { aiMarkFor } from '../apps/mobile/src/features/workspace/ai-mark.ts';
import {
  capitalize,
  cardText,
  countryName,
  dayLabel,
  formatDays,
  formatField,
  formatHours,
  formatMoney,
  formatRelative,
  humanizeKey,
  legFigures,
  ordinalWord,
  travelTo,
  tripMeta,
} from '../apps/mobile/src/lib/format.ts';

const object = (kind, data, extra = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000099',
  intentId: 'a1b2c3d4-0000-4000-8000-000000000001',
  kind,
  kindVersion: 1,
  title: null,
  status: null,
  data,
  source: { type: 'user' },
  position: null,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
  ...extra,
});

test('days, hours and money read the way the design shows them', () => {
  assert.equal(formatDays(1), '1 day');
  assert.equal(formatDays(3), '3 days');
  assert.equal(formatDays(0), '0 days');
  assert.equal(formatHours(2.5), '2h 30m');
  assert.equal(formatHours(0.5), '30m');
  assert.equal(formatHours(3), '3h');
  assert.equal(formatMoney({ amount: 3140, currency: 'USD' }), '$3.1k');
  assert.equal(formatMoney({ amount: 3000, currency: 'USD' }), '$3k');
  assert.equal(formatMoney({ amount: 950, currency: 'EUR' }), '€950');
  assert.equal(formatMoney({ amount: 2_500_000, currency: 'JPY' }), '¥2.5m');
});

test('relative times and day groups use the local calendar', () => {
  const now = new Date(2026, 8, 30, 12, 0);
  const minus = (ms) => new Date(now.getTime() - ms).toISOString();

  assert.equal(formatRelative(minus(30_000), now), 'just now');
  assert.equal(formatRelative(minus(5 * 60_000), now), '5 min ago');
  assert.equal(formatRelative(minus(2 * 3_600_000), now), '2 h ago');

  const older = new Date(2026, 8, 27, 12, 0);

  assert.equal(
    formatRelative(older.toISOString(), now),
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(older),
  );
  assert.equal(dayLabel(new Date(2026, 8, 30, 8).toISOString(), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 8, 29, 23).toISOString(), now), 'Yesterday');
  assert.equal(
    dayLabel(older.toISOString(), now),
    new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(
      older,
    ),
  );
});

test('the trip meta line names dates, travelers and pace', () => {
  assert.equal(
    tripMeta({ startDate: '2026-12-12', endDate: '2026-12-24', travelers: 2, pace: 'balanced' }),
    'Dec 12 – 24, 2 travelers, balanced pace',
  );
  assert.equal(tripMeta({ totalDays: 3, travelers: 1 }), '3 days, 1 traveler');
  assert.equal(tripMeta({}), '');
});

test('fields format by their spec, and missing values show a dash', () => {
  assert.equal(humanizeKey('hoursFromKyoto'), 'Hours from kyoto');
  assert.equal(formatField({ amount: 140, currency: 'USD' }), '$140');
  assert.equal(formatField(2, 'days'), '2 days');
  assert.equal(formatField(1.25, 'hours'), '1h 15m');
  assert.equal(formatField(['Snow', 'Onsen']), 'Snow, Onsen');
  assert.equal(formatField(undefined), '—');
  assert.equal(formatField(''), '—');
});

test('cards follow the kind registry', () => {
  const tokyo = object('place', { name: 'Tokyo', days: 4, why: 'Food' });
  const leg = object(
    'leg',
    { mode: 'train', estHours: 2.5, estCost: { amount: 95, currency: 'USD' } },
    { title: 'Tokyo → Kyoto' },
  );
  const unknown = object('widget', {}, { title: 'Mystery' });

  assert.deepEqual(cardText(tokyo), { title: 'Tokyo', subtitle: '4 days · Food' });
  assert.deepEqual(cardText(leg), { title: 'Tokyo → Kyoto', subtitle: 'train · 2h 30m · $95' });
  assert.deepEqual(cardText(unknown), { title: 'Mystery', subtitle: '' });
});

test('only unreviewed AI objects carry the highlighter; options are tentative', () => {
  assert.deepEqual(aiMarkFor({ kind: 'place', source: { type: 'ai', runId: 'x' } }), {
    highlight: true,
    tentative: false,
  });
  assert.deepEqual(
    aiMarkFor({ kind: 'place', source: { type: 'ai', reviewedAt: '2026-09-30T10:00:00Z' } }),
    { highlight: false, tentative: false },
  );
  assert.deepEqual(aiMarkFor({ kind: 'option', source: { type: 'user' } }), {
    highlight: false,
    tentative: true,
  });
  assert.deepEqual(aiMarkFor({ kind: 'place', source: null }), {
    highlight: false,
    tentative: false,
  });
});

test('ordinals read as words to ten, then as numbers', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(ordinalWord), [
    'first',
    'second',
    'third',
    'fourth',
    'tenth',
  ]);
  assert.deepEqual([11, 12, 13, 21, 22, 23, 101, 111].map(ordinalWord), [
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '101st',
    '111th',
  ]);
});

test('country names come from the code, which is kept when there is no name', () => {
  assert.equal(countryName('DE'), 'Germany');
  assert.equal(countryName('AA'), 'AA');
});

test('a leg reads as its mode, time and cost', () => {
  const train = { mode: 'train', estHours: 4.25, estCost: { amount: 40, currency: 'USD' } };

  assert.equal(travelTo('train', 'Prague'), 'Train to Prague');
  assert.equal(travelTo('car', 'Salzburg'), 'Drive to Salzburg');
  assert.equal(legFigures(train), '4h 15m, ≈ $40');
  assert.equal(legFigures({ mode: 'other' }), '');
  assert.equal(capitalize('region'), 'Region');
});
