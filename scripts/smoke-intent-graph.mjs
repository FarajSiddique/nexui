#!/usr/bin/env node
/**
 * Exercises the intent graph API end to end as the QA user: create a trip, shorten a stop,
 * check the derived insight, undo, redo, and read Changes. Needs the API running and a QA
 * session from `node scripts/qa-session.mjs > .qa/session.json`.
 *
 * node scripts/smoke-intent-graph.mjs [.qa/session.json] [http://localhost:3000]
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [sessionPath = '.qa/session.json', api = 'http://localhost:3000'] = process.argv.slice(2);
const { session } = JSON.parse(readFileSync(sessionPath, 'utf8'));
const headers = {
  Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json',
};

async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

const created = await call('POST', '/api/intents', { goal: 'Smoke test: a weekend in Chicago' });
const intentId = created.intent.id;
const tripId = created.workspace.doc.anchorId;
const trip = created.objects.find((o) => o.id === tripId);

console.log(
  `created ${intentId}: "${created.intent.summary.line}" ${created.intent.summary.badge?.text}`,
);
assert.ok(
  created.objects.some((o) => o.kind === 'decision'),
  'an open length decision',
);

// Give the trip dates and two places: 3 days, 2 + 1 allocated.
const loopId = randomUUID();
const hydeId = randomUUID();
const place = (id, name, lat, lng, days, position) => ({
  op: 'insert_object',
  id,
  kind: 'place',
  title: name,
  data: { name, country: 'US', placeType: 'area', lat, lng, days },
  position,
});
const link = (sourceId) => ({
  op: 'insert_relationship',
  id: randomUUID(),
  sourceType: 'object',
  sourceId,
  targetType: 'object',
  targetId: tripId,
  type: 'part_of',
});
const planned = await call('POST', `/api/intents/${intentId}/changesets`, {
  ops: [
    {
      op: 'update_object',
      id: tripId,
      patch: { data: { ...trip.data, startDate: '2026-10-17', endDate: '2026-10-20' } },
    },
    place(loopId, 'The Loop', 41.88, -87.63, 2, 1),
    link(loopId),
    place(hydeId, 'Hyde Park', 41.79, -87.59, 1, 2),
    link(hydeId),
  ],
});

console.log(
  `planned: "${planned.snapshot.intent.summary.line}" ${planned.snapshot.intent.summary.badge?.text}`,
);
assert.equal(planned.snapshot.intent.summary.badge?.text, 'Every day planned');

const loop = planned.snapshot.objects.find((o) => o.id === loopId);
const shortened = await call('POST', `/api/intents/${intentId}/changesets`, {
  ops: [
    {
      op: 'update_object',
      id: loopId,
      expectedUpdatedAt: loop.updatedAt,
      patch: { data: { ...loop.data, days: 1 } },
    },
  ],
});
const insight = shortened.snapshot.objects.find((o) => o.kind === 'insight');

console.log(`shortened: insight "${insight?.data.text}" / ${insight?.data.detail}`);
assert.equal(insight?.data.text, 'You have 1 day unallocated');

const undone = await call('POST', `/api/events/${shortened.event.id}/undo`);

assert.ok(!undone.snapshot.objects.some((o) => o.kind === 'insight'), 'undo removes the insight');
console.log('undone: insight gone');

const redone = await call('POST', `/api/events/${undone.event.id}/undo`);

assert.ok(
  redone.snapshot.objects.some((o) => o.kind === 'insight'),
  'redo brings it back',
);
console.log('redone: insight back');

const changes = await call('GET', `/api/changes?intentId=${intentId}`);

console.log(`changes: ${changes.items.length} events, newest ${changes.items[0]?.actor}`);
assert.equal(changes.items.length, 5);
assert.equal(changes.items[1].revertedByEventId, redone.event.id);
console.log('smoke test passed');
