import assert from 'node:assert/strict';
import test from 'node:test';

import { replyFor, targetOf } from '../apps/mobile/src/features/compose/compose-reply.ts';

const snapshot = { intent: { id: 'plan-1' } };

test('each create outcome gets its reply', () => {
  assert.deepEqual(replyFor({ outcome: 'started', snapshot, runId: 'run-1' }), {
    type: 'run',
    runId: 'run-1',
    restart: false,
  });
  assert.deepEqual(replyFor({ outcome: 'awaiting_resume', snapshot }), { type: 'resume' });
  assert.deepEqual(replyFor({ outcome: 'unsupported' }), { type: 'saved' });
  assert.deepEqual(replyFor({ outcome: 'existing_search', intentId: 'plan-2' }), {
    type: 'existing',
  });
});

test('the sheet then acts on the new plan, the one already going, or none', () => {
  assert.equal(targetOf({ outcome: 'started', snapshot, runId: 'run-1' }), 'plan-1');
  assert.equal(targetOf({ outcome: 'awaiting_resume', snapshot }), 'plan-1');
  assert.equal(targetOf({ outcome: 'existing_search', intentId: 'plan-2' }), 'plan-2');
  assert.equal(targetOf({ outcome: 'unsupported' }), null);
});
