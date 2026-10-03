import assert from 'node:assert/strict';
import test from 'node:test';

import { capabilityNameSchema } from '../packages/types/src/index.ts';
import { CAPABILITIES, findCapability } from '../apps/api/src/lib/capabilities/registry.ts';
import { createStager } from '../apps/api/src/lib/capabilities/stage.ts';
import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  idSequence,
  KYOTO_ID,
  kyotoRow,
  objectRow,
  RUN_ID,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripData,
} from './support/graph.mjs';

const clock = () => new Date('2026-09-29T10:00:00Z');
const LENGTH_DECISION_ID = 'd0000000-0000-4000-8000-000000000001';

// Tokyo went from 4 to 3 days, so one day of the 8 is free.
const shortened = mapSnapshotRow(
  snapshotRow(travelWorkspace(TRIP_ID), {
    objects: [
      objectRow(
        TRIP_ID,
        'trip',
        { ...tripData, derived: { ...tripData.derived, allocatedDays: 7, unallocatedDays: 1 } },
        { title: 'Plan Japan in December' },
      ),
      objectRow(TOKYO_ID, 'place', { ...tokyoData, days: 3 }, { title: 'Tokyo', position: 1 }),
      kyotoRow,
      objectRow(
        LENGTH_DECISION_ID,
        'decision',
        { question: 'How long is the trip?', status: 'open', derivedKey: 'trip.length' },
        { title: 'How long is the trip?' },
      ),
    ],
  }),
);

function stager(actor = 'ai') {
  return createStager({
    capabilities: CAPABILITIES,
    snapshot: shortened,
    actor,
    runId: actor === 'ai' ? RUN_ID : null,
    newId: idSequence(),
    clock,
  });
}

function refused(message) {
  return (error) => error instanceof CapabilityError && message.test(error.message);
}

const nara = {
  name: 'Nara',
  country: 'JP',
  placeType: 'city',
  lat: 34.68,
  lng: 135.8,
  why: 'Deer park and quiet temples an hour from Kyoto.',
};
const proposal = {
  ref: 'rural',
  question: 'Where should the free day go?',
  tradeoff: 'A new town costs travel time; a longer stay costs variety.',
  options: [
    {
      label: 'Nara',
      summary: 'A day among temples and deer.',
      fit: 'An easy day trip',
      place: nara,
    },
    { label: 'Stay longer in Kyoto', summary: 'One more slow day.', pros: ['No travel'] },
  ],
};

test('the registry holds the slice-1 capabilities, and only three are for buttons', () => {
  const names = CAPABILITIES.map((capability) => capability.name);

  assert.deepEqual([...names].sort(), [
    'decision.propose',
    'decision.resolve',
    'object.create',
    'object.delete',
    'object.update',
    'relationship.create',
    'relationship.delete',
    'trip.reorderPlaces',
    'trip.setPlaceDays',
    'workspace.addSection',
    'workspace.moveSection',
    'workspace.removeSection',
  ]);
  assert.equal(new Set(names).size, names.length);

  for (const capability of CAPABILITIES) {
    assert.equal(capabilityNameSchema.safeParse(capability.name).success, true, capability.name);
    assert.equal(capability.policy, 'internal', capability.name);
    assert.equal(capability.exposeToModel, true, capability.name);
  }

  assert.deepEqual(
    CAPABILITIES.filter((capability) => capability.callableByUser)
      .map((c) => c.name)
      .sort(),
    ['decision.resolve', 'trip.reorderPlaces', 'trip.setPlaceDays'],
  );
  assert.equal(findCapability('derive.trip'), undefined);
});

test('the insight’s "give it back" input runs as the user, by id', () => {
  const s = stager('user');

  s.call('trip.setPlaceDays', { placeId: TOKYO_ID, days: 4 });
  assert.deepEqual(s.takeOps(), [
    {
      op: 'update_object',
      id: TOKYO_ID,
      patch: { data: { ...tokyoData, days: 4 } },
      origin: 'direct',
    },
  ]);
  assert.throws(
    () => s.call('trip.setPlaceDays', { placeId: TOKYO_ID, days: 4 }),
    refused(/^Tokyo already has 4 days\.$/),
  );
  assert.throws(
    () => s.call('trip.setPlaceDays', { placeId: 'trip', days: 2 }),
    refused(/is not a place\.$/),
  );
});

test('trip.reorderPlaces renumbers the route and needs every stop once', () => {
  const s = stager();

  // All share a creation time, so kind then title order them: o1 is the length decision, o2
  // Kyoto, o3 Tokyo. The route is Tokyo, Kyoto.
  s.call('trip.reorderPlaces', { placeIds: ['o2', 'o3'] });
  assert.deepEqual(
    s.takeOps().map((op) => [op.id, op.patch.position]),
    [
      [KYOTO_ID, 1],
      [TOKYO_ID, 2],
    ],
  );
  assert.throws(
    () => s.call('trip.reorderPlaces', { placeIds: ['o2'] }),
    refused(/^List every stop on the route exactly once\.$/),
  );
  assert.throws(
    () => s.call('trip.reorderPlaces', { placeIds: ['o2', 'o3'] }),
    refused(/^The route is already in that order\.$/),
  );
});

test('decision.propose adds the question, its options and a pinned section', () => {
  const s = stager();

  assert.deepEqual(s.call('decision.propose', proposal), {
    ref: 'rural',
    options: ['rural-1', 'rural-2'],
  });

  const ops = s.takeOps();
  const [decision, partOf, place, option1, optionOf1, option2, optionOf2, workspace] = ops;

  assert.equal(ops.length, 8);
  assert.deepEqual(decision.data, {
    question: 'Where should the free day go?',
    status: 'open',
    tradeoff: 'A new town costs travel time; a longer stay costs variety.',
  });
  assert.deepEqual(
    [partOf.sourceId, partOf.type, partOf.targetId],
    [decision.id, 'part_of', TRIP_ID],
  );
  assert.deepEqual(place.data, { ...nara, days: 0 });
  assert.equal(place.position, null);
  assert.equal(option1.data.placeId, place.id);
  assert.deepEqual(option1.data.pros, []);
  assert.equal(option1.data.fit, 'An easy day trip');
  assert.deepEqual(
    [optionOf1.sourceId, optionOf1.type, optionOf1.targetId],
    [option1.id, 'option_of', decision.id],
  );
  assert.equal(option2.data.placeId, undefined);
  assert.equal(optionOf2.targetId, decision.id);

  const ids = workspace.doc.sections.map((section) => section.id);

  assert.deepEqual(ids, ['map', 'metrics', 'days', 'insights', `decision-${decision.id}`, 'route']);
  assert.equal(workspace.doc.sections[4].pin, 'open');
  assert.equal(s.refs.byRef.get('rural-1-place'), place.id);
  assert.throws(() => s.call('decision.propose', proposal), refused(/already used/));
});

test('an AI proposal remembers what was asked, and its options keep their hints', () => {
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot: shortened,
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock,
    request: 'How should I use the 1 day I have free?',
  });

  s.call('decision.propose', {
    ...proposal,
    options: [
      {
        ...proposal.options[0],
        place: { ...nara, days: 2 },
        leg: { mode: 'train', estHours: 0.75 },
      },
      { ...proposal.options[1], leg: { mode: 'bus' } },
    ],
  });

  const [decision, , place, option1, , option2] = s.takeOps();

  assert.equal(decision.data.asked, 'How should I use the 1 day I have free?');
  assert.deepEqual(place.data, { ...nara, days: 0 });
  assert.equal(option1.data.suggestedDays, 2);
  assert.deepEqual(option1.data.leg, { mode: 'train', estHours: 0.75, fromPlaceId: KYOTO_ID });
  // A leg hint means nothing without a place to go to.
  assert.equal(option2.data.leg, undefined);
  assert.equal(option2.data.suggestedDays, undefined);
});

test('a suggested length is a whole number of days from 1 to 365', () => {
  const s = stager();

  assert.throws(
    () =>
      s.call('decision.propose', {
        ...proposal,
        options: [{ ...proposal.options[0], place: { ...nara, days: 0 } }, proposal.options[1]],
      }),
    refused(/days/),
  );
});

test('choosing an option puts its place on the route with the free days and a leg', () => {
  const s = stager('user');

  s.call('decision.propose', proposal);
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'rural', optionId: 'rural-1' });

  const ops = s.takeOps();
  const decisionId = s.refs.byRef.get('rural');
  const placeId = s.refs.byRef.get('rural-1-place');
  const [decision, place, onTrip, leg, legOnTrip, legFrom, legTo, workspace] = ops;

  assert.deepEqual(decision.patch.data, {
    question: 'Where should the free day go?',
    status: 'resolved',
    tradeoff: 'A new town costs travel time; a longer stay costs variety.',
    chosenOptionId: s.refs.byRef.get('rural-1'),
  });
  assert.deepEqual(place.patch, { data: { ...nara, days: 1 }, position: 3 });
  assert.deepEqual([onTrip.sourceId, onTrip.type, onTrip.targetId], [placeId, 'part_of', TRIP_ID]);
  assert.equal(leg.title, 'Kyoto → Nara');
  assert.deepEqual(leg.data, { mode: 'other' });
  assert.deepEqual(
    [legOnTrip, legFrom, legTo].map((op) => [op.type, op.targetId]),
    [
      ['part_of', TRIP_ID],
      ['leg_from', KYOTO_ID],
      ['leg_to', placeId],
    ],
  );
  assert.equal(
    workspace.doc.sections.some((section) => section.id === `decision-${decisionId}`),
    false,
  );
  assert.throws(
    () => s.call('decision.resolve', { decisionId: 'rural' }),
    refused(/^That question is already settled\.$/),
  );
});

test('dismissing a decision closes it and removes its section', () => {
  const s = stager();

  s.call('decision.propose', proposal);
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'rural' });

  const [decision, workspace] = s.takeOps();

  assert.equal(decision.patch.data.status, 'dismissed');
  assert.equal(workspace.doc.sections.length, 5);
});

test('decisions settle only through their own options, and derived ones settle themselves', () => {
  const s = stager();

  s.call('decision.propose', proposal);
  s.call('decision.propose', { ...proposal, ref: 'other' });
  assert.throws(
    () => s.call('decision.resolve', { decisionId: 'rural', optionId: 'other-1' }),
    refused(/^Nara is not an option for this question\.$/),
  );
  assert.throws(
    () => s.call('decision.resolve', { decisionId: LENGTH_DECISION_ID }),
    refused(/^That question settles itself as the trip changes\.$/),
  );
});

test('workspace sections can be added, moved and removed', () => {
  const s = stager();

  s.call('workspace.addSection', {
    id: 'costs',
    type: 'comparison',
    title: 'Daily costs',
    kind: 'place',
    fields: [{ field: 'data.estDailyCost', label: 'Per day', format: 'currency' }],
    after: 'metrics',
  });

  let sections = s.graph().workspace.doc.sections;

  assert.deepEqual(
    sections.map((section) => section.id),
    ['map', 'metrics', 'costs', 'days', 'insights', 'route'],
  );
  assert.deepEqual(sections[2].query, {
    from: 'objects',
    kind: 'place',
    related: { type: 'part_of', to: { objectId: TRIP_ID }, direction: 'out' },
    sort: 'position',
  });
  assert.equal(sections[2].title, 'Daily costs');

  s.call('workspace.moveSection', { id: 'insights', after: null });
  s.call('workspace.removeSection', { id: 'costs' });
  sections = s.graph().workspace.doc.sections;
  assert.deepEqual(
    sections.map((section) => section.id),
    ['insights', 'map', 'metrics', 'days', 'route'],
  );

  assert.throws(
    () => s.call('workspace.addSection', { id: 'map', type: 'objectList', kind: 'place' }),
    refused(/^There is already a "map" section\.$/),
  );
  assert.throws(
    () => s.call('workspace.moveSection', { id: 'map', after: 'nowhere' }),
    refused(/^There is no "nowhere" section\.$/),
  );
  assert.throws(
    () => s.call('workspace.moveSection', { id: 'map', after: 'insights' }),
    refused(/^That section is already there\.$/),
  );
});

test('an open decision’s section stays until the decision is settled', () => {
  const s = stager();

  s.call('decision.propose', proposal);

  const decisionId = s.refs.byRef.get('rural');

  assert.throws(
    () => s.call('workspace.removeSection', { id: `decision-${decisionId}` }),
    refused(/^Settle or dismiss that question instead\.$/),
  );
});
