import assert from 'node:assert/strict';
import test from 'node:test';

import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { timelineRows } from '../apps/mobile/src/features/jobs/timeline.ts';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  ROLE_ID,
  roleData,
  SEARCH_ID,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z'); // a Thursday
const ZONE = 'Europe/London';
const PAST_ID = 'f2000000-0000-4000-8000-000000000010';
const DATE_ID = 'f2000000-0000-4000-8000-000000000011';
const LOOSE_ID = 'f2000000-0000-4000-8000-000000000012';
const section = jobSearchWorkspace(SEARCH_ID).sections.find((entry) => entry.type === 'timeline');
const interview = (id, data) => jobObject(id, 'interview', data, { title: data.label });

// Corvid's Staff PM role, the given interviews, and `for` links from those named.
function rowsOf(interviews, forRole) {
  const snapshot = jobSnapshot({
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Corvid', target: false }, { title: 'Corvid' }),
      jobObject(ROLE_ID, 'opportunity', roleData({ stage: 'interviewing' }), { title: 'Staff PM' }),
      ...interviews,
    ],
    links: [
      jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
      ...forRole.map((id, n) => jobLink(10 + n, id, ROLE_ID, 'for')),
    ],
  });

  return timelineRows(section, interviews, snapshot, NOW, ZONE);
}

test('interviews coming up show soonest first, and the past folds away newest first', () => {
  const rows = rowsOf(
    [
      interview(INTERVIEW_ID, {
        at: '2026-10-09T13:00:00Z',
        label: 'Phone screen',
        with: 'Maya Chen',
      }),
      interview(PAST_ID, { at: '2026-10-01T09:00:00Z', label: 'Recruiter screen' }),
      interview(DATE_ID, { at: '2026-10-08', label: 'Panel' }),
    ],
    [INTERVIEW_ID, PAST_ID, DATE_ID],
  );

  assert.deepEqual(rows.upcoming, [
    { id: DATE_ID, weekday: 'THU', day: '8', title: 'Panel · Corvid', detail: '', opens: ROLE_ID },
    {
      id: INTERVIEW_ID,
      weekday: 'FRI',
      day: '9',
      title: 'Phone screen · Corvid',
      detail: '2:00 PM · with Maya Chen',
      opens: ROLE_ID,
    },
  ]);
  assert.deepEqual(
    rows.past.map((row) => [row.id, row.weekday, row.day, row.detail]),
    [[PAST_ID, 'THU', '1', '10:00 AM']],
  );
});

test('a time near midnight reads in the zone; an interview with no role opens nothing', () => {
  const rows = rowsOf(
    [interview(LOOSE_ID, { at: '2026-10-09T23:30:00-07:00', label: 'Panel' })],
    [],
  );

  assert.deepEqual(rows.upcoming, [
    { id: LOOSE_ID, weekday: 'SAT', day: '10', title: 'Panel', detail: '7:30 AM', opens: null },
  ]);
  assert.deepEqual(rows.past, []);
});
