import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  anchorFigures,
  derivedKeySchema,
  figureValue,
  KIND_FIGURES,
  KIND_REGISTRY,
  tripFigures,
  workspaceDocSchema,
} from '../packages/types/src/index.ts';
import { snapshotRow, TRIP_ID } from './support/graph.mjs';

const snapshot = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));

test('a derived key is <anchor kind>.<figure>', () => {
  for (const key of ['trip.totalDays', 'trip.estCost', 'search.new', 'search.interviewsThisWeek']) {
    assert.equal(derivedKeySchema.safeParse(key).success, true, key);
  }

  for (const key of ['trip', 'trip.', '.totalDays', 'Trip.totalDays', 'trip.total-days']) {
    assert.equal(derivedKeySchema.safeParse(key).success, false, key);
  }
});

test('a stored trip workspace still parses with its trip keys', () => {
  assert.equal(workspaceDocSchema.safeParse(travelWorkspace(TRIP_ID)).success, true);
});

test('every anchor kind is a registered kind', () => {
  for (const kind of Object.keys(KIND_FIGURES)) {
    assert.ok(Object.hasOwn(KIND_REGISTRY, kind), kind);
  }
});

test('a trip’s figures are its recomputed days and cost', () => {
  const figures = anchorFigures(snapshot);
  const expected = { ...tripFigures(snapshot, TRIP_ID) };

  delete expected.costIncomplete;

  assert.equal(figures.kind, 'trip');
  assert.deepEqual(figures.values, expected);
  assert.equal(figureValue(figures, 'trip.totalDays'), 8);
  assert.equal(figureValue(figures, 'trip.unallocatedDays'), 0);
});

test('a key for another anchor kind, or for no figure, shows nothing', () => {
  const figures = anchorFigures(snapshot);

  assert.equal(figureValue(figures, 'search.new'), null);
  assert.equal(figureValue(figures, 'trip.nope'), null);
  assert.equal(figureValue(figures, 'trip.constructor'), null);
});

test('a plan without a workspace has no anchor figures', () => {
  const figures = anchorFigures({ ...snapshot, workspace: null });

  assert.deepEqual(figures, { kind: null, values: {} });
  assert.equal(figureValue(figures, 'trip.totalDays'), null);
});
