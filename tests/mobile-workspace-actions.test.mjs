import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { anchorFigures } from '../packages/types/src/index.ts';
import {
  capabilityFor,
  daysAction,
  optimisticOps,
} from '../apps/mobile/src/features/workspace/workspace-actions.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import { KYOTO_ID, snapshotRow, STAMP, TOKYO_ID, TRIP_ID } from './support/graph.mjs';

const snapshot = () => mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const days = (graph, id) => graph.objects.find((object) => object.id === id).data.days;
const run = (graph, action) => applyOps(graph, optimisticOps(action, graph), STAMP);

test('a day change is trip.setPlaceDays with the absolute value', () => {
  const graph = snapshot();
  const action = { type: 'setDays', placeId: TOKYO_ID, days: 3 };

  assert.deepEqual(capabilityFor(action, graph), {
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 3 },
  });
  assert.equal(days(run(graph, action), TOKYO_ID), 3);
});

test('a day change to the current value, or out of range, sends nothing', () => {
  const graph = snapshot();

  assert.equal(capabilityFor({ type: 'setDays', placeId: TOKYO_ID, days: 4 }, graph), null);
  assert.equal(capabilityFor({ type: 'setDays', placeId: TOKYO_ID, days: -1 }, graph), null);
  assert.equal(capabilityFor({ type: 'setDays', placeId: TOKYO_ID, days: 366 }, graph), null);
  assert.deepEqual(optimisticOps({ type: 'setDays', placeId: TOKYO_ID, days: -1 }, graph), []);
});

test('three quick taps stack: each call is absolute and the shown days keep up', () => {
  let graph = snapshot();
  const requests = [];

  for (let tap = 0; tap < 3; tap += 1) {
    const action = { type: 'setDays', placeId: TOKYO_ID, days: days(graph, TOKYO_ID) + 1 };

    requests.push(capabilityFor(action, graph).input.days);
    graph = run(graph, action);
  }

  assert.deepEqual(requests, [5, 6, 7]);
  assert.equal(days(graph, TOKYO_ID), 7);
  assert.equal(anchorFigures(graph).values.unallocatedDays, -3);
});

test('moving a stop reorders the whole route; the ends cannot move past the edge', () => {
  const graph = snapshot();
  const up = { type: 'move', placeId: KYOTO_ID, by: -1 };

  assert.deepEqual(capabilityFor(up, graph), {
    name: 'trip.reorderPlaces',
    input: { placeIds: [KYOTO_ID, TOKYO_ID] },
  });

  const moved = run(graph, up);

  assert.deepEqual(
    [KYOTO_ID, TOKYO_ID].map((id) => moved.objects.find((object) => object.id === id).position),
    [1, 2],
  );
  assert.equal(capabilityFor({ type: 'move', placeId: TOKYO_ID, by: -1 }, graph), null);
  assert.equal(capabilityFor({ type: 'move', placeId: KYOTO_ID, by: 1 }, graph), null);
});

test('decisions and insight buttons go to the server as they are, with nothing optimistic', () => {
  const graph = snapshot();
  const dismiss = { type: 'resolveDecision', decisionId: TRIP_ID, optionId: null };
  const button = {
    type: 'capability',
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 5 },
  };

  assert.deepEqual(capabilityFor(dismiss, graph), {
    name: 'decision.resolve',
    input: { decisionId: TRIP_ID },
  });
  assert.deepEqual(capabilityFor({ ...dismiss, optionId: KYOTO_ID }, graph).input, {
    decisionId: TRIP_ID,
    optionId: KYOTO_ID,
  });
  assert.deepEqual(capabilityFor(button, graph), { name: button.name, input: button.input });
  assert.deepEqual(optimisticOps(dismiss, graph), []);
  assert.deepEqual(optimisticOps(button, graph), []);
});

test('a stepper tap is a setDays action only when the value is new and in range', () => {
  const tokyo = snapshot().objects.find((object) => object.id === TOKYO_ID);

  assert.deepEqual(daysAction(tokyo, 5), { type: 'setDays', placeId: TOKYO_ID, days: 5 });
  assert.equal(daysAction(tokyo, 4), null);
  assert.equal(daysAction(tokyo, -1), null);
  assert.equal(daysAction(tokyo, 366), null);
  assert.equal(daysAction(tokyo, 2.5), null);
});
