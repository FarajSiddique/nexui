import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChangeRows,
  filterRows,
  groupByDay,
} from '../apps/mobile/src/features/changes/change-feed.ts';

const event = (id, actor, payload = {}, extra = {}) => ({
  id,
  intentId: 'a1b2c3d4-0000-4000-8000-000000000001',
  seq: 1,
  type: 'changeset',
  actor,
  runId: null,
  revertsEventId: null,
  revertedByEventId: null,
  ops: [],
  payload,
  intentGoal: 'Japan in December',
  createdAt: '2026-09-30T10:00:00Z',
  ...extra,
});
const op = (name, id, origin = 'direct') => ({
  op: name,
  table: 'objects',
  id,
  before: {},
  after: {},
  origin,
});
const shortenTokyo = (extra = {}) =>
  event(
    'e1',
    'user',
    {
      label: 'Set Tokyo to 3 days',
      figures: [{ label: 'unallocated days', before: '0', after: '1' }],
    },
    extra,
  );

test('a change reads as its label, with each figure it moved tied to it', () => {
  const rows = buildChangeRows([shortenTokyo()]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text, row.diff, row.revert, row.undone]),
    [
      ['You', 'Set Tokyo to 3 days', null, { label: 'Undo', eventId: 'e1' }, false],
      ['Auto-calculated', 'Unallocated days', { before: '0', after: '1' }, null, false],
    ],
  );
  assert.equal(rows[1].actor, 'derived');
});

test('an undone change is struck through and offers Redo on its Undo event', () => {
  const undo = event('u1', 'user', {}, { revertsEventId: 'e1' });
  const rows = buildChangeRows([undo, shortenTokyo({ revertedByEventId: 'u1' })]);

  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].undone, rows[0].revert], [true, { label: 'Redo', eventId: 'u1' }]);
  assert.equal(rows[1].undone, true);
});

test('after Undo then Redo the change is live again and Undo targets the Redo', () => {
  const redo = event('r1', 'user', {}, { revertsEventId: 'u1' });
  const undo = event('u1', 'user', {}, { revertsEventId: 'e1', revertedByEventId: 'r1' });
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

test("a job search's changes read as their labels, never as their kinds", () => {
  const rows = buildChangeRows([
    event('e2', 'user', {
      label: 'Moved Staff PM, Payments to Interested',
      figures: [
        { label: 'new roles', before: '3', after: '2' },
        { label: 'roles in play', before: '1', after: '2' },
      ],
    }),
    event('e3', 'ai', { label: 'Found 2 new roles' }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text]),
    [
      ['You', 'Moved Staff PM, Payments to Interested'],
      ['Auto-calculated', 'New roles'],
      ['Auto-calculated', 'Roles in play'],
      ['Nexui', 'Found 2 new roles'],
    ],
  );
});

test('a change with no label reads plainly, and the first event names the plan', () => {
  const rows = buildChangeRows([
    event('e4', 'system'),
    event('e5', 'user', {}, { ops: [op('update_object', 'o1'), op('update_object', 'o2')] }),
    event('e6', 'ai', { figures: [{ label: 'total days', before: null, after: '8' }] }),
    event('e7', 'user', { label: 42 }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text, row.diff, row.revert?.label ?? null]),
    [
      ['You', 'Started “Japan in December”', null, null],
      ['You', 'Made 2 changes', null, 'Undo'],
      ['Nexui', 'Made a change', null, 'Undo'],
      ['Auto-calculated', 'Total days', { before: '—', after: '8' }, null],
      ['You', 'Made a change', null, 'Undo'],
    ],
  );
});

test('filters keep one actor, and Auto-calculated keeps only derived rows', () => {
  const rows = buildChangeRows([shortenTokyo(), event('e8', 'ai', { label: 'Added Kyoto' })]);

  assert.deepEqual(
    filterRows(rows, 'you').map((row) => row.key),
    ['e1'],
  );
  assert.deepEqual(
    filterRows(rows, 'nexui').map((row) => row.key),
    ['e8'],
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
    event('a', 'ai', { label: 'Added Kyoto' }, { createdAt: at(new Date(2026, 8, 30, 9)) }),
    event('b', 'ai', { label: 'Added Tokyo' }, { createdAt: at(new Date(2026, 8, 29, 20)) }),
  ]);

  assert.deepEqual(
    groupByDay(rows, now).map((group) => [group.label, group.rows.map((row) => row.key)]),
    [
      ['Today', ['a']],
      ['Yesterday', ['b']],
    ],
  );
});
