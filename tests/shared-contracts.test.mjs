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
    'searchDataSchema',
    'companyDataSchema',
    'opportunityDataSchema',
    'interviewDataSchema',
    'personDataSchema',
    'documentDataSchema',
    'resumeProfileSchema',
    'STAGES',
    'PASS_REASONS',
    'jobKey',
    'searchParts',
    'searchFigures',
    'followUpState',
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

  assert.deepEqual(types.templateSchema.options, ['travel', 'job_search']);
  assert.equal(types.runInputSchema.safeParse({ ...input, template: 'travel' }).success, true);
  assert.equal(types.runInputSchema.safeParse({ ...input, template: 'job_search' }).success, true);
  assert.equal(types.runInputSchema.safeParse(input).success, true);
  assert.equal(types.runInputSchema.safeParse({ ...input, template: 'none' }).success, false);
});

test('a stored workspace doc passes through the upgrade step unchanged', () => {
  const doc = travelWorkspace(TRIP_ID);

  assert.equal(types.WORKSPACE_DOC_VERSION, 1);
  assert.equal(types.upgradeWorkspace(doc), doc);
  assert.deepEqual(mapSnapshotRow(snapshotRow(doc)).workspace.doc, doc);
});

test('every template has an example entry, and each example is a goal the create route accepts', () => {
  assert.deepEqual(Object.keys(types.TEMPLATE_EXAMPLES), types.templateSchema.options);
  // Job search's mobile side ships in PR 3; until then the + sheet doesn't offer it.
  assert.equal(types.TEMPLATE_EXAMPLES.job_search, null);

  for (const [name, example] of Object.entries(types.TEMPLATE_EXAMPLES)) {
    if (example === null) {
      continue;
    }

    assert.equal(
      types.createIntentRequestSchema.safeParse({ goal: example.goal }).success,
      true,
      name,
    );
    assert.match(example.plans, /^[a-z]+( [a-z]+)*$/, name);
  }
});

test('a pipeline and a timeline are sections, and a card action names one capability', () => {
  const query = { from: 'objects', kind: 'opportunity' };
  const pipeline = {
    id: 'pipeline',
    type: 'pipeline',
    query,
    stageField: 'data.stage',
    stages: [{ value: 'new', label: 'New' }],
    collapsedStages: ['closed'],
    cardActions: [
      {
        stage: 'new',
        actions: [
          { label: 'Pass', capability: 'jobs.pass', tone: 'secondary', pick: 'passReason' },
        ],
      },
    ],
  };

  assert.equal(types.sectionSchema.safeParse(pipeline).success, true);
  assert.equal(
    types.sectionSchema.safeParse({
      id: 'coming-up',
      type: 'timeline',
      query,
      dateField: 'data.at',
      labelField: 'data.label',
    }).success,
    true,
  );
  assert.equal(
    types.cardActionSchema.safeParse({ label: 'Go', capability: 'not a name', tone: 'primary' })
      .success,
    false,
  );
  assert.equal(
    types.cardActionSchema.safeParse({ label: 'Go', capability: 'jobs.setStage', tone: 'loud' })
      .success,
    false,
  );
});

test('an insight can offer an upload, a copy or a start; a summary a chip strip and a quiet badge', () => {
  for (const action of [
    { type: 'upload', label: 'Add resume', docType: 'resume' },
    { type: 'copy', label: 'Copy address', text: 'me@in.nexui.app' },
    { type: 'start', label: 'Start without' },
  ]) {
    assert.equal(types.insightActionSchema.safeParse(action).success, true, action.type);
  }

  assert.equal(
    types.insightActionSchema.safeParse({ type: 'upload', label: 'Add', docType: 'brief' }).success,
    false,
  );
  assert.equal(
    types.intentSummarySchema.safeParse({
      line: '',
      badge: { text: 'Paused', tone: 'quiet' },
      stripStyle: 'chips',
      strip: [{ label: 'Halyard', ai: true }],
    }).success,
    true,
  );
});
