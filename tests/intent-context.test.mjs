import assert from 'node:assert/strict';
import test from 'node:test';

import { ChangesetInvalidError } from '../apps/api/src/lib/graph/errors.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { prepareChangeset, validateOps } from '../apps/api/src/lib/graph/prepare.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { idSequence, intentRow, LATER, snapshotRow, TRIP_ID } from './support/graph.mjs';

const trip = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const unplanned = mapSnapshotRow({
  ...snapshotRow(travelWorkspace(TRIP_ID)),
  intent: { ...intentRow, template: null },
  workspace: null,
  objects: [],
  relationships: [],
});
const write = (context) => ({ op: 'update_intent', patch: { context }, origin: 'direct' });
const tagged = write({ eval: { suite: 'travel', case: 'japan', at: '2026-10-04T12:00:00.000Z' } });
const invalid = (pattern) => (error) =>
  error instanceof ChangesetInvalidError && pattern.test(error.message);

test('a trip’s context holds the eval tag and nothing else', () => {
  assert.deepEqual(validateOps(trip, [tagged], LATER), [tagged]);
  assert.throws(
    () => validateOps(trip, [write({ nextCheckAt: 'tomorrow' })], LATER),
    invalid(/^Invalid context: Unrecognized key/),
  );
  assert.throws(
    () =>
      prepareChangeset(trip, [write({ eval: { suite: 'travel' } })], 'system', LATER, idSequence()),
    invalid(/^Invalid context: eval\.case /),
  );
});

test('an intent with no template may hold only the eval tag', () => {
  assert.deepEqual(validateOps(unplanned, [tagged], LATER), [tagged]);
  assert.throws(
    () => validateOps(unplanned, [write({ jobs: { scan: 'daily' } })], LATER),
    invalid(/^Invalid context/),
  );
});
