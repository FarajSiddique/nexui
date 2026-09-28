import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { applyOps, GraphOpError } from '../packages/types/src/index.ts';
import {
  INTENT_ID,
  LATER,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';

const doc = { version: 1, anchorId: TRIP_ID, sections: [] };
const snapshot = mapSnapshotRow(snapshotRow(doc));
const NEW_ID = 'a1b2c3d4-0000-4000-8000-0000000000dd';

test('an update replaces the given fields and stamps updatedAt', () => {
  const next = applyOps(
    snapshot,
    [
      {
        op: 'update_object',
        id: TOKYO_ID,
        patch: { data: { ...tokyoData, days: 3 } },
        origin: 'direct',
      },
    ],
    LATER,
  );
  const tokyo = next.objects.find((o) => o.id === TOKYO_ID);

  assert.equal(tokyo.data.days, 3);
  assert.equal(tokyo.title, 'Tokyo');
  assert.equal(tokyo.updatedAt, LATER);
  assert.equal(snapshot.objects.find((o) => o.id === TOKYO_ID).data.days, 4, 'input untouched');
});

test('inserts and deletes add and remove objects and relationships', () => {
  const next = applyOps(
    snapshot,
    [
      {
        op: 'insert_object',
        id: NEW_ID,
        kind: 'insight',
        kindVersion: 1,
        title: 'Note',
        status: null,
        data: { text: 'Note', severity: 'info', actions: [] },
        source: { type: 'derived' },
        position: null,
        origin: 'derived',
      },
      { op: 'delete_relationship', id: TOKYO_REL_ID, origin: 'direct' },
      { op: 'delete_object', id: TOKYO_ID, origin: 'direct' },
    ],
    LATER,
  );

  assert.ok(next.objects.some((o) => o.id === NEW_ID && o.intentId === INTENT_ID));
  assert.ok(!next.objects.some((o) => o.id === TOKYO_ID));
  assert.ok(!next.relationships.some((r) => r.id === TOKYO_REL_ID));
});

test('set_workspace bumps the revision and update_intent merges the patch', () => {
  const next = applyOps(
    snapshot,
    [
      { op: 'set_workspace', doc: { ...doc, sections: [] }, origin: 'derived' },
      { op: 'update_intent', patch: { status: 'active' }, origin: 'direct' },
    ],
    LATER,
  );

  assert.equal(next.workspace.version, 2);
  assert.equal(next.intent.status, 'active');
  assert.equal(next.intent.goal, snapshot.intent.goal);
});

test('changing an object that is not there throws GraphOpError', () => {
  assert.throws(
    () => applyOps(snapshot, [{ op: 'delete_object', id: NEW_ID, origin: 'direct' }], LATER),
    GraphOpError,
  );
  assert.throws(
    () =>
      applyOps(
        snapshot,
        [
          {
            op: 'insert_object',
            id: TOKYO_ID,
            kind: 'place',
            kindVersion: 1,
            title: null,
            status: null,
            data: tokyoData,
            source: { type: 'user' },
            position: null,
            origin: 'direct',
          },
        ],
        LATER,
      ),
    GraphOpError,
  );
});
