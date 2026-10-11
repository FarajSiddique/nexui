import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import * as types from '../packages/types/src/index.ts';
import { snapshotRow, TRIP_ID } from './support/graph.mjs';

test('the barrel exports every kind schema and helper after the per-template grouping', () => {
  const names = [
    'currencySchema',
    'moneySchema',
    'USD_PER_UNIT',
    'convertMoney',
    'tripDerivedSchema',
    'tripDataSchema',
    'placeDataSchema',
    'legDataSchema',
    'stayDataSchema',
    'decisionDataSchema',
    'optionDataSchema',
    'insightDataSchema',
    'thingDataSchema',
    'daysBetween',
    'tripParts',
    'tripFigures',
    'formatDateRange',
    'KIND_REGISTRY',
    'KIND_CARDS',
    'parseKindData',
  ];

  for (const name of names) {
    assert.ok(name in types, name);
  }
});

test('templates are one enum, shared by intents and run inputs', () => {
  const input = { text: 'Plan Japan', route: 'reasoning', perception: 'model' };

  assert.deepEqual(types.templateSchema.options, ['travel']);
  assert.equal(types.runInputSchema.safeParse({ ...input, template: 'travel' }).success, true);
  assert.equal(types.runInputSchema.safeParse(input).success, true);
  assert.equal(types.runInputSchema.safeParse({ ...input, template: 'none' }).success, false);
});

test('a stored workspace doc passes through the upgrade step unchanged', () => {
  const doc = travelWorkspace(TRIP_ID);

  assert.equal(types.WORKSPACE_DOC_VERSION, 1);
  assert.equal(types.upgradeWorkspace(doc), doc);
  assert.deepEqual(mapSnapshotRow(snapshotRow(doc)).workspace.doc, doc);
});

test('every template offers an example goal the create route accepts', () => {
  assert.deepEqual(Object.keys(types.TEMPLATE_EXAMPLES), types.templateSchema.options);

  for (const [name, example] of Object.entries(types.TEMPLATE_EXAMPLES)) {
    assert.equal(
      types.createIntentRequestSchema.safeParse({ goal: example.goal }).success,
      true,
      name,
    );
    assert.match(example.plans, /^[a-z]+( [a-z]+)*$/, name);
  }
});
