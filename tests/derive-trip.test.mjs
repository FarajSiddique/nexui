// Spec H step 4: shortening a stop frees a day, and code (no model) records it, surfaces an
// insight with its two actions, and updates the Home summary.
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { deriveTrip, findShortenedPlace } from '../apps/api/src/lib/travel/derive.ts';
import { formatDateRange } from '../packages/types/src/kinds/travel/figures.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { applyOps } from '../packages/types/src/index.ts';
import {
  idSequence,
  LATER,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripData,
  tripRow,
  tokyoRow,
  kyotoRow,
} from './support/graph.mjs';

const before = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const shorten = [
  {
    op: 'update_object',
    id: TOKYO_ID,
    patch: { data: { ...tokyoData, days: 3 } },
    origin: 'direct',
  },
];

test('a trip whose figures and summary are current derives nothing', () => {
  assert.deepEqual(deriveTrip(before, TRIP_ID, null, idSequence()), []);
});

test('formatDateRange shortens same-month ranges', () => {
  assert.equal(formatDateRange('2026-12-12', '2026-12-20'), 'Dec 12 – 20');
  assert.equal(formatDateRange('2026-12-28', '2027-01-04'), 'Dec 28 – Jan 4');
});

test('findShortenedPlace spots a place losing days', () => {
  assert.deepEqual(findShortenedPlace(before, shorten), {
    placeId: TOKYO_ID,
    name: 'Tokyo',
    previousDays: 4,
    days: 3,
  });
  assert.equal(findShortenedPlace(before, []), null);
});

test('shortening Tokyo frees a day: figures, insight with actions, and summary', () => {
  const staged = applyOps(before, shorten, LATER);
  const ops = deriveTrip(staged, TRIP_ID, findShortenedPlace(before, shorten), idSequence());
  const insightId = 'b0000000-0000-4000-8000-000000000001';

  assert.deepEqual(ops, [
    {
      op: 'update_object',
      id: TRIP_ID,
      patch: {
        data: {
          ...tripData,
          derived: {
            totalDays: 8,
            allocatedDays: 7,
            unallocatedDays: 1,
            estCost: null,
            costIncomplete: false,
          },
        },
      },
      origin: 'derived',
    },
    {
      op: 'insert_object',
      id: insightId,
      kind: 'insight',
      kindVersion: 1,
      title: 'You have 1 day unallocated',
      status: null,
      data: {
        text: 'You have 1 day unallocated',
        detail: 'Tokyo went from 4 to 3 days.',
        severity: 'attention',
        derivedKey: 'trip.unallocatedDays',
        actions: [
          {
            type: 'ask',
            label: 'Ask Nexui for ideas',
            prompt: 'How should I use the 1 day I have free?',
          },
          {
            type: 'capability',
            label: 'Give it back to Tokyo',
            name: 'trip.setPlaceDays',
            input: { placeId: TOKYO_ID, days: 4 },
          },
        ],
      },
      source: { type: 'derived' },
      position: null,
      origin: 'derived',
    },
    {
      op: 'insert_relationship',
      id: 'b0000000-0000-4000-8000-000000000002',
      sourceType: 'object',
      sourceId: insightId,
      targetType: 'object',
      targetId: TRIP_ID,
      type: 'part_of',
      metadata: null,
      origin: 'derived',
    },
    {
      op: 'update_intent',
      patch: {
        summary: {
          line: 'Dec 12 – 20, 8 days, 2 stops',
          badge: { text: '1 day unallocated', tone: 'attention' },
          strip: [
            { label: 'Tokyo', ai: false, key: 'tokyo|JP|35.7|139.7' },
            { label: 'Kyoto', ai: false, key: 'kyoto|JP|35.0|135.8' },
          ],
        },
      },
      origin: 'derived',
    },
  ]);
});

test('once the days add up again, the insight is removed', () => {
  const staged = applyOps(before, shorten, LATER);
  const withInsight = applyOps(
    staged,
    deriveTrip(staged, TRIP_ID, findShortenedPlace(before, shorten), idSequence()),
    LATER,
  );
  const restore = [
    {
      op: 'update_object',
      id: TOKYO_ID,
      patch: { data: { ...tokyoData, days: 4 } },
      origin: 'direct',
    },
  ];
  const ops = deriveTrip(applyOps(withInsight, restore, LATER), TRIP_ID, null, idSequence());

  assert.deepEqual(
    ops.map((op) => op.op),
    ['update_object', 'delete_object', 'delete_relationship', 'update_intent'],
  );
  assert.equal(ops[1].id, 'b0000000-0000-4000-8000-000000000001');
  assert.deepEqual(ops[3].patch.summary.badge, { text: 'Every day planned', tone: 'ok' });
});

test('more days placed than the trip has is flagged without a fix', () => {
  const grow = [
    {
      op: 'update_object',
      id: TOKYO_ID,
      patch: { data: { ...tokyoData, days: 6 } },
      origin: 'direct',
    },
  ];
  const ops = deriveTrip(applyOps(before, grow, LATER), TRIP_ID, null, idSequence());
  const insight = ops.find((op) => op.op === 'insert_object');

  assert.equal(insight.data.text, '2 days more than the trip has');
  assert.deepEqual(insight.data.actions, []);
  assert.deepEqual(ops.at(-1).patch.summary.badge, { text: '2 days over', tone: 'attention' });
});

test('an unknown trip length opens a pinned decision, resolved once a length is set', () => {
  const { startDate, endDate, derived, ...undated } = tripData;
  const open = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [objectRow(TRIP_ID, 'trip', undated), tokyoRow, kyotoRow],
    }),
  );
  const ops = deriveTrip(open, TRIP_ID, null, idSequence());
  const decisionId = 'b0000000-0000-4000-8000-000000000001';
  const decision = ops.find((op) => op.op === 'insert_object');
  const layout = ops.find((op) => op.op === 'set_workspace');

  assert.deepEqual(decision.data, {
    question: 'How long is the trip?',
    status: 'open',
    derivedKey: 'trip.length',
  });
  assert.deepEqual(layout.doc.sections.at(-1), {
    id: `decision-${decisionId}`,
    type: 'decision',
    decisionId,
    fields: [],
    pin: 'open',
  });
  assert.deepEqual(ops.at(-1).patch.summary.badge, { text: 'Length not set', tone: 'attention' });

  const withDecision = applyOps(open, ops, LATER);
  const setLength = [
    {
      op: 'update_object',
      id: TRIP_ID,
      patch: { data: { ...undated, totalDays: 8 } },
      origin: 'direct',
    },
  ];
  const resolved = deriveTrip(
    applyOps(withDecision, setLength, LATER),
    TRIP_ID,
    null,
    idSequence(),
  );
  const closed = resolved.find((op) => op.op === 'update_object' && op.id === decisionId);

  assert.equal(closed.patch.data.status, 'resolved');
  assert.ok(
    !resolved
      .find((op) => op.op === 'set_workspace')
      .doc.sections.some((s) => s.type === 'decision'),
  );
});
