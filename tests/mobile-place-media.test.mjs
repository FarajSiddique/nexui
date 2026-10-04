import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  hasPendingMedia,
  MEDIA_POLLS,
  mediaKeyIds,
  mediaPlaceIds,
  mediaPollInterval,
} from '../apps/mobile/src/data/place-media.ts';
import {
  KYOTO_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const NARA_ID = 'a1b2c3d4-0000-4000-8000-000000000203';
const ready = { status: 'ready', about: null, photo: null };

test('every place in the plan is asked about, decision candidates included', () => {
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(NARA_ID, 'place', { ...kyotoData, name: 'Nara' }),
      ],
    }),
  );

  assert.deepEqual(mediaPlaceIds(snapshot), [TOKYO_ID, KYOTO_ID, NARA_ID]);
});

test('the query is keyed by the sorted place ids, so a new stop starts a fetch', () => {
  assert.equal(mediaKeyIds(['b', 'a']), 'a,b');
  assert.notEqual(mediaKeyIds(['a', 'b']), mediaKeyIds(['a', 'b', 'c']));
});

test('it polls every 2 seconds while a lookup is pending, ten times at most', () => {
  const pending = { places: { [TOKYO_ID]: { status: 'pending' }, [KYOTO_ID]: ready } };
  const done = { places: { [TOKYO_ID]: ready } };

  assert.equal(hasPendingMedia(pending), true);
  assert.equal(hasPendingMedia(done), false);
  assert.equal(mediaPollInterval(pending, 1), 2_000);
  assert.equal(mediaPollInterval(pending, MEDIA_POLLS), 2_000);
  assert.equal(mediaPollInterval(pending, MEDIA_POLLS + 1), false);
  assert.equal(mediaPollInterval(done, 1), false);
  assert.equal(mediaPollInterval(undefined, 0), false);
});
