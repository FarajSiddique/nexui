import assert from 'node:assert/strict';
import test from 'node:test';

import { seedTravelOps, travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { workspaceDocSchema } from '../packages/types/src/index.ts';
import { idSequence } from './support/graph.mjs';

test('the travel workspace is a valid doc in the design order', () => {
  const tripId = 'b0000000-0000-4000-8000-000000000001';
  const doc = travelWorkspace(tripId);

  assert.deepEqual(workspaceDocSchema.parse(doc), doc);
  assert.equal(doc.anchorId, tripId);
  assert.deepEqual(
    doc.sections.map((s) => `${s.id}:${s.type}${s.pin ? ':open' : ''}`),
    ['map:map', 'metrics:metric', 'days:allocation', 'insights:insight:open', 'route:route'],
  );
  assert.deepEqual(
    doc.sections[1].metrics.map((m) => m.derived),
    ['trip.totalDays', 'trip.unallocatedDays', 'trip.estCost'],
  );
  assert.equal(doc.sections[1].metrics[1].emphasis, 'whenPositive');
});

test('the seed creates an empty trip from the goal and its workspace', () => {
  const ops = seedTravelOps('  Plan a weekend in Chicago  ', idSequence());

  assert.deepEqual(ops[0], {
    op: 'insert_object',
    id: 'b0000000-0000-4000-8000-000000000001',
    kind: 'trip',
    kindVersion: 1,
    title: 'Plan a weekend in Chicago',
    status: null,
    data: { destinations: [], currency: 'USD' },
    source: { type: 'user' },
    position: null,
    origin: 'direct',
  });
  assert.equal(ops[1].op, 'set_workspace');
  assert.equal(ops[1].doc.anchorId, 'b0000000-0000-4000-8000-000000000001');
  assert.equal(ops.length, 2);
});
