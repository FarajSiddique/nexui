import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChangesetInvalidError,
  mapRpcError,
  ChangesetConflictError,
  GraphNotFoundError,
} from '../apps/api/src/lib/graph/errors.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import {
  coalesceOps,
  markReviewed,
  prepareChangeset,
  validateOps,
} from '../apps/api/src/lib/graph/prepare.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  idSequence,
  kyotoRow,
  LATER,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoData,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const before = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const shorten = {
  op: 'update_object',
  id: TOKYO_ID,
  patch: { data: { ...tokyoData, days: 3 } },
  origin: 'direct',
};

test('prepareChangeset returns the edit and everything derived from it', () => {
  const ops = prepareChangeset(before, [shorten], 'user', LATER, idSequence());

  assert.deepEqual(
    ops.map((op) => `${op.op}:${op.origin}`),
    [
      'update_object:direct',
      'update_object:derived',
      'insert_object:derived',
      'insert_relationship:derived',
      'update_intent:derived',
    ],
  );
  assert.equal(ops[1].patch.data.derived.unallocatedDays, 1);
});

test('invalid data is rejected with the field named', () => {
  for (const days of [-1, 2.5]) {
    assert.throws(
      () => validateOps(before, [{ ...shorten, patch: { data: { ...tokyoData, days } } }], LATER),
      (error) => error instanceof ChangesetInvalidError && /days/.test(error.message),
    );
  }
});

test('ops on missing objects or unknown kinds are rejected', () => {
  assert.throws(
    () =>
      validateOps(
        before,
        [{ op: 'delete_object', id: TOKYO_ID.replace('3', '9'), origin: 'direct' }],
        LATER,
      ),
    ChangesetInvalidError,
  );
  assert.throws(
    () =>
      validateOps(
        before,
        [
          {
            op: 'insert_object',
            id: 'a1b2c3d4-0000-4000-8000-0000000000f1',
            kind: 'spaceship',
            kindVersion: 1,
            title: null,
            status: null,
            data: {},
            source: { type: 'user' },
            position: null,
            origin: 'direct',
          },
        ],
        LATER,
      ),
    /Unknown kind/,
  );
});

test('relationships may point at objects inserted earlier in the same changeset', () => {
  const id = 'a1b2c3d4-0000-4000-8000-0000000000f2';
  const ops = [
    {
      op: 'insert_object',
      id,
      kind: 'thing',
      kindVersion: 1,
      title: 'Rail pass',
      status: null,
      data: { fields: [] },
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
    {
      op: 'insert_relationship',
      id: 'a1b2c3d4-0000-4000-8000-0000000000f3',
      sourceType: 'object',
      sourceId: id,
      targetType: 'object',
      targetId: TRIP_ID,
      type: 'part_of',
      metadata: null,
      origin: 'direct',
    },
  ];

  assert.equal(validateOps(before, ops, LATER).length, 2);
  assert.throws(
    () =>
      validateOps(before, [{ ...ops[1], sourceId: 'a1b2c3d4-0000-4000-8000-0000000000f9' }], LATER),
    ChangesetInvalidError,
  );
});

test('a second live copy of an existing link is rejected', () => {
  const duplicate = {
    op: 'insert_relationship',
    id: 'a1b2c3d4-0000-4000-8000-0000000000f5',
    sourceType: 'object',
    sourceId: TOKYO_ID,
    targetType: 'object',
    targetId: TRIP_ID,
    type: 'part_of',
    metadata: null,
    origin: 'direct',
  };

  assert.throws(
    () => validateOps(before, [duplicate], LATER),
    (error) =>
      error instanceof ChangesetInvalidError && error.message === 'That link already exists.',
  );
  assert.equal(validateOps(before, [{ ...duplicate, type: 'near' }], LATER).length, 1);
  assert.equal(
    validateOps(
      before,
      [{ op: 'delete_relationship', id: TOKYO_REL_ID, origin: 'direct' }, duplicate],
      LATER,
    ).length,
    2,
    'relinking after deleting the old link is fine',
  );
});

test('deleting what the workspace refers to is rejected', () => {
  assert.throws(
    () => validateOps(before, [{ op: 'delete_object', id: TRIP_ID, origin: 'direct' }], LATER),
    ChangesetInvalidError,
  );
  assert.equal(
    prepareChangeset(
      before,
      [{ op: 'delete_object', id: TOKYO_ID, origin: 'direct' }],
      'user',
      LATER,
      idSequence(),
    )[0].op,
    'delete_object',
    'deleting a place is fine',
  );
});

test('a workspace naming a missing decision is rejected', () => {
  const doc = travelWorkspace(TRIP_ID);
  const decision = {
    id: 'stay',
    type: 'decision',
    decisionId: 'a1b2c3d4-0000-4000-8000-0000000000f6',
    fields: [],
  };

  assert.throws(
    () =>
      validateOps(
        before,
        [
          {
            op: 'set_workspace',
            doc: { ...doc, sections: [...doc.sections, decision] },
            origin: 'direct',
          },
        ],
        LATER,
      ),
    ChangesetInvalidError,
  );
});

test('a user edit to something Nexui wrote marks it reviewed', () => {
  const aiTokyo = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        objectRow(TOKYO_ID, 'place', tokyoData, { source: { type: 'ai' } }),
        kyotoRow,
      ],
    }),
  );

  assert.deepEqual(markReviewed(aiTokyo, [shorten], 'user', LATER)[0].patch.source, {
    type: 'ai',
    reviewedAt: LATER,
  });
  assert.equal(markReviewed(aiTokyo, [shorten], 'ai', LATER)[0].patch.source, undefined);
  assert.equal(markReviewed(before, [shorten], 'user', LATER)[0].patch.source, undefined);
});

test('coalesceOps merges changes to one row, keeping first-seen order', () => {
  const id = 'a1b2c3d4-0000-4000-8000-0000000000f4';
  const insert = {
    op: 'insert_object',
    id,
    kind: 'trip',
    kindVersion: 1,
    title: 'Trip',
    status: null,
    data: { destinations: [], currency: 'USD' },
    source: { type: 'user' },
    position: null,
    origin: 'direct',
  };
  const merged = coalesceOps([
    insert,
    { op: 'set_workspace', doc: travelWorkspace(id), origin: 'direct' },
    {
      op: 'update_object',
      id,
      patch: { data: { destinations: [], currency: 'EUR' } },
      origin: 'derived',
    },
    { op: 'set_workspace', doc: { ...travelWorkspace(id), sections: [] }, origin: 'derived' },
    { op: 'update_intent', patch: { status: 'active' }, origin: 'direct' },
    { op: 'update_intent', patch: { summary: { line: 'x' } }, origin: 'derived' },
  ]);

  assert.deepEqual(
    merged.map((op) => op.op),
    ['insert_object', 'set_workspace', 'update_intent'],
  );
  assert.equal(merged[0].data.currency, 'EUR');
  assert.equal(merged[0].origin, 'direct');
  assert.deepEqual(merged[1].doc.sections, []);
  assert.deepEqual(merged[2].patch, { status: 'active', summary: { line: 'x' } });
  assert.deepEqual(coalesceOps([insert, { op: 'delete_object', id, origin: 'direct' }]), []);
  assert.throws(
    () => coalesceOps([{ op: 'delete_object', id, origin: 'direct' }, { ...insert }]),
    ChangesetInvalidError,
  );
});

test('database error codes map to user-safe errors', () => {
  assert.ok(mapRpcError({ code: 'NXU04' }) instanceof GraphNotFoundError);
  assert.equal(
    mapRpcError({ code: 'NXU08' }).message,
    'This changed while you were editing. Try again.',
  );
  assert.equal(
    mapRpcError({ code: 'NXU09' }).message,
    "Something changed since then, so this can't be undone.",
  );
  assert.equal(mapRpcError({ code: 'NXU10' }).message, 'That was already undone.');
  assert.equal(mapRpcError({ code: 'NXU11' }).message, 'That already exists.');
  assert.ok(mapRpcError({ code: 'NXU11' }) instanceof ChangesetConflictError);
  assert.equal(mapRpcError({ code: '23505' }).message, 'Saving the change failed.');
  assert.ok(mapRpcError({ code: 'NXU08' }) instanceof ChangesetConflictError);
  assert.ok(mapRpcError({ code: 'NXU22' }) instanceof ChangesetInvalidError);
  assert.equal(
    mapRpcError({ code: 'XX000', message: 'secret' }).message,
    'Saving the change failed.',
  );
});
