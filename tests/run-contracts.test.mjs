import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askRequestSchema,
  capabilityRequestSchema,
  createIntentResponseSchema,
  runProgressEntrySchema,
  runRecordSchema,
} from '../packages/types/src/index.ts';

const RUN_ID = 'c0000000-0000-4000-8000-000000000001';
const INTENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const STAMP = '2026-09-29T10:00:00.123456+00:00';

const entry = {
  step: 0,
  capability: 'object.create',
  label: 'Added Kyoto',
  ok: true,
  ms: 3,
  input: { ref: 'kyoto', kind: 'place', data: { name: 'Kyoto' } },
};

test('a run record parses with its progress and usage', () => {
  const run = runRecordSchema.parse({
    id: RUN_ID,
    intentId: INTENT_ID,
    kind: 'create_intent',
    status: 'running',
    input: {
      text: 'Plan Japan in December',
      route: 'reasoning',
      template: 'travel',
      perception: 'model',
    },
    progress: [entry, { ...entry, ok: false, error: 'The ref "kyoto" is already used.' }],
    error: null,
    modelUsage: { inputTokens: 1200, outputTokens: 300, model: 'anthropic/claude-sonnet-5.5' },
    startedAt: STAMP,
    finishedAt: null,
    createdAt: STAMP,
  });

  assert.equal(run.progress.length, 2);
  assert.deepEqual(run.modelUsage, {
    inputTokens: 1200,
    outputTokens: 300,
    model: 'anthropic/claude-sonnet-5.5',
  });
});

test('a fresh run has empty usage', () => {
  const run = runRecordSchema.parse({
    id: RUN_ID,
    intentId: INTENT_ID,
    kind: 'ask',
    status: 'queued',
    input: { text: 'Make Kyoto 3 days', route: 'edit', perception: 'fallback' },
    progress: [],
    error: null,
    modelUsage: {},
    startedAt: null,
    finishedAt: null,
    createdAt: STAMP,
  });

  assert.deepEqual(run.modelUsage, {});
});

test('progress entries name a capability and keep input as JSON or null', () => {
  assert.equal(runProgressEntrySchema.safeParse({ ...entry, capability: 'rm -rf' }).success, false);
  assert.equal(runProgressEntrySchema.safeParse({ ...entry, input: null }).success, true);
  assert.equal(runProgressEntrySchema.safeParse({ ...entry, ms: -1 }).success, false);
});

test('an ask is trimmed and bounded', () => {
  assert.deepEqual(askRequestSchema.parse({ text: '  Make Kyoto 3 days ' }), {
    text: 'Make Kyoto 3 days',
  });
  assert.equal(askRequestSchema.safeParse({ text: ' a ' }).success, false);
  assert.equal(askRequestSchema.safeParse({ text: 'x'.repeat(1001) }).success, false);
});

test('a capability request names a capability and keeps its input small', () => {
  assert.equal(
    capabilityRequestSchema.safeParse({
      name: 'trip.setPlaceDays',
      input: { placeId: INTENT_ID, days: 4 },
    }).success,
    true,
  );
  assert.equal(capabilityRequestSchema.safeParse({ name: 'trip', input: {} }).success, false);
  assert.equal(
    capabilityRequestSchema.safeParse({
      name: 'trip.setPlaceDays',
      input: { note: 'x'.repeat(2_100) },
    }).success,
    false,
  );
});

test('creating an intent may start no run', () => {
  const snapshot = {
    intent: {
      id: INTENT_ID,
      goal: 'Find a new job',
      template: null,
      status: 'exploring',
      context: {},
      summary: { line: 'Nexui can plan trips so far.' },
      createdAt: STAMP,
      updatedAt: STAMP,
      lastActivityAt: STAMP,
    },
    workspace: null,
    objects: [],
    relationships: [],
  };

  assert.equal(createIntentResponseSchema.parse({ snapshot, runId: null }).runId, null);
});
