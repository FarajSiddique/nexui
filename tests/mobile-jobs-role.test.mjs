import assert from 'node:assert/strict';
import test from 'node:test';

import { linkHost } from '../apps/mobile/src/features/jobs/job-format.ts';
import { renameAction } from '../apps/mobile/src/features/jobs/role-actions.ts';
import { askAbout, roleDetails } from '../apps/mobile/src/features/jobs/role-details.ts';
import { RUN_ID } from './support/graph.mjs';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  ROLE_ID,
  roleData,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const ZONE = 'Europe/London';
const DRAFT_ID = 'f2000000-0000-4000-8000-000000000030';
const PERSON_ID = 'f2000000-0000-4000-8000-000000000031';
const role = (data) => jobObject(ROLE_ID, 'opportunity', data, { title: data.title });

function planWith(roleObject, extra = []) {
  return jobSnapshot({
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
      roleObject,
      ...extra,
    ],
    links: [
      jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
      ...extra.map((object, n) => jobLink(10 + n, object.id, ROLE_ID, 'for')),
    ],
  });
}

test("a role's sheet shows where it is, why it fits, its posting and what's for it", () => {
  const applied = role(
    roleData({
      stage: 'applied',
      appliedAt: '2026-09-26T09:00:00.000Z',
      postedAt: '2026-10-02T09:00:00.000Z',
      lastSeenLiveAt: '2026-10-08T07:04:00.000Z',
      salary: { min: 130_000, max: 150_000, currency: 'GBP' },
      fit: { score: 0.9, reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
    }),
  );
  const extra = [
    jobObject(
      DRAFT_ID,
      'document',
      { docType: 'cover_letter', body: 'Dear Halyard team, I am writing' },
      { source: { type: 'ai', runId: RUN_ID } },
    ),
    jobObject(PERSON_ID, 'person', { name: 'Priya Shah', role: 'recruiter' }),
    jobObject(INTERVIEW_ID, 'interview', { at: '2026-10-09T13:00:00Z', label: 'Phone screen' }),
  ];
  const details = roleDetails(planWith(applied, extra), ROLE_ID, NOW, ZONE);

  assert.deepEqual(
    {
      company: details.company,
      line: details.line,
      posting: details.posting,
      current: details.stages.filter((stage) => stage.current).map((stage) => stage.value),
      dates: details.dates,
      drafts: details.drafts,
      people: details.people,
      interviews: details.interviews,
      closed: details.closed,
    },
    {
      company: 'Halyard',
      line: 'London, hybrid · £130k–£150k',
      posting: {
        url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
        host: 'job-boards.greenhouse.io',
        note: 'Posted Oct 2 · still live today on its job board',
      },
      current: ['applied'],
      dates: ['Applied Sep 26'],
      drafts: [{ id: DRAFT_ID, label: 'Cover letter · 6 words', ai: true }],
      people: [{ name: 'Priya Shah', role: 'recruiter' }],
      interviews: [{ label: 'Phone screen', when: 'Fri, Oct 9, 2:00 PM' }],
      closed: null,
    },
  );
  assert.deepEqual(details.fit, { reasons: ['Payments platform work'], gaps: ['No B2B sales'] });
  assert.equal(askAbout(details), 'About Staff Product Manager, Payments at Halyard: ');
});

test('a role with almost nothing has no posting, fit or company, and still opens', () => {
  const bare = jobObject(ROLE_ID, 'opportunity', { title: 'Role', stage: 'new', followUps: 0 });
  const details = roleDetails(jobSnapshot({ objects: [bare] }), ROLE_ID, NOW, ZONE);

  assert.deepEqual(
    [details.company, details.line, details.posting, details.fit, details.people, details.drafts],
    [null, '', null, null, [], []],
  );
  assert.equal(askAbout(details), 'About Role: ');
  assert.equal(roleDetails(jobSnapshot(), ROLE_ID, NOW), null);
});

test("a model's link names the host it opens; one that isn't https names none", () => {
  const modelRole = role(
    roleData({ url: 'https://apply.example.net/jobs/1?ref=x', source: undefined }),
  );
  const plainRole = role(roleData({ url: 'http://apply.example.net/jobs/1', source: undefined }));

  assert.equal(
    roleDetails(planWith(modelRole), ROLE_ID, NOW, ZONE).posting.host,
    'apply.example.net',
  );
  assert.equal(roleDetails(planWith(plainRole), ROLE_ID, NOW, ZONE).posting, null);
  assert.equal(linkHost('http://apply.example.net/jobs/1'), null);
  assert.equal(linkHost('not a url'), null);
});

test('a closed role says how, and offers its outcomes to close by', () => {
  const closed = roleDetails(
    planWith(role(roleData({ stage: 'closed', outcome: 'no_reply' }))),
    ROLE_ID,
    NOW,
  );

  assert.equal(closed.closed, 'Closed · No reply');
  assert.deepEqual(
    closed.closeWith.map((outcome) => outcome.label),
    ['Rejected', 'Withdrew', 'No reply', 'Posting closed'],
  );
  assert.deepEqual(
    closed.stages.map((stage) => stage.label),
    ['New', 'Interested', 'Applied', 'Interviewing', 'Offer'],
  );
  assert.equal(
    closed.stages.some((stage) => stage.current),
    false,
  );
});

test('renaming trims the title, shows it at once, and sends nothing for no change', () => {
  const named = role(roleData({ title: 'Role' }));
  const action = renameAction(named, '  Staff PM, Lending ');

  assert.deepEqual(action.request, {
    name: 'object.update',
    input: { ref: ROLE_ID, data: { title: 'Staff PM, Lending' } },
  });
  assert.deepEqual(
    [action.optimistic[0].patch.title, action.optimistic[0].patch.data.title],
    ['Staff PM, Lending', 'Staff PM, Lending'],
  );
  assert.equal(renameAction(named, '   '), null);
  assert.equal(renameAction(named, 'Role'), null);
  assert.equal(renameAction(named, 'x'.repeat(201)), null);
});
