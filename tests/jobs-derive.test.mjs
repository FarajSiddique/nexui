import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import { deriveJobSearch } from '../apps/api/src/lib/jobs/derive.ts';
import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { idSequence } from './support/graph.mjs';
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

// A Tuesday, 1 PM in London.
const NOW = '2026-10-20T12:00:00.000Z';
const NEW_ROLE_ID = 'f3000000-0000-4000-8000-000000000001';
const daysAgo = (days) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

// Corvid, with `role` at it, and anything else.
function plan(role, { objects = [], links = [] } = {}) {
  return jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Corvid', target: false }),
      jobObject(ROLE_ID, 'opportunity', role, { title: role.title }),
      ...objects,
    ],
    links: [jobLink(1, ROLE_ID, COMPANY_ID, 'at'), ...links],
  });
}

const derive = (snapshot) => deriveJobSearch(snapshot, SEARCH_ID, NOW, idSequence());
const newInsights = (ops) =>
  ops.filter((op) => op.op === 'insert_object' && op.kind === 'insight').map((op) => op.data);

test('a quiet application gets a follow-up card, with Draft a follow-up and Heard back', () => {
  const ops = derive(plan(roleData({ stage: 'applied', appliedAt: daysAgo(8) })));

  assert.deepEqual(newInsights(ops), [
    {
      text: 'No reply from Corvid in 8 days.',
      severity: 'attention',
      derivedKey: `followup:${ROLE_ID}`,
      actions: [
        {
          type: 'ask',
          label: 'Draft a follow-up',
          prompt: 'Draft a follow-up email for Staff Product Manager, Payments at Corvid',
        },
        {
          type: 'capability',
          label: 'Heard back',
          name: 'jobs.logContact',
          input: { objectId: ROLE_ID, direction: 'received' },
        },
      ],
    },
  ]);
});

test('after two follow-ups and a quiet week, the card offers Close it', () => {
  const [insight] = newInsights(
    derive(
      plan(
        roleData({
          stage: 'applied',
          appliedAt: daysAgo(20),
          followUps: 2,
          lastContactAt: daysAgo(8),
        }),
      ),
    ),
  );

  assert.equal(insight.text, 'Still no reply from Corvid.');
  assert.deepEqual(
    insight.actions.map((action) => [action.label, action.input]),
    [
      ['Close it', { objectId: ROLE_ID, stage: 'closed', outcome: 'no_reply' }],
      ['Heard back', { objectId: ROLE_ID, direction: 'received' }],
    ],
  );
});

test('a reply removes the follow-up card and its link', () => {
  const card = jobObject('f3000000-0000-4000-8000-000000000002', 'insight', {
    text: 'No reply from Corvid in 8 days.',
    severity: 'attention',
    derivedKey: `followup:${ROLE_ID}`,
    actions: [],
  });
  const ops = derive(
    plan(roleData({ stage: 'applied', appliedAt: daysAgo(8), lastContactAt: NOW }), {
      objects: [card],
    }),
  );

  assert.deepEqual(
    ops.filter((op) => op.op.startsWith('delete')).map((op) => op.op),
    ['delete_object', 'delete_relationship'],
  );
  assert.equal(ops.find((op) => op.op === 'delete_object').id, card.id);
});

test('an interview in the next 36 hours with no brief gets a Prep me card, in local time', () => {
  const interview = (at) =>
    jobObject(INTERVIEW_ID, 'interview', { at, label: 'Phone screen' }, { title: 'Phone screen' });
  const forRole = [jobLink(2, INTERVIEW_ID, ROLE_ID, 'for')];
  const soon = plan(roleData({ stage: 'interviewing' }), {
    objects: [interview('2026-10-21T14:00:00+01:00')],
    links: forRole,
  });

  assert.deepEqual(newInsights(derive(soon)), [
    {
      text: 'Phone screen with Corvid tomorrow at 2:00 PM.',
      severity: 'attention',
      derivedKey: `interview:${INTERVIEW_ID}`,
      actions: [
        { type: 'ask', label: 'Prep me', prompt: 'Prep me for my Phone screen with Corvid' },
      ],
    },
  ]);

  const later = plan(roleData({ stage: 'interviewing' }), {
    objects: [interview('2026-10-22T14:00:00+01:00')],
    links: forRole,
  });

  assert.deepEqual(newInsights(derive(later)), []);

  const briefId = 'f3000000-0000-4000-8000-000000000003';
  const briefed = plan(roleData({ stage: 'interviewing' }), {
    objects: [
      interview('2026-10-21T14:00:00+01:00'),
      jobObject(briefId, 'document', { docType: 'brief', body: 'Likely questions…' }),
    ],
    links: [...forRole, jobLink(3, briefId, INTERVIEW_ID, 'for')],
  });

  assert.deepEqual(newInsights(derive(briefed)), []);
});

test('accepting an offer ends the search in the same changeset: hired, completed, New roles gone', () => {
  const before = plan(roleData({ stage: 'offer', appliedAt: daysAgo(30) }), {
    objects: [
      jobObject(OTHER_ROLE_ID, 'opportunity', roleData({ title: 'Senior PM', stage: 'applied' })),
      jobObject(NEW_ROLE_ID, 'opportunity', roleData({ title: 'Group PM' })),
    ],
  });
  const s = createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot: before,
    actor: 'user',
    runId: null,
    newId: idSequence(),
    clock: () => new Date(NOW),
  });

  s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'closed', outcome: 'accepted' });

  const ops = prepareChangeset(before, s.takeOps(), 'user', NOW, idSequence());
  const intent = ops.find((op) => op.op === 'update_intent');
  const search = ops.find((op) => op.op === 'update_object' && op.id === SEARCH_ID);

  assert.equal(intent.patch.status, 'completed');
  assert.deepEqual(intent.patch.summary.badge, { text: 'Hired at Corvid', tone: 'ok' });
  assert.equal(search.patch.data.status, 'hired');
  assert.ok(ops.some((op) => op.op === 'delete_object' && op.id === NEW_ROLE_ID));
  assert.equal(
    ops.some((op) => op.op === 'delete_object' && op.id === OTHER_ROLE_ID),
    false,
  );
  assert.deepEqual(
    ops.filter((op) => op.op === 'insert_object' && op.kind === 'insight').map((op) => op.data),
    [
      {
        text: '1 other application is still open.',
        severity: 'info',
        derivedKey: 'search.withdraw',
        actions: [
          {
            type: 'ask',
            label: 'Draft withdrawal notes',
            prompt: 'Draft withdrawal notes for my other open applications',
          },
        ],
      },
    ],
  );
});
