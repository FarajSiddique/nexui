import assert from 'node:assert/strict';
import test from 'node:test';

import { afterAsk } from '../apps/mobile/src/lib/run-outcome.ts';

const entry = (capability, ok = true) => ({
  step: 0,
  capability,
  label: capability,
  ok,
  ms: 1,
  input: null,
});

test('a run that proposed a decision offers the choice', () => {
  assert.equal(afterAsk({ status: 'succeeded', progress: [entry('decision.propose')] }), 'choice');
});

test('any other run that succeeded goes back to the plan', () => {
  assert.equal(afterAsk({ status: 'succeeded', progress: [entry('trip.setPlaceDays')] }), 'plan');
  assert.equal(afterAsk({ status: 'succeeded', progress: [] }), 'plan');
  assert.equal(
    afterAsk({ status: 'succeeded', progress: [entry('decision.propose', false)] }),
    'plan',
  );
});

test('a working, failed or stopped run offers nothing; the run card has Retry', () => {
  for (const status of ['queued', 'running', 'stopping', 'failed', 'cancelled']) {
    assert.equal(afterAsk({ status, progress: [entry('decision.propose')] }), null, status);
  }

  assert.equal(afterAsk(undefined), null);
});
