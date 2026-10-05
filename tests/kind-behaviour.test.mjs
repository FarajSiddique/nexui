import assert from 'node:assert/strict';
import test from 'node:test';

import { graphCapabilities } from '../apps/api/src/lib/capabilities/graph.ts';
import { workspaceCapabilities } from '../apps/api/src/lib/capabilities/workspace.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { KIND_BEHAVIOUR } from '../apps/api/src/lib/kinds/behaviour.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { KIND_REGISTRY } from '../packages/types/src/index.ts';
import {
  KYOTO_ID,
  objectRow,
  relationshipRow,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const LEG_ID = 'e0000000-0000-4000-8000-000000000001';
const STAY_ID = 'e0000000-0000-4000-8000-000000000002';

test('every kind has behaviour, and its links point at registered kinds', () => {
  assert.deepEqual(Object.keys(KIND_BEHAVIOUR).sort(), Object.keys(KIND_REGISTRY).sort());

  for (const [kind, behaviour] of Object.entries(KIND_BEHAVIOUR)) {
    const inputs = behaviour.links.map((kindLink) => kindLink.input);

    assert.equal(new Set(inputs).size, inputs.length, kind);

    for (const kindLink of behaviour.links) {
      assert.ok(Object.hasOwn(KIND_REGISTRY, kindLink.to), `${kind} links to ${kindLink.to}`);
    }

    if (behaviour.creatable || behaviour.editable) {
      assert.ok(behaviour.modelHelp, `${kind} needs help text for models`);
    }

    if (behaviour.creatable) {
      assert.ok(behaviour.editable, `${kind} can be made but not changed`);
    }
  }
});

test('removing a place takes its legs and its stays with it', () => {
  const row = snapshotRow(travelWorkspace(TRIP_ID));
  const snapshot = mapSnapshotRow({
    ...row,
    objects: [
      ...row.objects,
      objectRow(LEG_ID, 'leg', { mode: 'train' }, { title: 'Tokyo → Kyoto' }),
      objectRow(STAY_ID, 'stay', { name: 'Ryokan', placeId: TOKYO_ID, nights: 2 }),
    ],
    relationships: [
      ...row.relationships,
      relationshipRow('e0000000-0000-4000-8000-000000000003', LEG_ID, TOKYO_ID, 'leg_from'),
      relationshipRow('e0000000-0000-4000-8000-000000000004', LEG_ID, KYOTO_ID, 'leg_to'),
    ],
  });
  const gone = (id) =>
    KIND_BEHAVIOUR.place
      .dependents(
        snapshot,
        snapshot.objects.find((object) => object.id === id),
      )
      .map((object) => object.id)
      .sort();

  assert.deepEqual(gone(TOKYO_ID), [LEG_ID, STAY_ID].sort());
  assert.deepEqual(gone(KYOTO_ID), [LEG_ID]);
});

test('the generic capabilities are assembled from a template’s kinds', () => {
  const scope = {
    anchorKind: 'trip',
    kinds: ['trip', 'thing'],
    examples: {
      objectRef: 'packing',
      decisionRef: 'when',
      metric: '{"cost": 1}',
      sectionId: 'list',
      field: 'title',
    },
  };
  const [create, update, remove, relate] = graphCapabilities(scope);
  const [addSection] = workspaceCapabilities(scope);
  const createInput = create.input.toJSONSchema();

  assert.equal(
    create.description,
    'Add a thing to the trip, with a new ref to use in later calls.',
  );
  assert.deepEqual(Object.keys(createInput.properties), ['ref', 'kind', 'title', 'data']);
  assert.deepEqual(createInput.properties.kind.enum, ['thing']);
  assert.equal(
    update.description,
    'Change fields of the trip or of one of its things. Send only the data fields to change; ' +
      'the rest keep their values.',
  );
  assert.equal(remove.description, 'Remove a thing from the trip.');
  assert.deepEqual(relate.input.toJSONSchema().properties.type.enum, ['part_of', 'option_of']);
  assert.deepEqual(addSection.input.toJSONSchema().properties.kind.enum, ['thing']);
});
