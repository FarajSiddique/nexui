import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  stayLine,
  stopButtonLabel,
  stopDetails,
  stopSubtitle,
} from '../apps/mobile/src/features/workspace/stop-details.ts';
import {
  KYOTO_ID,
  KYOTO_REL_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  relationshipRow,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const id = (n) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LEG_ID = id(201);
const STAY_ID = id(202);
const NARA_ID = id(203);

// Tokyo, then Kyoto by train with a stay there, and Nara as a decision candidate off the route.
function plan() {
  return mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(LEG_ID, 'leg', {
          mode: 'train',
          estHours: 2.25,
          estCost: { amount: 95, currency: 'USD' },
        }),
        objectRow(STAY_ID, 'stay', {
          name: 'Hotel Kanra',
          placeId: KYOTO_ID,
          nights: 3,
          estNightly: { amount: 120, currency: 'USD' },
        }),
        objectRow(NARA_ID, 'place', { ...kyotoData, name: 'Nara', lat: 34.69, lng: 135.8 }),
      ],
      relationships: [
        relationshipRow(TOKYO_REL_ID, TOKYO_ID, TRIP_ID),
        relationshipRow(KYOTO_REL_ID, KYOTO_ID, TRIP_ID),
        relationshipRow(id(211), LEG_ID, TRIP_ID),
        relationshipRow(id(212), LEG_ID, TOKYO_ID, 'leg_from'),
        relationshipRow(id(213), LEG_ID, KYOTO_ID, 'leg_to'),
        relationshipRow(id(214), STAY_ID, TRIP_ID),
      ],
    }),
  );
}

test('a stop knows its place on the route, the next stop and the leg there', () => {
  const tokyo = stopDetails(plan(), TOKYO_ID);

  assert.equal(tokyo.order, 1);
  assert.equal(tokyo.count, 2);
  assert.equal(tokyo.next.place.id, KYOTO_ID);
  assert.equal(tokyo.next.leg.id, LEG_ID);
  assert.deepEqual(tokyo.stays, []);
  assert.equal(tokyo.canEditDays, true);
  assert.equal(stopSubtitle(tokyo), 'City in Japan, the first of 2 stops');
});

test('the last stop has no next stop and lists its stays', () => {
  const kyoto = stopDetails(plan(), KYOTO_ID);

  assert.equal(kyoto.next, null);
  assert.deepEqual(
    kyoto.stays.map((stay) => stay.id),
    [STAY_ID],
  );
  assert.equal(stayLine(kyoto.stays[0].data), '3 nights, ≈ $120 a night');
});

test('a candidate off the route, a removed stop or a plan with no workspace has no details', () => {
  assert.equal(stopDetails(plan(), NARA_ID), null);
  assert.equal(stopDetails(plan(), id(999)), null);
  assert.equal(stopDetails({ ...plan(), workspace: null }, TOKYO_ID), null);
});

test('labels and lines read naturally', () => {
  assert.equal(stopButtonLabel('Berlin', 1, 3), 'Berlin, stop 1, 3 days. Show details');
  assert.equal(
    stopSubtitle({ data: { placeType: 'region', country: 'AT' }, order: 1, count: 1 }),
    'Region in Austria, the only stop',
  );
  assert.equal(
    stopSubtitle({ data: { placeType: 'town', country: 'IT' }, order: 12, count: 14 }),
    'Town in Italy, the 12th of 14 stops',
  );
  assert.equal(stayLine({ nights: 1 }), '1 night');
});
