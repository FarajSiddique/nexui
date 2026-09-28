import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { evaluateQuery, readField } from '../packages/types/src/index.ts';
import {
  INTENT_ID,
  KYOTO_ID,
  objectRow,
  relationshipRow,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const doc = {
  version: 1,
  anchorId: TRIP_ID,
  sections: [],
};
const osakaId = 'a1b2c3d4-0000-4000-8000-0000000000aa';
const snapshot = mapSnapshotRow(
  snapshotRow(doc, {
    objects: [
      ...snapshotRow(doc).objects,
      // Not part of the trip: no relationship.
      objectRow(osakaId, 'place', {
        name: 'Osaka',
        country: 'JP',
        placeType: 'city',
        lat: 34.69,
        lng: 135.5,
        days: 2,
      }),
    ],
  }),
);
const tripPlaces = {
  from: 'objects',
  kind: 'place',
  related: { type: 'part_of', to: { objectId: TRIP_ID }, direction: 'out' },
  sort: 'position',
};

test('related places come back in position order', () => {
  assert.deepEqual(
    evaluateQuery(snapshot, tripPlaces).map((o) => o.id),
    [TOKYO_ID, KYOTO_ID],
  );
});

test('kind alone finds every place, related or not', () => {
  assert.equal(evaluateQuery(snapshot, { from: 'objects', kind: 'place' }).length, 3);
});

test('where filters compare data fields', () => {
  const withSmall = {
    ...tripPlaces,
    related: undefined,
    where: [{ field: 'data.days', op: 'lt', value: 3 }],
  };

  assert.deepEqual(
    evaluateQuery(snapshot, withSmall).map((o) => o.id),
    [osakaId],
  );
  assert.deepEqual(
    evaluateQuery(snapshot, {
      from: 'objects',
      where: [{ field: 'data.name', op: 'in', value: ['Kyoto', 'Osaka'] }],
    })
      .map((o) => o.id)
      .sort(),
    [KYOTO_ID, osakaId].sort(),
  );
});

test('sort by a field descending, then limit', () => {
  const byName = {
    from: 'objects',
    kind: 'place',
    sort: { field: 'data.name', dir: 'desc' },
    limit: 2,
  };

  assert.deepEqual(
    evaluateQuery(snapshot, byName).map((o) => o.data.name),
    ['Tokyo', 'Osaka'],
  );
});

test('the in direction follows relationships into an object', () => {
  const partsOfTrip = {
    from: 'objects',
    kind: 'trip',
    related: { type: 'part_of', to: { objectId: TOKYO_ID }, direction: 'in' },
  };

  assert.deepEqual(
    evaluateQuery(snapshot, partsOfTrip).map((o) => o.id),
    [TRIP_ID],
  );
});

test('a relationship to the intent matches the intent ref', () => {
  const withIntentEdge = mapSnapshotRow(
    snapshotRow(doc, {
      relationships: [
        {
          ...relationshipRow(
            'a1b2c3d4-0000-4000-8000-0000000000bb',
            TRIP_ID,
            INTENT_ID,
            'anchor_of',
          ),
          target_type: 'intent',
        },
      ],
    }),
  );

  assert.deepEqual(
    evaluateQuery(withIntentEdge, {
      from: 'objects',
      related: { type: 'anchor_of', to: 'intent', direction: 'out' },
    }).map((o) => o.id),
    [TRIP_ID],
  );
});

test('object queries find one object or none', () => {
  assert.deepEqual(
    evaluateQuery(snapshot, { from: 'object', id: KYOTO_ID }).map((o) => o.id),
    [KYOTO_ID],
  );
  assert.deepEqual(
    evaluateQuery(snapshot, { from: 'object', id: osakaId.replace('aa', 'cc') }),
    [],
  );
});

test('readField reads columns and data keys only', () => {
  const tokyo = snapshot.objects.find((o) => o.id === TOKYO_ID);

  assert.equal(readField(tokyo, 'title'), 'Tokyo');
  assert.equal(readField(tokyo, 'data.days'), 4);
  assert.equal(readField(tokyo, 'intentId'), undefined);
});
