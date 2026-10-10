import assert from 'node:assert/strict';
import test from 'node:test';

import { capabilityNameSchema } from '../packages/types/src/index.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import {
  idSequence,
  KYOTO_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  RUN_ID,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripData,
} from './support/graph.mjs';

const CAPABILITIES = TEMPLATES.travel.capabilities;
const findCapability = (name) => CAPABILITIES.find((capability) => capability.name === name);
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

// Two options with places: Nara (suggests 2 days, with a train from Kyoto) and Koyasan.
const koyasan = { name: 'Koyasan', country: 'JP', placeType: 'town', lat: 34.21, lng: 135.59 };
const twoPlaces = {
  ref: 'spare',
  question: 'Where should the spare time go?',
  options: [
    {
      label: 'Nara',
      summary: 'Temples and deer.',
      place: { ...nara, days: 2 },
      leg: { mode: 'train', estHours: 0.75, estCost: { amount: 7, currency: 'USD' } },
    },
    { label: 'Koyasan', summary: 'A temple stay.', place: koyasan },
  ],
};

// `proposal` with its second option giving the days to `stop`, a stop already on the route.
function stayLongerIn(stop) {
  return { ...proposal, options: [proposal.options[0], { ...proposal.options[1], extend: stop }] };
}

// The plan-1 trip (Tokyo 3 days, then Kyoto 4) with this many free days, and `input` proposed.
function proposedWithFree(unallocatedDays, input = twoPlaces) {
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        objectRow(
          TRIP_ID,
          'trip',
          { ...tripData, derived: { ...tripData.derived, unallocatedDays } },
          { title: 'Plan Japan in December' },
        ),
        objectRow(TOKYO_ID, 'place', { ...tokyoData, days: 3 }, { title: 'Tokyo', position: 1 }),
        kyotoRow,
      ],
    }),
  );
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot,
    actor: 'user',
    runId: null,
    newId: idSequence(),
    clock,
  });

  s.call('decision.propose', input);
  s.takeOps();

  return s;
}

const placeUpdate = (ops, id) => ops.find((op) => op.op === 'update_object' && op.id === id);
const newLeg = (ops) => ops.find((op) => op.op === 'insert_object' && op.kind === 'leg');
const deletedIds = (ops) => ops.filter((op) => op.op === 'delete_object').map((op) => op.id);

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

test('a remembered request never ends in half of an emoji', () => {
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot: shortened,
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock,
    request: 'a'.repeat(299) + '\u{1F600}' + 'more',
  });

  s.call('decision.propose', proposal);

  const [decision] = s.takeOps();

  assert.equal(decision.data.asked, 'a'.repeat(299));
  assert.ok(decision.data.asked.isWellFormed());
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

test('dismissing a decision closes it, deletes its candidate and removes its section', () => {
  const s = stager();

  s.call('decision.propose', proposal);
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'rural' });

  const [decision, deleted, workspace] = s.takeOps();

  assert.equal(decision.patch.data.status, 'dismissed');
  assert.deepEqual(deleted, {
    op: 'delete_object',
    id: s.refs.byRef.get('rural-1-place'),
    origin: 'direct',
  });
  assert.equal(workspace.doc.sections.length, 5);
});

test('a pick takes the free days, and the leg hint while its stop is still last', () => {
  const s = proposedWithFree(3);

  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  const ops = s.takeOps();

  assert.equal(placeUpdate(ops, s.refs.byRef.get('spare-1-place')).patch.data.days, 3);
  assert.equal(newLeg(ops).title, 'Kyoto → Nara');
  assert.deepEqual(newLeg(ops).data, {
    mode: 'train',
    estHours: 0.75,
    estCost: { amount: 7, currency: 'USD' },
  });
});

test('with no free days a pick takes the suggested days, then 1', () => {
  const cases = [
    [null, 'spare-1', 2],
    [-2, 'spare-1', 2],
    [0, 'spare-2', 1],
    [null, 'spare-2', 1],
  ];

  for (const [free, optionId, days] of cases) {
    const s = proposedWithFree(free);

    s.call('decision.resolve', { decisionId: 'spare', optionId });

    const placeId = s.refs.byRef.get(`${optionId}-place`);

    assert.equal(
      placeUpdate(s.takeOps(), placeId).patch.data.days,
      days,
      `${free} free, ${optionId}`,
    );
  }
});

test('a leg hint from a stop that is no longer last is not used', () => {
  const s = proposedWithFree(1);

  s.call('trip.reorderPlaces', { placeIds: [KYOTO_ID, TOKYO_ID] });
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  const leg = newLeg(s.takeOps());

  assert.equal(leg.title, 'Tokyo → Nara');
  assert.deepEqual(leg.data, { mode: 'other' });
});

test('an option can give the free days to a stop already on the route', () => {
  const s = stager('user');

  // o2 is Kyoto, the last stop (see the reorder test).
  s.call('decision.propose', stayLongerIn('o2'));

  const options = s.takeOps().filter((op) => op.op === 'insert_object' && op.kind === 'option');

  assert.deepEqual(
    options.map((option) => option.data.extendPlaceId),
    [undefined, KYOTO_ID],
  );

  s.call('decision.resolve', { decisionId: 'rural', optionId: 'rural-2' });

  const ops = s.takeOps();

  assert.deepEqual(placeUpdate(ops, KYOTO_ID).patch, { data: { ...kyotoData, days: 5 } });
  assert.equal(newLeg(ops), undefined);
  assert.deepEqual(deletedIds(ops), [s.refs.byRef.get('rural-1-place')]);
});

test('an extended stop gains 1 day when none are free, and none once it leaves the route', () => {
  for (const free of [null, 0, -2]) {
    const s = proposedWithFree(free, stayLongerIn(KYOTO_ID));

    s.call('decision.resolve', { decisionId: 'rural', optionId: 'rural-2' });
    assert.equal(placeUpdate(s.takeOps(), KYOTO_ID).patch.data.days, 5, `${free} free`);
  }

  const s = proposedWithFree(1, stayLongerIn(KYOTO_ID));

  s.call('relationship.delete', { from: KYOTO_ID, type: 'part_of', to: 'trip' });
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'rural', optionId: 'rural-2' });

  const [decision, ...rest] = s.takeOps();

  assert.equal(decision.patch.data.status, 'resolved');
  assert.equal(placeUpdate(rest, KYOTO_ID), undefined);
});

test('an option adds a place or extends a stop, not both, and only a stop on the route', () => {
  const s = stager();

  assert.throws(
    () =>
      s.call('decision.propose', {
        ...proposal,
        options: [{ ...proposal.options[0], extend: 'o2' }, proposal.options[1]],
      }),
    refused(/^"Nara" adds a place or extends a stop, not both\.$/),
  );

  // o1 is the length decision; "kyoto" names nothing. Neither is a stop, so neither is kept.
  s.call('decision.propose', stayLongerIn('o1'));
  s.call('decision.propose', { ...stayLongerIn('kyoto'), ref: 'typo' });

  const options = s.takeOps().filter((op) => op.op === 'insert_object' && op.kind === 'option');

  assert.equal(options.length, 4);
  assert.ok(options.every((option) => option.data.extendPlaceId === undefined));
});

test('a pick deletes the candidates nobody chose and keeps the decision as a record', () => {
  const s = proposedWithFree(1);
  const naraId = s.refs.byRef.get('spare-1-place');
  const koyasanId = s.refs.byRef.get('spare-2-place');

  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  assert.deepEqual(deletedIds(s.takeOps()), [koyasanId]);
  assert.ok(s.graph().objects.some((object) => object.id === naraId));
  assert.equal(s.graph().objects.filter((object) => object.kind === 'option').length, 2);
  assert.equal(
    s
      .graph()
      .objects.find((object) => object.kind === 'decision' && object.title === twoPlaces.question)
      .data.status,
    'resolved',
  );
});

test('dismissing deletes every candidate except one the user put on the route', () => {
  const s = proposedWithFree(1);
  const naraId = s.refs.byRef.get('spare-1-place');
  const koyasanId = s.refs.byRef.get('spare-2-place');

  s.call('relationship.create', { from: 'spare-1-place', type: 'part_of', to: 'trip' });
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'spare' });

  assert.deepEqual(deletedIds(s.takeOps()), [koyasanId]);
  assert.ok(s.graph().objects.some((object) => object.id === naraId));
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
