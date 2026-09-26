// Contract for anchored-shell.md, Slice A "API for slice A" and "Contracts summary":
// `@nexui/types` exports `tasksResponseSchema` (`{ items: SavedTask[] }`, the body of
// `GET /api/tasks`), and `timelineQuerySchema` gains an optional `kind` (task | event | note)
// with no default.
import assert from 'node:assert/strict';
import test from 'node:test';

import { tasksResponseSchema, timelineQuerySchema } from '../packages/types/src/index.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

test('the tasks response holds saved tasks only', () => {
  assert.deepEqual(tasksResponseSchema.parse({ items: [savedTask] }), { items: [savedTask] });
  assert.deepEqual(tasksResponseSchema.parse({ items: [] }), { items: [] });
  assert.equal(tasksResponseSchema.safeParse({ items: [savedEvent] }).success, false);
  assert.equal(tasksResponseSchema.safeParse({ items: [savedNote] }).success, false);
  assert.equal(tasksResponseSchema.safeParse({}).success, false);
});

test('the timeline query accepts an optional kind', () => {
  assert.deepEqual(timelineQuerySchema.parse({}), { limit: 50 });
  for (const kind of ['task', 'event', 'note']) {
    assert.deepEqual(timelineQuerySchema.parse({ kind }), { limit: 50, kind });
  }
  assert.deepEqual(timelineQuerySchema.parse({ kind: 'note', limit: '20', cursor: 'abc' }), {
    kind: 'note',
    limit: 20,
    cursor: 'abc',
  });
});

test('the timeline query rejects an unknown kind', () => {
  assert.equal(timelineQuerySchema.safeParse({ kind: 'reminder' }).success, false);
  assert.equal(timelineQuerySchema.safeParse({ kind: '' }).success, false);
  assert.equal(timelineQuerySchema.safeParse({ kind: 'Note' }).success, false);
});
