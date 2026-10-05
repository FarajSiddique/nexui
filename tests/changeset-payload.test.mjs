import assert from 'node:assert/strict';
import test from 'node:test';

import { mapEventRow, mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import {
  changesetLabel,
  changesetPayload,
  figureChanges,
} from '../apps/api/src/lib/graph/payload.ts';
import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { changesetPayloadSchema } from '../packages/types/src/index.ts';
import {
  eventRow,
  idSequence,
  LATER,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripData,
} from './support/graph.mjs';

const before = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const tokyoDays = (days) => ({
  op: 'update_object',
  id: TOKYO_ID,
  patch: { data: { ...tokyoData, days } },
  origin: 'direct',
});

test('a changeset of several calls is named by its first, with a count', () => {
  assert.equal(changesetLabel([]), undefined);
  assert.equal(changesetLabel(['Set Kyoto to 3 days']), 'Set Kyoto to 3 days');
  assert.equal(
    changesetLabel(['Added Kyoto', 'Added Osaka', 'Added Kyoto → Osaka']),
    'Added Kyoto and 2 more',
  );
});

test('a change that moves the trip’s figures reports them, before and after', () => {
  const ops = prepareChangeset(before, [tokyoDays(3)], 'user', LATER, idSequence());

  assert.deepEqual(figureChanges(before, ops, LATER), [
    { label: 'unallocated days', before: '0', after: '1' },
  ]);
});

test('a change that moves no figure, or a plan’s first derivation, reports none', () => {
  const rename = { op: 'update_object', id: TOKYO_ID, patch: { title: 'Tōkyō' }, origin: 'direct' };
  const renamed = prepareChangeset(before, [rename], 'user', LATER, idSequence());
  const underived = { ...tripData };

  delete underived.derived;

  const row = snapshotRow(travelWorkspace(TRIP_ID));
  const fresh = mapSnapshotRow({
    ...row,
    objects: [objectRow(TRIP_ID, 'trip', underived, { title: 'Japan' }), ...row.objects.slice(1)],
  });
  const first = prepareChangeset(fresh, [tokyoDays(3)], 'user', LATER, idSequence());

  assert.deepEqual(figureChanges(before, renamed, LATER), []);
  assert.deepEqual(figureChanges(fresh, first, LATER), []);
});

test('a figure cut to its limit never ends on half an emoji', () => {
  const long = `${'a'.repeat(59)}😀`;
  const ops = [
    {
      op: 'update_object',
      id: TRIP_ID,
      patch: { data: { ...tripData, derived: { ...tripData.derived, totalDays: long } } },
      origin: 'derived',
    },
  ];
  const [figure] = figureChanges(before, ops, LATER);

  assert.equal(figure.label, 'total days');
  assert.equal(figure.after, 'a'.repeat(59));
  assert.doesNotMatch(figure.after, /[\uD800-\uDBFF]$/);
});

test('the payload carries only what the changeset has, within the limits', () => {
  const figure = { label: 'total days', before: '8', after: '9' };

  assert.deepEqual(changesetPayload(undefined, []), {});
  assert.deepEqual(changesetPayload('Set Kyoto to 3 days', [figure]), {
    label: 'Set Kyoto to 3 days',
    figures: [figure],
  });
  assert.equal(changesetPayload(`${'a'.repeat(199)}😀`, []).label, 'a'.repeat(199));
  assert.equal(
    changesetPayloadSchema.safeParse(changesetPayload('Set Kyoto to 3 days', [figure])).success,
    true,
  );
});

test('events from before labels, and Undo events, still parse with an empty payload', () => {
  assert.deepEqual(mapEventRow(eventRow).payload, {});
  assert.equal(changesetPayloadSchema.safeParse({}).success, true);
});
