import assert from 'node:assert/strict';
import test from 'node:test';

import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import {
  outcomeLabel,
  placeLine,
  roleLine,
  salaryText,
} from '../apps/mobile/src/features/jobs/job-format.ts';
import { pipelineGroups } from '../apps/mobile/src/features/jobs/pipeline.ts';
import { cardAction, stageAction } from '../apps/mobile/src/features/jobs/role-actions.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import { RUN_ID, STAMP } from './support/graph.mjs';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  OTHER_ROLE_ID,
  ROLE_ID,
  roleData,
  SEARCH_ID,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const ZONE = 'Europe/London';
const APPLIED_ID = 'f2000000-0000-4000-8000-000000000020';
const CLOSED_ID = 'f2000000-0000-4000-8000-000000000021';
const BARE_ID = 'f2000000-0000-4000-8000-000000000022';
const section = jobSearchWorkspace(SEARCH_ID).sections.find((entry) => entry.type === 'pipeline');
const [interested, pass] = section.cardActions[0].actions;
const role = (id, data, extra = {}) =>
  jobObject(id, 'opportunity', data, { title: data.title, ...extra });

const found = role(
  ROLE_ID,
  roleData({
    salary: { min: 130_000, max: 150_000, currency: 'GBP' },
    fit: { score: 0.91, reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
  }),
  { source: { type: 'ai', runId: RUN_ID } },
);
const roles = [
  found,
  role(OTHER_ROLE_ID, roleData({ title: 'Staff PM, Lending', stage: 'interviewing' })),
  role(
    APPLIED_ID,
    roleData({
      title: 'Senior PM',
      stage: 'applied',
      appliedAt: '2026-09-26T09:00:00.000Z',
    }),
  ),
  role(CLOSED_ID, roleData({ title: 'Lead PM, Risk', stage: 'closed', outcome: 'passed' })),
];
const snapshot = jobSnapshot({
  objects: [
    jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
    ...roles,
    jobObject(INTERVIEW_ID, 'interview', { at: '2026-10-09T13:00:00Z', label: 'Phone screen' }),
  ],
  links: roles
    .map((entry, n) => jobLink(1 + n, entry.id, COMPANY_ID, 'at'))
    .concat([jobLink(9, INTERVIEW_ID, OTHER_ROLE_ID, 'for')]),
});

test('roles group by stage: New first and AI-marked with its fit, Closed folded', () => {
  const groups = pipelineGroups(section, roles, snapshot, NOW, ZONE);

  assert.deepEqual(
    groups.map((group) => [group.label, group.collapsed, group.cards.length]),
    [
      ['New', false, 1],
      ['Applied', false, 1],
      ['Interviewing', false, 1],
      ['Closed', true, 1],
    ],
  );

  const [newCard] = groups[0].cards;

  assert.deepEqual(
    [newCard.title, newCard.line, newCard.ai, newCard.fit, newCard.actions.map((a) => a.label)],
    [
      'Staff Product Manager, Payments',
      'Halyard · London, hybrid · £130k–£150k',
      true,
      { reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
      ['Interested', 'Pass'],
    ],
  );
  assert.equal(groups[1].cards[0].note, 'Applied Sep 26 · follow-up due');
  assert.equal(groups[2].cards[0].note, 'Phone screen Fri, Oct 9, 2:00 PM');
  assert.equal(groups[3].cards[0].note, 'Passed');
});

test('New shows even when empty, and a role with almost nothing still draws', () => {
  const bare = role(BARE_ID, { title: 'Role', stage: 'interviewing', followUps: 0 });
  const groups = pipelineGroups(section, [bare], jobSnapshot({ objects: [bare] }), NOW, ZONE);

  assert.deepEqual(
    groups.map((group) => [group.label, group.cards.length]),
    [
      ['New', 0],
      ['Interviewing', 1],
    ],
  );
  assert.deepEqual(
    [groups[1].cards[0].title, groups[1].cards[0].line, groups[1].cards[0].note],
    ['Role', '', 'Interviewing'],
  );
});

test('Interested and Pass call the doc’s capability with the role, and move it at once', () => {
  const keen = cardAction(found, interested, null);
  const passed = cardAction(found, pass, 'wrong_location');
  const skipped = cardAction(found, pass, null);
  const after = (action) =>
    applyOps(snapshot, action.optimistic, STAMP).objects.find((o) => o.id === ROLE_ID).data;

  assert.deepEqual(keen.request, {
    name: 'jobs.setStage',
    input: { objectId: ROLE_ID, stage: 'interested' },
  });
  assert.equal(after(keen).stage, 'interested');
  assert.deepEqual(passed.request, {
    name: 'jobs.pass',
    input: { objectId: ROLE_ID, reason: 'wrong_location' },
  });
  assert.deepEqual([after(passed).stage, after(passed).outcome], ['closed', 'passed']);
  assert.deepEqual(skipped.request.input, { objectId: ROLE_ID });
  assert.deepEqual(
    cardAction(found, { label: 'Hm', capability: 'jobs.other', tone: 'secondary' }, null),
    {
      type: 'capability',
      request: { name: 'jobs.other', input: { objectId: ROLE_ID } },
      optimistic: [],
    },
  );
});

test('moving a closed role drops its outcome; closing one sets it', () => {
  const closed = roles[3];

  assert.equal('outcome' in stageAction(closed, 'interested').optimistic[0].patch.data, false);
  assert.deepEqual(stageAction(found, 'closed', 'rejected').request.input, {
    objectId: ROLE_ID,
    stage: 'closed',
    outcome: 'rejected',
  });
});

test('pay, place and outcome read as the cards show them', () => {
  assert.equal(salaryText({ min: 90_000, currency: 'USD' }), 'from $90k');
  assert.equal(salaryText({ max: 90_000, currency: 'USD' }), 'up to $90k');
  assert.equal(salaryText({ min: 90_000, max: 90_000, currency: 'USD' }), '$90k');
  assert.equal(salaryText(undefined), '');
  assert.equal(placeLine({ workMode: 'onsite' }), 'On-site');
  assert.equal(placeLine({ location: 'Leeds' }), 'Leeds');
  assert.equal(placeLine({ location: '', workMode: 'remote' }), 'Remote');
  assert.equal(roleLine({ title: 'x', stage: 'new', followUps: 0 }, null), '');
  assert.equal(outcomeLabel('no_reply'), 'No reply');
});
