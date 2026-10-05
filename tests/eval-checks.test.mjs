import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITIES } from '../apps/api/src/lib/capabilities/registry.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  askChecks,
  askPromptOf,
  describePlan,
  goalChecks,
  regionProblem,
} from '../scripts/lib/eval-checks.mjs';
import { CASES } from '../scripts/eval-travel-cases.mjs';
import {
  idSequence,
  KYOTO_ID,
  objectRow,
  relationshipRow,
  RUN_ID,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const LEG_ID = 'e0000000-0000-4000-8000-000000000001';
const INSIGHT_ID = 'e0000000-0000-4000-8000-000000000002';
const japan = {
  name: 'japan',
  countries: ['JP'],
  box: [24, 122, 46, 146],
  days: [8, 8],
  minStops: 2,
};
const succeeded = { id: RUN_ID, status: 'succeeded', error: null, progress: [] };

// The plan-1 trip (Tokyo then Kyoto, 8 days), optionally with a train between them and extras.
function trip({ leg = false, objects = [], relationships = [] } = {}) {
  const base = snapshotRow(travelWorkspace(TRIP_ID));

  return mapSnapshotRow({
    ...base,
    objects: [
      ...base.objects,
      ...(leg
        ? [objectRow(LEG_ID, 'leg', { mode: 'train', estHours: 2.5 }, { title: 'Tokyo → Kyoto' })]
        : []),
      ...objects,
    ],
    relationships: [
      ...base.relationships,
      ...(leg
        ? [
            relationshipRow('e0000000-0000-4000-8000-000000000011', LEG_ID, TRIP_ID),
            relationshipRow('e0000000-0000-4000-8000-000000000012', LEG_ID, TOKYO_ID, 'leg_from'),
            relationshipRow('e0000000-0000-4000-8000-000000000013', LEG_ID, KYOTO_ID, 'leg_to'),
          ]
        : []),
      ...relationships,
    ],
  });
}

const failed = (checks) => checks.filter((check) => !check.ok).map((check) => check.label);

test('there are eight uniquely named cases, each with a goal and a place check', () => {
  assert.equal(CASES.length, 8);
  assert.equal(new Set(CASES.map((testCase) => testCase.name)).size, 8);

  for (const testCase of CASES) {
    assert.ok(testCase.goal.length >= 3, testCase.name);
    assert.ok(testCase.countries || testCase.maxAbsLat, testCase.name);
  }
});

test('a place outside the case’s countries, box or latitude is named', () => {
  const tokyo = trip().objects.find((object) => object.id === TOKYO_ID);

  assert.equal(regionProblem(tokyo, japan), null);
  assert.equal(regionProblem(tokyo, { countries: ['PT'] }), 'Tokyo is in JP');
  assert.match(
    regionProblem(tokyo, { box: [36.5, -10, 42.5, -6] }),
    /^Tokyo \(35\.68, 139\.69\) is outside/,
  );
  assert.equal(regionProblem(tokyo, { maxAbsLat: 30 }), 'Tokyo is at latitude 35.68');
});

test('a complete trip passes every goal check', () => {
  assert.deepEqual(failed(goalChecks(trip({ leg: true }), succeeded, japan)), []);
});

test('a missing leg, a failed run and the wrong length are each reported', () => {
  const checks = goalChecks(
    trip(),
    { ...succeeded, status: 'failed', error: 'Boom' },
    {
      ...japan,
      days: [13, 15],
    },
  );

  assert.deepEqual(failed(checks), [
    'the run succeeded',
    'a leg joins each pair of stops',
    'the trip is 13 to 15 days and fits its stops',
  ]);
  assert.match(
    checks.find((check) => check.label === 'a leg joins each pair of stops').detail,
    /Tokyo → Kyoto/,
  );
});

test('a prompt with no length expects the length question to be open', () => {
  const checks = goalChecks(trip({ leg: true }), succeeded, {
    ...japan,
    days: undefined,
    expectLengthQuestion: true,
  });

  assert.deepEqual(failed(checks), ['"How long is the trip?" is open']);
});

test('the ask prompt comes from the unallocated insight', () => {
  assert.equal(askPromptOf(trip()), null);

  const withInsight = trip({
    objects: [
      objectRow(INSIGHT_ID, 'insight', {
        text: 'You have 1 day unallocated',
        severity: 'attention',
        derivedKey: 'trip.unallocatedDays',
        actions: [
          {
            type: 'ask',
            label: 'Ask Nexui for ideas',
            prompt: 'How should I use the 1 day I have free?',
          },
        ],
      }),
    ],
    relationships: [relationshipRow('e0000000-0000-4000-8000-000000000021', INSIGHT_ID, TRIP_ID)],
  });

  assert.equal(askPromptOf(withInsight), 'How should I use the 1 day I have free?');
});

test('an ask that proposed one pinned decision with places in the region passes', () => {
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot: trip({ leg: true }),
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
  });
  const place = (name, lat, lng) => ({ name, country: 'JP', placeType: 'town', lat, lng });

  s.call('decision.propose', {
    ref: 'spare',
    question: 'Where should the spare day go?',
    options: [
      { label: 'Nara', summary: 'Deer.', place: place('Nara', 34.68, 135.8) },
      { label: 'Koyasan', summary: 'Temples.', place: place('Koyasan', 34.21, 135.59) },
    ],
  });

  assert.deepEqual(failed(askChecks(s.graph(), succeeded, japan)), []);
  assert.deepEqual(failed(askChecks(s.graph(), { ...succeeded, id: 'other' }, japan)), [
    'the ask proposed one open decision',
  ]);
  assert.deepEqual(failed(askChecks(s.graph(), succeeded, { ...japan, countries: ['PT'] })), [
    'every candidate place is in the expected region',
  ]);
});

test('the plan reads as stops, legs and open questions', () => {
  assert.deepEqual(describePlan(trip({ leg: true })), [
    'stops: Tokyo 4d → Kyoto 4d',
    'legs: Tokyo → Kyoto train 2.5h',
    'open: none',
  ]);
});
