import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANCHOR_KINDS,
  anchorMeta,
  formatMoney,
  KIND_META,
  searchMeta,
  tripMeta,
} from '../packages/types/src/index.ts';
import { jobSnapshot, SEARCH_ID, searchData } from './support/jobs.mjs';

test('every anchor kind has a meta line', () => {
  assert.deepEqual(Object.keys(KIND_META).sort(), [...ANCHOR_KINDS].sort());
});

test("a trip's meta line names dates, travelers and pace", () => {
  assert.equal(
    tripMeta({ startDate: '2026-12-12', endDate: '2026-12-24', travelers: 2, pace: 'balanced' }),
    'Dec 12 – 24, 2 travelers, balanced pace',
  );
  assert.equal(tripMeta({ totalDays: 3, travelers: 1 }), '3 days, 1 traveler');
  assert.equal(tripMeta({}), '');
});

test("a search's meta line names its roles, where, and the pay floor", () => {
  assert.equal(
    searchMeta({ ...searchData, salaryFloor: { amount: 120_000, currency: 'GBP' } }),
    'Staff Product Manager · London or remote · £120k+',
  );
  assert.equal(
    searchMeta({
      ...searchData,
      roles: ['Staff PM', 'Senior PM', 'Lead PM'],
      locations: ['Remote (UK)'],
      workModes: ['remote'],
    }),
    'Staff PM or Senior PM +1 · Remote (UK)',
  );
  assert.equal(
    searchMeta({ ...searchData, locations: [], workModes: ['onsite'] }),
    'Staff Product Manager',
  );
});

test('a search with no roles yet has no meta line: its build run sets them', () => {
  assert.equal(searchMeta({ ...searchData, roles: [] }), '');
  assert.equal(anchorMeta(jobSnapshot({ search: { ...searchData, roles: [] } })), null);
});

test("the meta line is the anchor's, with its id and kind", () => {
  const snapshot = jobSnapshot();

  assert.deepEqual(anchorMeta(snapshot), {
    objectId: SEARCH_ID,
    kind: 'search',
    text: 'Staff Product Manager · London or remote',
  });
  assert.equal(anchorMeta({ ...snapshot, workspace: null }), null);
});

test('money reads short, as meta lines and cards show it', () => {
  assert.equal(formatMoney({ amount: 120_000, currency: 'GBP' }), '£120k');
  assert.equal(formatMoney({ amount: 950, currency: 'EUR' }), '€950');
});
