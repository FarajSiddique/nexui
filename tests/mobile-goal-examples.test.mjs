import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exampleGoal,
  GOAL_EXAMPLES,
  nextGoalPlaceholder,
  plansToday,
} from '../apps/mobile/src/features/compose/goal-examples.ts';
import { TEMPLATE_EXAMPLES } from '../packages/types/src/index.ts';

const trip = { plans: 'trips', goal: 'A week in Lisbon in May' };
const job = { plans: 'job searches', goal: 'Find a senior designer role in Berlin' };
const home = { plans: 'home searches', goal: 'Find a two-bed flat in Leeds' };

test('the saved-goal reply names what Nexui plans today', () => {
  assert.equal(plansToday([trip]), 'Today Nexui plans trips.');
  assert.equal(plansToday([trip, job]), 'Today Nexui plans trips and job searches.');
  assert.equal(
    plansToday([trip, job, home]),
    'Today Nexui plans trips, job searches and home searches.',
  );
});

test('new plans take turns with each template’s example goal', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((turn) => exampleGoal([trip, job], turn)),
    [trip.goal, job.goal, trip.goal, job.goal],
  );
  assert.equal(exampleGoal([trip], 5), trip.goal);
});

// Until job search declares its template (PR 2), the + sheet offers trips alone.
test('the + sheet offers every template the API plans, and only those', () => {
  assert.deepEqual(GOAL_EXAMPLES, Object.values(TEMPLATE_EXAMPLES));
  assert.equal(plansToday(GOAL_EXAMPLES), 'Today Nexui plans trips.');
  assert.equal(nextGoalPlaceholder(), 'A week in Lisbon in May');
});
