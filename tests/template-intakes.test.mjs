import assert from 'node:assert/strict';
import test from 'node:test';

import {
  intakeRoute,
  jobSearchStarted,
  MAX_UPLOAD_BYTES,
  TEMPLATE_EXAMPLES,
  TEMPLATE_INTAKES,
  templateSchema,
} from '../packages/types/src/index.ts';

const STAMP = '2026-10-11T09:00:00.000Z';

test('every template has an intake entry, and only a job search asks for a document', () => {
  assert.deepEqual(Object.keys(TEMPLATE_INTAKES).sort(), [...templateSchema.options].sort());
  assert.equal(TEMPLATE_INTAKES.travel, null);
  assert.equal(TEMPLATE_INTAKES.job_search.title, 'Add your resume?');
  assert.equal(TEMPLATE_INTAKES.job_search.add, 'Add resume (PDF)');
});

test('an upload starts a job search until its build is queued, then replaces the resume', () => {
  const plan = (context) => ({ template: 'job_search', context });

  assert.equal(intakeRoute(plan({ jobs: { timezone: 'Europe/London', seen: [] } })), 'start');
  assert.equal(
    intakeRoute(plan({ jobs: { timezone: 'Europe/London', startedAt: STAMP, seen: [] } })),
    'resume',
  );
  assert.equal(intakeRoute(plan({})), 'start');
  assert.equal(intakeRoute({ template: 'travel', context: {} }), null);
  assert.equal(intakeRoute({ template: null, context: {} }), null);
  assert.equal(jobSearchStarted({ jobs: { startedAt: '' } }), false);
});

test('every template names its plans for the + sheet, and uploads stop at 4 MB', () => {
  for (const example of Object.values(TEMPLATE_EXAMPLES)) {
    assert.ok(example.plans && example.one && example.short && example.goal);
  }

  assert.equal(TEMPLATE_EXAMPLES.job_search.one, 'a job search');
  assert.equal(MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
});
