import assert from 'node:assert/strict';
import test from 'node:test';

import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import { deriveJobSearch } from '../apps/api/src/lib/jobs/derive.ts';
import { jobSearchWorkspace, seedJobSearchOps } from '../apps/api/src/lib/jobs/seed.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { workspaceDocSchema } from '../packages/types/src/index.ts';
import { idSequence, INTENT_ID, LATER, RUN_ID, STAMP } from './support/graph.mjs';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  OTHER_ROLE_ID,
  RESUME_ID,
  ROLE_ID,
  roleData,
  SEARCH_ID,
  searchData,
} from './support/jobs.mjs';

// A Tuesday. Oct 22 is the Thursday after.
const NOW = '2026-10-20T12:00:00.000Z';
const summaryOf = (ops) => ops.find((op) => op.op === 'update_intent')?.patch.summary;

test('a job search starts as its search, its workspace, the start card and its bookkeeping', () => {
  const ops = seedJobSearchOps(
    { goal: 'Find a Staff PM role in London', timezone: 'Europe/London' },
    idSequence(),
  );

  assert.deepEqual(
    ops.map((op) => op.op),
    ['insert_object', 'set_workspace', 'insert_object', 'insert_relationship', 'update_intent'],
  );
  assert.equal(ops[0].kind, 'search');
  assert.deepEqual(ops[0].data.workModes, ['remote', 'hybrid', 'onsite']);
  assert.equal(workspaceDocSchema.safeParse(ops[1].doc).success, true);
  assert.deepEqual(
    ops[1].doc.sections.map((section) => section.id),
    ['metrics', 'insights', 'coming-up', 'pipeline', 'watching'],
  );
  assert.equal(ops[2].data.text, 'Add your resume to start');
  assert.deepEqual(
    ops[2].data.actions.map((action) => [action.type, action.label]),
    [
      ['upload', 'Add resume'],
      ['start', 'Start without'],
    ],
  );
  assert.deepEqual(ops[4].patch.context, { jobs: { timezone: 'Europe/London', seen: [] } });
});

test('a new job search validates as one changeset, and Home says it is ready to start', () => {
  const empty = {
    intent: {
      id: INTENT_ID,
      goal: 'Find a Staff PM role in London',
      template: 'job_search',
      status: 'exploring',
      context: {},
      summary: { line: '' },
      createdAt: STAMP,
      updatedAt: STAMP,
      lastActivityAt: STAMP,
    },
    workspace: null,
    objects: [],
    relationships: [],
  };
  const seed = TEMPLATES.job_search.seed(
    { goal: empty.intent.goal, timezone: 'Europe/London' },
    idSequence(),
  );
  const intentOps = prepareChangeset(empty, seed, 'system', LATER, idSequence()).filter(
    (op) => op.op === 'update_intent',
  );

  assert.equal(intentOps.length, 1);
  assert.deepEqual(intentOps[0].patch.context, { jobs: { timezone: 'Europe/London', seen: [] } });
  assert.deepEqual(intentOps[0].patch.summary, {
    line: 'Setting up your search',
    badge: { text: 'Ready to start', tone: 'attention' },
  });
});

test("derive counts roles and rebuilds Home's line, badge and company chips", () => {
  const snapshot = jobSnapshot({
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }),
      jobObject(ROLE_ID, 'opportunity', roleData(), { source: { type: 'ai', runId: RUN_ID } }),
      jobObject(
        OTHER_ROLE_ID,
        'opportunity',
        roleData({ title: 'Senior PM', stage: 'applied', appliedAt: '2026-10-19T09:00:00Z' }),
      ),
    ],
    links: [jobLink(1, ROLE_ID, COMPANY_ID, 'at')],
  });
  const ops = deriveJobSearch(snapshot, SEARCH_ID, NOW, idSequence());

  assert.deepEqual(ops[0].patch.data.derived, {
    new: 1,
    inPlay: 1,
    applied: 1,
    interviewing: 0,
    offers: 0,
    interviewsThisWeek: 0,
    followUpsDue: 0,
  });
  assert.deepEqual(summaryOf(ops), {
    line: '1 new · 1 applied',
    badge: { text: '1 new role', tone: 'attention' },
    strip: [
      { label: 'Senior PM', ai: false },
      { label: 'Halyard', ai: true },
    ],
    stripStyle: 'chips',
  });
});

test('the badge is the first that applies: hired, ready to start, paused, follow-up due, new', () => {
  const newRole = jobObject(ROLE_ID, 'opportunity', roleData());
  const quiet = jobObject(
    OTHER_ROLE_ID,
    'opportunity',
    roleData({ stage: 'applied', appliedAt: '2026-10-01T09:00:00Z' }),
  );
  const notStarted = { jobs: { timezone: 'UTC', seen: [] } };
  const paused = { ...searchData, status: 'paused' };
  const badge = (options) =>
    summaryOf(deriveJobSearch(jobSnapshot(options), SEARCH_ID, NOW, idSequence()))?.badge;

  assert.deepEqual(badge({ objects: [newRole] }), { text: '1 new role', tone: 'attention' });
  assert.deepEqual(badge({ objects: [newRole, quiet] }), {
    text: 'Follow-up due',
    tone: 'attention',
  });
  assert.deepEqual(badge({ objects: [newRole, quiet], search: paused }), {
    text: 'Paused',
    tone: 'quiet',
  });
  assert.deepEqual(badge({ objects: [newRole], search: paused, context: notStarted }), {
    text: 'Ready to start',
    tone: 'attention',
  });
  assert.deepEqual(
    badge({
      objects: [
        jobObject(COMPANY_ID, 'company', { name: 'Corvid', target: false }),
        jobObject(ROLE_ID, 'opportunity', roleData({ stage: 'closed', outcome: 'accepted' })),
      ],
      links: [jobLink(1, ROLE_ID, COMPANY_ID, 'at')],
      search: { ...searchData, status: 'hired' },
      context: notStarted,
    }),
    { text: 'Hired at Corvid', tone: 'ok' },
  );
});

test('the line names the next interview, or what the search looks for', () => {
  const interview = jobObject(INTERVIEW_ID, 'interview', {
    at: '2026-10-22T14:00:00+01:00',
    label: 'Phone screen',
  });

  assert.equal(
    summaryOf(deriveJobSearch(jobSnapshot({ objects: [interview] }), SEARCH_ID, NOW, idSequence()))
      .line,
    'interview Thu',
  );
  assert.equal(
    summaryOf(deriveJobSearch(jobSnapshot(), SEARCH_ID, NOW, idSequence())).line,
    'Looking for Staff Product Manager roles',
  );
});

test('picking a decision option sets the criteria it carries', () => {
  const stager = createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot: jobSnapshot({ doc: jobSearchWorkspace(SEARCH_ID) }),
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock: () => new Date(NOW),
  });

  stager.call('decision.propose', {
    ref: 'work-mode',
    question: 'Remote or hybrid?',
    options: [
      { label: 'Remote only', summary: 'Fully remote roles.', criteria: { workModes: ['remote'] } },
      {
        label: 'Hybrid is fine',
        summary: 'A few days a week in London.',
        criteria: { workModes: ['hybrid', 'remote'] },
      },
    ],
  });
  stager.call('decision.resolve', { decisionId: 'work-mode', optionId: 'work-mode-1' });

  const search = stager.graph().objects.find((object) => object.id === SEARCH_ID);

  assert.deepEqual(search.data.workModes, ['remote']);
});

test("object.update sets criteria, and refuses the resume and the search's bookkeeping", () => {
  const DRAFT_ID = 'f2000000-0000-4000-8000-000000000009';
  const stager = createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot: jobSnapshot({
      doc: jobSearchWorkspace(SEARCH_ID),
      objects: [
        jobObject(
          RESUME_ID,
          'document',
          { docType: 'resume', body: 'Priya Rao', profile: { skills: [], pastRoles: [] } },
          { title: 'Your resume' },
        ),
        jobObject(DRAFT_ID, 'document', { docType: 'cover_letter', body: 'Dear Halyard,' }),
      ],
    }),
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock: () => new Date(NOW),
  });
  const refused = (message) => (error) =>
    error instanceof CapabilityError && message.test(error.message);

  stager.call('object.update', { ref: 'search', data: { roles: ['Staff PM'] } });
  stager.call('object.update', { ref: DRAFT_ID, data: { body: 'Dear Halyard team,' } });
  assert.deepEqual(stager.graph().objects.find((object) => object.id === SEARCH_ID).data.roles, [
    'Staff PM',
  ]);
  assert.throws(
    () => stager.call('object.update', { ref: RESUME_ID, data: { body: 'Rewritten' } }),
    refused(/^Your resume can't be edited this way\.$/),
  );
  assert.throws(
    () =>
      stager.call('object.update', {
        ref: 'search',
        data: { status: 'hired', roleChecks: 'paused' },
      }),
    refused(/^status and roleChecks can't be changed this way\.$/),
  );
});
