import assert from 'node:assert/strict';
import test from 'node:test';

import { decisionCapabilities } from '../apps/api/src/lib/capabilities/decisions.ts';
import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { TRAVEL_SCOPE } from '../apps/api/src/lib/travel/capabilities.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { idSequence, RUN_ID, snapshotRow, TRIP_ID } from './support/graph.mjs';

const plain = decisionCapabilities(TRAVEL_SCOPE);
const option = (label) => ({ label, summary: `${label}, in a sentence` });
const question = {
  ref: 'when',
  question: 'Spring or autumn?',
  options: [option('Spring'), option('Autumn')],
};

function stager() {
  return createStager({
    capabilities: plain,
    snapshot: mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID))),
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
  });
}

test('without a template’s options, an option has only the shared fields', () => {
  const [propose, resolve] = plain;
  const fields = propose.input.toJSONSchema().properties.options.items.properties;

  assert.deepEqual(Object.keys(fields), ['label', 'summary', 'pros', 'cons', 'metrics', 'fit']);
  assert.equal(
    propose.description,
    'Put a choice to the user: a question with 2 to 4 options, pinned at the top of the plan. ' +
      'Use it instead of choosing for them.',
  );
  assert.equal(
    resolve.description,
    'Settle an open decision with one of its options, or dismiss it by leaving optionId out.',
  );
});

test('a plain proposal adds the decision and its options, and refuses a trip’s place', () => {
  const s = stager();

  s.call('decision.propose', question);

  const inserted = s
    .takeOps()
    .filter((op) => op.op === 'insert_object')
    .map((op) => op.kind);

  assert.deepEqual(inserted, ['decision', 'option', 'option']);
  assert.throws(
    () =>
      s.call('decision.propose', {
        ref: 'where',
        question: 'Where next?',
        options: [{ ...option('Nara'), place: {} }, option('Kobe')],
      }),
    (error) => error instanceof CapabilityError,
  );
});

test('picking a plain option settles the question and changes nothing else', () => {
  const s = stager();

  s.call('decision.propose', question);
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'when', optionId: 'when-1' });

  const ops = s.takeOps();

  assert.deepEqual(
    ops.map((op) => op.op),
    ['update_object', 'set_workspace'],
  );
  assert.equal(ops[0].patch.data.status, 'resolved');
});
