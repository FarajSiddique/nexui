import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { layoutWorkspace } from '../apps/mobile/src/features/workspace/workspace-layout.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import {
  KYOTO_ID,
  objectRow,
  relationshipRow,
  snapshotRow,
  STAMP,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const INSIGHT_ID = 'd0000000-0000-4000-8000-000000000001';
const DECISION_ID = 'd0000000-0000-4000-8000-000000000002';
const OPTION_ID = 'd0000000-0000-4000-8000-000000000003';
const LEG_ID = 'd0000000-0000-4000-8000-000000000004';

const doc = travelWorkspace(TRIP_ID);
const base = () => mapSnapshotRow(snapshotRow(doc));
const withRows = (objects, relationships, workspaceDoc = doc) => {
  const row = snapshotRow(workspaceDoc);

  return mapSnapshotRow({
    ...row,
    objects: [...row.objects, ...objects],
    relationships: [...row.relationships, ...relationships],
  });
};
const setDays = (snapshot, id, days) =>
  applyOps(
    snapshot,
    [
      {
        op: 'update_object',
        id,
        patch: { data: { ...snapshot.objects.find((o) => o.id === id).data, days } },
        origin: 'direct',
      },
    ],
    STAMP,
  );
const shape = (blocks) =>
  blocks.map((block) =>
    block.kind === 'open'
      ? `open[${block.entries.map((entry) => entry.section.id).join(',')}]`
      : block.entry.section.id,
  );
const find = (blocks, id) =>
  blocks
    .flatMap((block) => (block.kind === 'open' ? block.entries : [block.entry]))
    .find((entry) => entry.section.id === id).data;

const insightRow = objectRow(INSIGHT_ID, 'insight', {
  text: 'You have 1 day unallocated',
  severity: 'attention',
  derivedKey: 'trip.unallocatedDays',
  actions: [],
});
const decisionRow = (status) =>
  objectRow(DECISION_ID, 'decision', { question: 'Where should the free day go?', status });
const optionRow = objectRow(
  OPTION_ID,
  'option',
  { label: 'Nara', summary: 'Deer park', pros: [], cons: [], metrics: { hours: 1 } },
  { title: 'Nara', position: 1, source: { type: 'ai' } },
);
const decisionDoc = {
  ...doc,
  sections: [
    ...doc.sections.slice(0, 4),
    {
      id: 'decision-1',
      type: 'decision',
      decisionId: DECISION_ID,
      pin: 'open',
      fields: [{ field: 'data.summary', label: 'Summary' }],
    },
    doc.sections[4],
  ],
};

test('with nothing unresolved, the doc renders in order and no Open band shows', () => {
  assert.deepEqual(shape(layoutWorkspace(doc, base())), ['map', 'metrics', 'days', 'route']);
});

test('pinned sections with something unresolved lift into one band under the metrics', () => {
  const snapshot = withRows(
    [insightRow, decisionRow('open'), optionRow],
    [
      relationshipRow('d0000000-0000-4000-8000-000000000011', INSIGHT_ID, TRIP_ID),
      relationshipRow('d0000000-0000-4000-8000-000000000012', DECISION_ID, TRIP_ID),
      relationshipRow('d0000000-0000-4000-8000-000000000013', OPTION_ID, DECISION_ID, 'option_of'),
    ],
    decisionDoc,
  );
  const blocks = layoutWorkspace(decisionDoc, snapshot);

  assert.deepEqual(shape(blocks), ['map', 'metrics', 'open[insights,decision-1]', 'days', 'route']);

  const decision = find(blocks, 'decision-1');

  assert.equal(decision.decision.id, DECISION_ID);
  assert.deepEqual(
    decision.options.map((entry) => [entry.option.title, entry.place]),
    [['Nara', null]],
  );
});

test('a resolved decision leaves the page', () => {
  const snapshot = withRows(
    [decisionRow('resolved')],
    [relationshipRow('d0000000-0000-4000-8000-000000000012', DECISION_ID, TRIP_ID)],
    decisionDoc,
  );

  assert.deepEqual(shape(layoutWorkspace(decisionDoc, snapshot)), [
    'map',
    'metrics',
    'days',
    'route',
  ]);
});

test('without a metric section the Open band goes first', () => {
  const noMetrics = { ...doc, sections: doc.sections.filter((s) => s.type !== 'metric') };
  const snapshot = withRows(
    [insightRow],
    [relationshipRow('d0000000-0000-4000-8000-000000000011', INSIGHT_ID, TRIP_ID)],
    noMetrics,
  );

  assert.deepEqual(shape(layoutWorkspace(noMetrics, snapshot)), [
    'open[insights]',
    'map',
    'days',
    'route',
  ]);
});

test('metrics recompute from the graph, so an edit shows before the server answers', () => {
  const before = find(layoutWorkspace(doc, base()), 'metrics').metrics;
  const after = find(layoutWorkspace(doc, setDays(base(), TOKYO_ID, 3)), 'metrics').metrics;

  assert.deepEqual(
    before.map((m) => [m.label, m.value, m.hot]),
    [
      ['days in total', 8, false],
      ['unallocated', 0, false],
      ['approximate cost', null, false],
    ],
  );
  assert.deepEqual(after[1], { label: 'unallocated', value: 1, format: 'days', hot: true });
});

test('the route lists stops in order with the leg between them', () => {
  const leg = objectRow(LEG_ID, 'leg', { mode: 'train', estHours: 2.5 });
  const snapshot = withRows(
    [leg],
    [
      relationshipRow('d0000000-0000-4000-8000-000000000021', LEG_ID, TRIP_ID),
      relationshipRow('d0000000-0000-4000-8000-000000000022', LEG_ID, TOKYO_ID, 'leg_from'),
      relationshipRow('d0000000-0000-4000-8000-000000000023', LEG_ID, KYOTO_ID, 'leg_to'),
    ],
  );
  const route = find(layoutWorkspace(doc, snapshot), 'route');

  assert.deepEqual(
    route.stops.map((stop) => [stop.place.id, stop.order, stop.legAfter?.id ?? null]),
    [
      [TOKYO_ID, 1, LEG_ID],
      [KYOTO_ID, 2, null],
    ],
  );
  assert.deepEqual([route.totalDays, route.allocatedDays, route.unallocatedDays], [8, 8, 0]);
});

test('more days placed than the trip has: the bar reports the overflow instead of growing', () => {
  const blocks = layoutWorkspace(doc, setDays(base(), KYOTO_ID, 6));
  const bar = find(blocks, 'days');

  assert.deepEqual(
    bar.parts.map((part) => [part.label, part.value]),
    [
      ['Tokyo', 4],
      ['Kyoto', 6],
    ],
  );
  assert.deepEqual([bar.total, bar.free, bar.over], [8, 0, 2]);
  assert.equal(find(blocks, 'route').unallocatedDays, -2);
});

test('map pins follow route order and mark what Nexui added', () => {
  const snapshot = applyOps(
    base(),
    [{ op: 'update_object', id: KYOTO_ID, patch: { source: { type: 'ai' } }, origin: 'direct' }],
    STAMP,
  );

  assert.deepEqual(
    find(layoutWorkspace(doc, snapshot), 'map').pins.map((pin) => [pin.label, pin.order, pin.ai]),
    [
      ['Tokyo', 1, false],
      ['Kyoto', 2, true],
    ],
  );
});
