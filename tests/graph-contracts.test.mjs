import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changesetRequestSchema,
  fromUserOps,
  graphQuerySchema,
  insightDataSchema,
  intentListItemSchema,
  intentSummarySchema,
  optionDataSchema,
  parseKindData,
  placeDataSchema,
  tripDataSchema,
  userOpSchema,
  workspaceDocSchema,
} from '../packages/types/src/index.ts';
import { intentRow, kyotoData, TOKYO_ID, tokyoData, TRIP_ID, tripData } from './support/graph.mjs';

test('the fixture trip and places are valid kind data', () => {
  assert.deepEqual(tripDataSchema.parse(tripData), tripData);
  assert.deepEqual(placeDataSchema.parse(tokyoData), tokyoData);
  assert.deepEqual(placeDataSchema.parse(kyotoData), kyotoData);
});

test('place days must be a whole number from 0 to 365', () => {
  for (const days of [-1, 2.5, 366]) {
    assert.equal(placeDataSchema.safeParse({ ...tokyoData, days }).success, false, `days ${days}`);
  }
});

test('a trip needs both dates or neither, and must end after it starts', () => {
  assert.equal(tripDataSchema.safeParse({ ...tripData, endDate: undefined }).success, false);
  assert.equal(tripDataSchema.safeParse({ ...tripData, endDate: '2026-12-12' }).success, false);
  assert.equal(
    tripDataSchema.safeParse({ destinations: [], currency: 'USD' }).success,
    true,
    'an empty new trip is valid',
  );
});

test('parseKindData rejects unknown kinds and names the bad field', () => {
  assert.deepEqual(parseKindData('spaceship', {}), {
    ok: false,
    message: 'Unknown kind "spaceship".',
  });

  const bad = parseKindData('place', { ...tokyoData, days: -1 });

  assert.equal(bad.ok, false);
  assert.match(bad.message, /^Invalid place: days /);
  assert.deepEqual(parseKindData('place', tokyoData), { ok: true, data: tokyoData, version: 1 });
});

test('insights allow at most two actions of the known types', () => {
  const base = { text: 'You have 1 day unallocated', severity: 'attention', actions: [] };
  const ask = { type: 'ask', label: 'Ask Nexui for ideas', prompt: 'Ideas?' };
  const give = {
    type: 'capability',
    label: 'Give it back to Tokyo',
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 4 },
  };

  assert.equal(insightDataSchema.safeParse({ ...base, actions: [ask, give] }).success, true);
  assert.equal(insightDataSchema.safeParse({ ...base, actions: [ask, give, ask] }).success, false);
  assert.equal(
    insightDataSchema.safeParse({ ...base, actions: [{ ...give, name: 'rm -rf' }] }).success,
    false,
  );
});

test('free-form JSON fields are capped in size', () => {
  const link = {
    op: 'insert_relationship',
    id: TOKYO_ID,
    sourceType: 'object',
    sourceId: TOKYO_ID,
    targetType: 'object',
    targetId: TRIP_ID,
    type: 'near',
  };
  const small = { note: 'x'.repeat(1_900) };
  const large = { note: 'x'.repeat(2_000) };
  const give = { type: 'capability', label: 'Give back', name: 'trip.setPlaceDays' };
  const insight = { text: 'You have 1 day unallocated', severity: 'attention' };

  assert.equal(userOpSchema.safeParse({ ...link, metadata: small }).success, true);
  assert.equal(userOpSchema.safeParse({ ...link, metadata: large }).success, false);
  assert.equal(userOpSchema.safeParse({ ...link, metadata: null }).success, true);
  assert.equal(
    insightDataSchema.safeParse({ ...insight, actions: [{ ...give, input: small }] }).success,
    true,
  );
  assert.equal(
    insightDataSchema.safeParse({ ...insight, actions: [{ ...give, input: large }] }).success,
    false,
  );
});

test('an option carries at most 12 metrics', () => {
  const option = { label: 'Ryokan', summary: 'Quiet', pros: [], cons: [] };
  const metrics = (count) =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`m${index}`, index]));

  assert.equal(optionDataSchema.safeParse({ ...option, metrics: metrics(12) }).success, true);
  assert.equal(optionDataSchema.safeParse({ ...option, metrics: metrics(13) }).success, false);
});

test('graph queries accept registered kinds and data paths only', () => {
  const query = {
    from: 'objects',
    kind: 'place',
    related: { type: 'part_of', to: { objectId: TRIP_ID }, direction: 'out' },
    where: [{ field: 'data.days', op: 'gt', value: 0 }],
    sort: 'position',
  };

  assert.deepEqual(graphQuerySchema.parse(query), query);
  assert.equal(graphQuerySchema.safeParse({ ...query, kind: 'spaceship' }).success, false);
  assert.equal(
    graphQuerySchema.safeParse({ ...query, where: [{ field: 'user_id', op: 'eq', value: 1 }] })
      .success,
    false,
  );
});

test('workspace docs need unique section ids', () => {
  const section = {
    id: 'route',
    type: 'objectList',
    query: { from: 'object', id: TRIP_ID },
    card: 'compact',
  };
  const doc = { version: 1, anchorId: TRIP_ID, sections: [section] };

  assert.equal(workspaceDocSchema.safeParse(doc).success, true);
  assert.equal(
    workspaceDocSchema.safeParse({ ...doc, sections: [section, section] }).success,
    false,
  );
});

test('user ops cannot carry server-owned fields', () => {
  const update = { op: 'update_object', id: TOKYO_ID, patch: { data: { ...tokyoData, days: 3 } } };

  assert.equal(userOpSchema.safeParse(update).success, true);
  assert.equal(userOpSchema.safeParse({ ...update, origin: 'derived' }).success, false);
  assert.equal(
    userOpSchema.safeParse({ ...update, patch: { source: { type: 'ai' } } }).success,
    false,
  );
  assert.equal(
    userOpSchema.safeParse({ op: 'update_intent', patch: { status: 'active' } }).success,
    false,
  );
  assert.equal(userOpSchema.safeParse({ op: 'set_workspace', doc: {} }).success, false);
  assert.equal(changesetRequestSchema.safeParse({ ops: [] }).success, false);
});

test('fromUserOps marks ops direct and user-sourced with the kind version', () => {
  const insert = {
    op: 'insert_object',
    id: TOKYO_ID,
    kind: 'place',
    title: 'Tokyo',
    data: tokyoData,
  };

  assert.deepEqual(fromUserOps([insert]), [
    {
      op: 'insert_object',
      id: TOKYO_ID,
      kind: 'place',
      kindVersion: 1,
      title: 'Tokyo',
      status: null,
      data: tokyoData,
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
  ]);
  assert.deepEqual(fromUserOps([{ op: 'delete_object', id: TOKYO_ID }]), [
    { op: 'delete_object', id: TOKYO_ID, origin: 'direct' },
  ]);
});

test('a Home strip stop may carry its media key; a list item carries up to three bucket photos', () => {
  const summary = (strip) => intentSummarySchema.safeParse({ line: 'x', strip });
  const item = (photos) =>
    intentListItemSchema.safeParse({
      id: intentRow.id,
      goal: intentRow.goal,
      template: 'travel',
      status: 'exploring',
      summary: { line: 'x' },
      lastActivityAt: intentRow.last_activity_at,
      photos,
    });
  const photo = 'https://x.supabase.co/storage/v1/object/public/place-photos/a/b-500.jpg';

  assert.equal(summary([{ label: 'Tokyo', ai: false, key: 'tokyo|JP|35.7|139.7' }]).success, true);
  assert.equal(summary([{ label: 'Tokyo', ai: false }]).success, true);
  assert.equal(summary([{ label: 'Tokyo', ai: false, key: 'x'.repeat(201) }]).success, false);
  assert.equal(item([photo]).success, true);
  assert.equal(item([]).success, true);
  assert.equal(item(undefined).success, false);
  assert.equal(item(['https://upload.wikimedia.org/x.jpg']).success, false);
  assert.equal(item([photo, photo, photo, photo]).success, false);
});
