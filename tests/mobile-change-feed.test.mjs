import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChangeRows,
  filterRows,
  groupByDay,
} from '../apps/mobile/src/features/changes/change-feed.ts';

const TOKYO = 'a1b2c3d4-0000-4000-8000-000000000003';
const KYOTO = 'a1b2c3d4-0000-4000-8000-000000000004';
const TRIP = 'a1b2c3d4-0000-4000-8000-000000000002';

const event = (id, actor, ops, extra = {}) => ({
  id,
  intentId: 'a1b2c3d4-0000-4000-8000-000000000001',
  seq: 1,
  type: 'changeset',
  actor,
  runId: null,
  revertsEventId: null,
  revertedByEventId: null,
  ops,
  payload: {},
  intentGoal: 'Japan in December',
  createdAt: '2026-09-30T10:00:00Z',
  ...extra,
});
const op = (name, id, before, after, origin = 'direct', table = 'objects') => ({
  op: name,
  table,
  id,
  before,
  after,
  origin,
});
const place = (name, days, extra = {}) => ({
  kind: 'place',
  title: name,
  position: 1,
  data: { name, days },
  ...extra,
});
const trip = (unallocatedDays) => ({
  kind: 'trip',
  title: 'Japan',
  data: { derived: { totalDays: 8, allocatedDays: 8 - unallocatedDays, unallocatedDays } },
});
const shortenTokyo = (extra = {}) =>
  event(
    'e1',
    'user',
    [
      op('update_object', TOKYO, place('Tokyo', 4), place('Tokyo', 3)),
      op('update_object', TRIP, trip(0), trip(1), 'derived'),
    ],
    extra,
  );

test('a day edit reads as a before → after, with its derived figure tied to it', () => {
  const rows = buildChangeRows([shortenTokyo()]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text, row.diff, row.revert, row.undone]),
    [
      [
        'You',
        'set Tokyo to',
        { before: '4', after: '3', unit: 'days' },
        { label: 'Undo', eventId: 'e1' },
        false,
      ],
      ['Auto-calculated', 'unallocated days', { before: '0', after: '1', unit: '' }, null, false],
    ],
  );
  assert.equal(rows[1].actor, 'derived');
});

test('an undone change is struck through and offers Redo on its Undo event', () => {
  const undo = event('u1', 'user', [], { revertsEventId: 'e1' });
  const rows = buildChangeRows([undo, shortenTokyo({ revertedByEventId: 'u1' })]);

  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].undone, rows[0].revert], [true, { label: 'Redo', eventId: 'u1' }]);
  assert.equal(rows[1].undone, true);
});

test('after Undo then Redo the change is live again and Undo targets the Redo', () => {
  const redo = event('r1', 'user', [], { revertsEventId: 'u1' });
  const undo = event('u1', 'user', [], { revertsEventId: 'e1', revertedByEventId: 'r1' });
  const rows = buildChangeRows([redo, undo, shortenTokyo({ revertedByEventId: 'u1' })]);

  assert.deepEqual(
    [rows[0].eventId, rows[0].undone, rows[0].revert],
    ['e1', false, { label: 'Undo', eventId: 'r1' }],
  );
});

test('an undone change whose Undo is on a later page still offers Redo', () => {
  const rows = buildChangeRows([shortenTokyo({ revertedByEventId: 'u-elsewhere' })]);

  assert.deepEqual(rows[0].revert, { label: 'Redo', eventId: 'u-elsewhere' });
});

test('Nexui proposing a decision names the question and its options', () => {
  const decision = {
    kind: 'decision',
    title: 'Where?',
    data: { question: 'Where should the free day go?', status: 'open' },
  };
  const option = (label) => ({ kind: 'option', title: label, data: { label } });
  const rows = buildChangeRows([
    event('e2', 'ai', [
      op('insert_object', 'd1', null, decision),
      op('insert_object', 'o1', null, option('Nara')),
      op('insert_object', 'o2', null, option('Kobe')),
      op('insert_object', 'o3', null, option('Uji')),
      op('set_workspace', 'w1', {}, {}, 'direct', 'workspaces'),
    ]),
  ]);

  assert.deepEqual(
    [rows[0].who, rows[0].text],
    ['Nexui', 'proposed 3 options for “Where should the free day go?”'],
  );
});

test('other changes get plain sentences', () => {
  const [created, added, reordered, settled] = buildChangeRows([
    event('e3', 'system', [op('insert_object', TRIP, null, trip(0))]),
    event('e4', 'ai', [
      op('insert_object', TOKYO, null, place('Tokyo', 4)),
      op('insert_object', KYOTO, null, place('Kyoto', 3)),
      op('insert_object', 'leg', null, { kind: 'leg', title: 'Tokyo → Kyoto', data: {} }),
    ]),
    event('e5', 'user', [
      op('update_object', TOKYO, place('Tokyo', 4), place('Tokyo', 4, { position: 2 })),
      op('update_object', KYOTO, place('Kyoto', 3, { position: 2 }), place('Kyoto', 3)),
    ]),
    event('e6', 'user', [
      op(
        'update_object',
        'd1',
        { kind: 'decision', data: { question: 'Where?', status: 'open' } },
        { kind: 'decision', data: { question: 'Where?', status: 'dismissed' } },
      ),
    ]),
  ]);

  assert.deepEqual(
    [created.who, created.text, created.revert],
    ['You', 'started “Japan in December”', null],
  );
  assert.equal(added.text, 'added 2 places');
  assert.equal(reordered.text, 'reordered the route');
  assert.equal(settled.text, 'dismissed “Where?”');
});

test('filters keep one actor, and Auto-calculated keeps only derived rows', () => {
  const rows = buildChangeRows([
    shortenTokyo(),
    event('e7', 'ai', [op('insert_object', KYOTO, null, place('Kyoto', 3))]),
  ]);

  assert.deepEqual(
    filterRows(rows, 'you').map((row) => row.key),
    ['e1'],
  );
  assert.deepEqual(
    filterRows(rows, 'nexui').map((row) => row.key),
    ['e7'],
  );
  assert.deepEqual(
    filterRows(rows, 'auto').map((row) => row.key),
    ['e1:0'],
  );
  assert.equal(filterRows(rows, 'all').length, 3);
});

test('rows group under Today and Yesterday in order', () => {
  const now = new Date(2026, 8, 30, 12);
  const at = (date) => date.toISOString();
  const rows = buildChangeRows([
    event('a', 'ai', [op('insert_object', KYOTO, null, place('Kyoto', 3))], {
      createdAt: at(new Date(2026, 8, 30, 9)),
    }),
    event('b', 'ai', [op('insert_object', TOKYO, null, place('Tokyo', 4))], {
      createdAt: at(new Date(2026, 8, 29, 20)),
    }),
  ]);

  assert.deepEqual(
    groupByDay(rows, now).map((group) => [group.label, group.rows.map((row) => row.key)]),
    [
      ['Today', ['a']],
      ['Yesterday', ['b']],
    ],
  );
});
