import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { daysAction, moveAction } from '../apps/mobile/src/features/travel/trip-actions.ts';
import {
  fromInsightAction,
  resolveAction,
} from '../apps/mobile/src/features/workspace/workspace-actions.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import { KYOTO_ID, snapshotRow, STAMP, TOKYO_ID, TRIP_ID } from './support/graph.mjs';

const snapshot = () => mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const placeOf = (graph, id) => graph.objects.find((object) => object.id === id);
const run = (graph, action) => applyOps(graph, action.optimistic, STAMP);

test('a day change is trip.setPlaceDays with the absolute value, shown at once', () => {
  const graph = snapshot();
  const action = daysAction(placeOf(graph, TOKYO_ID), 3);

  assert.equal(action.type, 'capability');
  assert.deepEqual(action.request, {
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 3 },
  });
  assert.equal(placeOf(run(graph, action), TOKYO_ID).data.days, 3);
});

test('a day change to the current value, or out of range, sends nothing', () => {
  const tokyo = placeOf(snapshot(), TOKYO_ID);

  assert.equal(daysAction(tokyo, 4), null);
  assert.equal(daysAction(tokyo, -1), null);
  assert.equal(daysAction(tokyo, 366), null);
  assert.equal(daysAction(tokyo, 2.5), null);
});

test('three quick taps stack: each call is absolute and the shown days keep up', () => {
  let graph = snapshot();
  const sent = [];

  for (const days of [3, 2, 1]) {
    const action = daysAction(placeOf(graph, TOKYO_ID), days);

    sent.push(action.request.input.days);
    graph = run(graph, action);
  }

  assert.deepEqual(sent, [3, 2, 1]);
  assert.equal(placeOf(graph, TOKYO_ID).data.days, 1);
});

test('moving a stop reorders the whole route; the ends cannot move past the edge', () => {
  const graph = snapshot();
  const down = moveAction(graph, TOKYO_ID, 1);

  assert.deepEqual(down.request, {
    name: 'trip.reorderPlaces',
    input: { placeIds: [KYOTO_ID, TOKYO_ID] },
  });

  const moved = run(graph, down);

  assert.deepEqual([placeOf(moved, TOKYO_ID).position, placeOf(moved, KYOTO_ID).position], [2, 1]);
  assert.equal(moveAction(graph, TOKYO_ID, -1), null);
  assert.equal(moveAction(graph, KYOTO_ID, 1), null);
});

test('decisions and insight buttons go to the server as they are, with nothing shown early', () => {
  assert.deepEqual(resolveAction('d1', 'o1'), {
    type: 'capability',
    request: { name: 'decision.resolve', input: { decisionId: 'd1', optionId: 'o1' } },
    optimistic: [],
  });
  assert.deepEqual(resolveAction('d1', null).request.input, { decisionId: 'd1' });
  assert.deepEqual(
    fromInsightAction({
      type: 'capability',
      label: 'Heard back',
      name: 'jobs.logContact',
      input: { objectId: 'r1', direction: 'received' },
    }),
    {
      type: 'capability',
      request: { name: 'jobs.logContact', input: { objectId: 'r1', direction: 'received' } },
      optimistic: [],
    },
  );
  assert.deepEqual(fromInsightAction({ type: 'ask', label: 'Prep me', prompt: 'Prep me' }), {
    type: 'ask',
    prompt: 'Prep me',
  });
  assert.deepEqual(fromInsightAction({ type: 'start', label: 'Start without' }), {
    type: 'start',
  });
  assert.deepEqual(fromInsightAction({ type: 'upload', label: 'Add resume', docType: 'resume' }), {
    type: 'upload',
    docType: 'resume',
  });
  assert.deepEqual(
    fromInsightAction({ type: 'copy', label: 'Copy address', text: 'me@in.nexui.app' }),
    { type: 'copy', text: 'me@in.nexui.app' },
  );
});
