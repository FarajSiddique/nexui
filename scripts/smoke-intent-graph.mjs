#!/usr/bin/env node
/**
 * Exercises the intent graph API end to end as the QA user: create a trip, shorten a stop,
 * check the derived insight, undo, redo, read Changes, then ask the insight's own question
 * (replaying `japan-ask-free-days`), pick an option and undo the pick. Needs the API running
 * and a QA session from `node scripts/qa-session.mjs > .qa/session.json`. Run the API with
 * AI_PROVIDER=mock: the goal matches no fixture, so its run changes nothing and the counts
 * below hold.
 *
 * node scripts/smoke-intent-graph.mjs [.qa/session.json] [http://localhost:3000]
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { qaApi, readSession } from './lib/qa-api.mjs';

const [sessionPath = '.qa/session.json', api = 'http://localhost:3000'] = process.argv.slice(2);
const { call, waitForRun } = qaApi(readSession(sessionPath), api);

const started = await call('POST', '/api/intents', { goal: 'Smoke test: three quiet days away' });

assert.equal(started.outcome, 'started', `the goal was ${started.outcome}`);

const { snapshot: created, runId } = started;
const createRun = await waitForRun(runId);

assert.equal(createRun.status, 'succeeded', `the create run ${createRun.status}`);
console.log(`create run ${runId}: ${createRun.status}`);
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

const asked = await call('POST', `/api/intents/${intentId}/ask`, {
  text: 'Smoke test: nothing to change',
});
const answered = await waitForRun(asked.runId);

console.log(`ask: routed to ${asked.route}, run ${answered.status}`);
assert.equal(answered.status, 'succeeded');

// The insight's own question replays japan-ask-free-days: a decision whose options carry places.
const beforeAsk = await call('GET', `/api/intents/${intentId}`);
const prompt = beforeAsk.objects
  .find((o) => o.kind === 'insight')
  ?.data.actions.find((action) => action.type === 'ask')?.prompt;

assert.ok(prompt, 'the unallocated insight offers an ask');

const proposed = await call('POST', `/api/intents/${intentId}/ask`, { text: prompt });
const proposeRun = await waitForRun(proposed.runId);

assert.equal(proposeRun.status, 'succeeded', `the propose run ${proposeRun.status}`);

const withDecision = await call('GET', `/api/intents/${intentId}`);
const decision = withDecision.objects.find(
  (o) => o.kind === 'decision' && o.data.status === 'open' && o.source?.runId === proposed.runId,
);

assert.ok(decision, 'the ask proposed a decision');
assert.equal(decision.data.asked, prompt);

const options = withDecision.relationships
  .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
  .map((edge) => withDecision.objects.find((o) => o.id === edge.sourceId));
const candidates = options.map((option) => option.data.placeId).filter(Boolean);
const chosen = options.find((option) => option.data.placeId);

assert.ok(candidates.length >= 2, 'at least two options carry a place');
console.log(`proposed: "${decision.data.question}" with ${options.length} options`);

const picked = await call('POST', `/api/intents/${intentId}/capabilities`, {
  name: 'decision.resolve',
  input: { decisionId: decision.id, optionId: chosen.id },
});
const pickedTrip = picked.snapshot.objects.find((o) => o.id === tripId);
const pickedPlace = picked.snapshot.objects.find((o) => o.id === chosen.data.placeId);

assert.equal(pickedTrip.data.derived.unallocatedDays, 0, 'the free day is used');
assert.equal(pickedPlace.data.days, 1);
assert.ok(
  picked.snapshot.relationships.some(
    (edge) => edge.type === 'leg_to' && edge.targetId === pickedPlace.id,
  ),
  'a leg reaches the chosen place',
);

for (const id of candidates.filter((id) => id !== chosen.data.placeId)) {
  assert.ok(!picked.snapshot.objects.some((o) => o.id === id), 'unpicked candidates are deleted');
}

console.log(`picked: ${chosen.title}, candidates cleaned up`);

const unpicked = await call('POST', `/api/events/${picked.event.id}/undo`);

for (const id of candidates) {
  assert.ok(
    unpicked.snapshot.objects.some((o) => o.id === id),
    'undo restores every candidate',
  );
}

assert.equal(
  unpicked.snapshot.objects.find((o) => o.id === decision.id).data.status,
  'open',
  'undo reopens the decision',
);
console.log('undone: decision open again, candidates back');

// A goal no template fits is saved, and Home leaves it out (mock mode's `saved-goal` fixture).
const saved = await call('POST', '/api/intents', { goal: 'Smoke test: plan my wedding next June' });

assert.deepEqual(saved, { outcome: 'unsupported' });

const home = await call('GET', '/api/intents');

assert.ok(
  home.items.every((item) => item.template !== null),
  'Home lists only plans',
);
console.log('saved goal: unsupported, not on Home');

const cancelled = await call('POST', `/api/runs/${asked.runId}/cancel`);

assert.equal(cancelled.status, 'succeeded', 'cancelling a finished run changes nothing');
console.log('smoke test passed');
