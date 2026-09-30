import assert from 'node:assert/strict';
import test from 'node:test';

import { GRAPH_CAPABILITIES } from '../apps/api/src/lib/capabilities/graph.ts';
import { buildRefTable, resolveRef } from '../apps/api/src/lib/capabilities/refs.ts';
import { createStager } from '../apps/api/src/lib/capabilities/stage.ts';
import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  idSequence,
  KYOTO_ID,
  objectRow,
  RUN_ID,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';

const snapshot = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const clock = () => new Date('2026-09-29T10:00:00Z');
const osaka = { name: 'Osaka', country: 'JP', placeType: 'city', lat: 34.69, lng: 135.5, days: 2 };

function stager(overrides = {}) {
  return createStager({
    capabilities: GRAPH_CAPABILITIES,
    snapshot,
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock,
    ...overrides,
  });
}

function refused(message) {
  return (error) => error instanceof CapabilityError && message.test(error.message);
}

test('the model names objects by ref: trip, then o1, o2 … oldest first', () => {
  const table = buildRefTable(snapshot, TRIP_ID);

  // Tokyo and Kyoto share a creation time, so the title breaks the tie.
  assert.deepEqual(Object.fromEntries(table.byRef), { trip: TRIP_ID, o1: KYOTO_ID, o2: TOKYO_ID });
  assert.equal(table.byId.get(TOKYO_ID), 'o2');
});

test('a ref or an id in this intent resolves; anything else does not', () => {
  const table = buildRefTable(snapshot, TRIP_ID);

  assert.equal(resolveRef(table, snapshot, 'o2').id, TOKYO_ID);
  assert.equal(resolveRef(table, snapshot, TOKYO_ID).id, TOKYO_ID);
  assert.throws(() => resolveRef(table, snapshot, 'o9'), refused(/^Nothing is called "o9"\.$/));
  assert.throws(
    () => resolveRef(table, snapshot, 'ffffffff-0000-4000-8000-000000000000'),
    refused(/^Nothing is called/),
  );
});

test('object.create adds a place to the end of the route, as the run', () => {
  const s = stager();

  assert.deepEqual(s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka }), {
    ref: 'osaka',
  });

  const ops = s.takeOps();
  const placeId = 'b0000000-0000-4000-8000-000000000001';

  assert.deepEqual(ops, [
    {
      op: 'insert_object',
      id: placeId,
      kind: 'place',
      kindVersion: 1,
      title: 'Osaka',
      status: null,
      data: osaka,
      source: { type: 'ai', runId: RUN_ID },
      position: 3,
      origin: 'direct',
    },
    {
      op: 'insert_relationship',
      id: 'b0000000-0000-4000-8000-000000000002',
      sourceType: 'object',
      sourceId: placeId,
      targetType: 'object',
      targetId: TRIP_ID,
      type: 'part_of',
      metadata: null,
      origin: 'direct',
    },
  ]);
  assert.equal(s.refs.byRef.get('osaka'), placeId);

  const [entry] = s.takeEntries();

  assert.equal(entry.capability, 'object.create');
  assert.equal(entry.label, 'Added Osaka');
  assert.equal(entry.ok, true);
  assert.equal(typeof entry.ms, 'number');
  assert.deepEqual(entry.input, { ref: 'osaka', kind: 'place', data: osaka });
});

test('a leg joins two places and is named after them', () => {
  const s = stager();

  s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka });
  s.call('object.create', {
    ref: 'kyoto-osaka',
    kind: 'leg',
    from: 'o1',
    to: 'osaka',
    data: { mode: 'train', estHours: 0.5 },
  });

  const ops = s.takeOps().slice(2);
  const legId = ops[0].id;

  assert.equal(ops[0].title, 'Kyoto → Osaka');
  assert.equal(ops[0].position, null);
  assert.deepEqual(
    ops.slice(1).map((op) => [op.sourceId, op.type, op.targetId]),
    [
      [legId, 'part_of', TRIP_ID],
      [legId, 'leg_from', KYOTO_ID],
      [legId, 'leg_to', s.refs.byRef.get('osaka')],
    ],
  );
  assert.throws(
    () => s.call('object.create', { ref: 'x', kind: 'leg', from: 'o1', data: { mode: 'car' } }),
    refused(/^A leg needs a from place and a to place\.$/),
  );
});

test('invalid data is refused and leaves nothing staged', () => {
  const s = stager();

  assert.throws(
    () => s.call('object.create', { ref: 'osaka', kind: 'place', data: { ...osaka, days: -1 } }),
    refused(/^Invalid place: days/),
  );
  assert.deepEqual(s.takeOps(), []);
  assert.equal(s.refs.byRef.has('osaka'), false);

  const [entry] = s.takeEntries();

  assert.equal(entry.ok, false);
  assert.match(entry.error, /^Invalid place: days/);
});

test('a new ref must be well formed and unused', () => {
  const s = stager();

  s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka });
  assert.throws(
    () => s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka }),
    refused(/^The ref "osaka" is already used\.$/),
  );
  assert.throws(
    () => s.call('object.create', { ref: 'o7', kind: 'place', data: osaka }),
    refused(/can't be used as a ref/),
  );
  assert.throws(
    () => s.call('object.create', { ref: 'Osaka City', kind: 'place', data: osaka }),
    refused(/can't be used as a ref/),
  );
});

test('object.update changes only the fields given and never the derived figures', () => {
  const s = stager();

  s.call('object.update', { ref: 'o2', data: { days: 3, derived: { totalDays: 99 } } });
  s.call('object.update', { ref: 'o1', data: { name: 'Kyoto City' } });

  const [tokyo, kyoto] = s.takeOps();

  assert.deepEqual(tokyo.patch, { data: { ...tokyoData, days: 3 } });
  assert.equal(kyoto.patch.title, 'Kyoto City');
  assert.equal(kyoto.patch.data.name, 'Kyoto City');
});

test('decisions, options and insights are not edited through object.update', () => {
  const decisionId = 'd0000000-0000-4000-8000-000000000001';
  const withDecision = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        ...snapshotRow(travelWorkspace(TRIP_ID)).objects,
        objectRow(
          decisionId,
          'decision',
          { question: 'Which city?', status: 'open' },
          {
            title: 'Which city?',
          },
        ),
      ],
    }),
  );
  const s = stager({ snapshot: withDecision });

  assert.throws(
    () => s.call('object.update', { ref: decisionId, data: { status: 'resolved' } }),
    refused(/^Which city\? can't be edited this way\.$/),
  );
});

test('object.delete removes a place with its links and the legs to it', () => {
  const s = stager();

  s.call('object.create', {
    ref: 'kyoto-tokyo',
    kind: 'leg',
    from: 'o1',
    to: 'o2',
    data: { mode: 'train' },
  });

  const legId = s.refs.byRef.get('kyoto-tokyo');

  s.takeOps();
  s.call('object.delete', { ref: 'o2' });

  const ops = s.takeOps();
  const deletedLinks = ops.filter((op) => op.op === 'delete_relationship').map((op) => op.id);

  assert.deepEqual(
    ops.filter((op) => op.op === 'delete_object').map((op) => op.id),
    [TOKYO_ID, legId],
  );
  assert.ok(deletedLinks.includes(TOKYO_REL_ID));
  assert.equal(new Set(deletedLinks).size, deletedLinks.length);
  assert.equal(deletedLinks.length, 4);
  assert.throws(
    () => s.call('object.delete', { ref: 'trip' }),
    refused(/^The trip itself can't be removed\.$/),
  );
});

test('relationship.create refuses a duplicate; relationship.delete needs a link', () => {
  const s = stager();

  assert.throws(
    () => s.call('relationship.create', { from: 'o2', type: 'part_of', to: 'trip' }),
    refused(/^That link already exists\.$/),
  );
  assert.throws(
    () => s.call('relationship.delete', { from: 'o1', type: 'leg_to', to: 'o2' }),
    refused(/^Kyoto isn't linked to Tokyo that way\.$/),
  );

  s.call('relationship.delete', { from: 'o2', type: 'part_of', to: 'trip' });
  assert.deepEqual(s.takeOps(), [
    { op: 'delete_relationship', id: TOKYO_REL_ID, origin: 'direct' },
  ]);
});

test('takeOps hands over one step; reset starts from a committed snapshot and keeps refs', () => {
  const s = stager();

  s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka });
  assert.equal(s.graph().objects.length, 4);
  assert.equal(s.takeOps().length, 2);
  assert.deepEqual(s.takeOps(), []);

  s.reset(snapshot);
  assert.equal(s.graph(), snapshot);
  assert.equal(s.refs.byRef.has('osaka'), true);
});

test('a user call records the user as the source', () => {
  const s = stager({ actor: 'user', runId: null });

  s.call('object.create', { ref: 'osaka', kind: 'place', data: osaka });
  assert.deepEqual(s.takeOps()[0].source, { type: 'user' });
});

test('an intent without a workspace has nothing to stage', () => {
  assert.throws(
    () => stager({ snapshot: { ...snapshot, workspace: null } }),
    refused(/^Nexui can only change trips so far\.$/),
  );
});

test('the help text gives every money field the {amount, currency} shape', () => {
  const capability = (name) => GRAPH_CAPABILITIES.find((candidate) => candidate.name === name);

  const dataHelp = capability('object.create').input.shape.data.description;

  for (const field of ['estDailyCost', 'estCost', 'estNightly']) {
    assert.match(dataHelp, new RegExp(`${field}\\? \\{amount, currency\\}`));
  }

  const updateHelp = capability('object.update').input.shape.data.description;

  assert.match(updateHelp, /budget\? \{amount, currency\}/);
});
