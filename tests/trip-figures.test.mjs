import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { convertMoney, daysBetween, tripFigures } from '../packages/types/src/index.ts';
import {
  kyotoData,
  kyotoRow,
  objectRow,
  relationshipRow,
  snapshotRow,
  tokyoData,
  tokyoRow,
  TRIP_ID,
  tripData,
  tripRow,
} from './support/graph.mjs';

const doc = { version: 1, anchorId: TRIP_ID, sections: [] };
const LEG_ID = 'a1b2c3d4-0000-4000-8000-0000000000e1';

function withObjects(objects, relationships) {
  const base = snapshotRow(doc);

  return mapSnapshotRow({
    ...base,
    objects,
    relationships: relationships ?? base.relationships,
  });
}

test('dates give the total; allocated days sum the trip places', () => {
  assert.deepEqual(tripFigures(mapSnapshotRow(snapshotRow(doc)), TRIP_ID), {
    totalDays: 8,
    allocatedDays: 8,
    unallocatedDays: 0,
    estCost: null,
    costIncomplete: false,
  });
});

test('Dec 12 to Dec 20 is 8 days', () => {
  assert.equal(daysBetween('2026-12-12', '2026-12-20'), 8);
  assert.equal(daysBetween('2026-12-28', '2027-01-04'), 7);
});

test('without dates, totalDays comes from the trip or is unknown', () => {
  const { startDate, endDate, ...undated } = tripData;
  const withTotal = withObjects([
    objectRow(TRIP_ID, 'trip', { ...undated, totalDays: 10 }),
    tokyoRow,
    kyotoRow,
  ]);
  const unknown = withObjects([objectRow(TRIP_ID, 'trip', undated), tokyoRow, kyotoRow]);

  assert.equal(tripFigures(withTotal, TRIP_ID).unallocatedDays, 2);
  assert.equal(tripFigures(unknown, TRIP_ID).totalDays, null);
  assert.equal(tripFigures(unknown, TRIP_ID).unallocatedDays, null);
});

test('costs convert to the trip currency and round to whole units', () => {
  const snapshot = withObjects(
    [
      tripRow,
      objectRow(tokyoRow.id, 'place', {
        ...tokyoData,
        estDailyCost: { amount: 20000, currency: 'JPY' },
      }),
      objectRow(kyotoRow.id, 'place', {
        ...kyotoData,
        estDailyCost: { amount: 100, currency: 'USD' },
      }),
      objectRow(LEG_ID, 'leg', { mode: 'train', estCost: { amount: 95, currency: 'USD' } }),
    ],
    [
      ...snapshotRow(doc).relationships,
      relationshipRow('a1b2c3d4-0000-4000-8000-0000000000e2', LEG_ID, TRIP_ID),
    ],
  );
  // Tokyo: 4 × ¥20,000 × 0.0067 = $536; Kyoto: 4 × $100 = $400; leg $95.
  assert.deepEqual(tripFigures(snapshot, TRIP_ID).estCost, { amount: 1031, currency: 'USD' });
  assert.equal(Math.round(convertMoney({ amount: 100, currency: 'EUR' }, 'USD')), 108);
  assert.equal(convertMoney({ amount: 100, currency: 'XAF' }, 'USD'), null);
});

test('an unknown currency is skipped and flagged, never thrown', () => {
  const snapshot = withObjects([
    tripRow,
    objectRow(tokyoRow.id, 'place', {
      ...tokyoData,
      estDailyCost: { amount: 50, currency: 'XAF' },
    }),
    kyotoRow,
  ]);
  const figures = tripFigures(snapshot, TRIP_ID);

  assert.equal(figures.estCost, null);
  assert.equal(figures.costIncomplete, true);
});
