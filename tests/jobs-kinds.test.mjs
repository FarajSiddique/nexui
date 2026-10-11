import assert from 'node:assert/strict';
import test from 'node:test';

import { KIND_BEHAVIOUR } from '../apps/api/src/lib/kinds/behaviour.ts';
import {
  anchorFigures,
  followUpState,
  jobKey,
  KIND_REGISTRY,
  parseKindData,
  PASS_REASONS,
  passReasonSchema,
  searchFigures,
  STAGES,
  stageSchema,
} from '../packages/types/src/index.ts';
import { jobObject, jobSnapshot, roleData, SEARCH_ID, searchData } from './support/jobs.mjs';

const JOB_KINDS = ['search', 'company', 'opportunity', 'interview', 'person', 'document'];
const NOW = new Date('2026-10-20T12:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const id = (n) => `f2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('job search registers six kinds; only companies and people are made through object.create', () => {
  for (const kind of JOB_KINDS) {
    assert.equal(KIND_REGISTRY[kind].version, 1, kind);
    assert.ok(KIND_BEHAVIOUR[kind], kind);
  }

  assert.deepEqual(
    JOB_KINDS.filter((kind) => KIND_BEHAVIOUR[kind].creatable),
    ['company', 'person'],
  );
  assert.deepEqual(
    KIND_BEHAVIOUR.person.links.map((kindLink) => [kindLink.input, kindLink.type, kindLink.to]),
    [['for', 'for', 'opportunity']],
  );
});

test("a search, a company and a role parse, and a role names its board's own id `job`", () => {
  assert.equal(parseKindData('search', searchData).ok, true);
  assert.equal(
    parseKindData('company', {
      name: 'Halyard',
      board: { provider: 'lever', token: 'halyard', region: 'eu' },
      target: true,
    }).ok,
    true,
  );
  assert.equal(parseKindData('opportunity', roleData()).ok, true);
  // A data field ending in `Id` is a graph id, which models see as a ref.
  assert.equal(
    parseKindData(
      'opportunity',
      roleData({ source: { provider: 'greenhouse', token: 'halyard', jobId: '101' } }),
    ).ok,
    false,
  );
  // Only Lever has a second region.
  assert.equal(
    parseKindData('company', {
      name: 'Halyard',
      board: { provider: 'lever', token: 'halyard', region: 'us' },
      target: false,
    }).ok,
    false,
  );
  // A role the user told Nexui about may have no posting.
  assert.equal(parseKindData('opportunity', { title: 'PM', stage: 'new', followUps: 0 }).ok, true);
});

test('a closed role has an outcome, and only a closed role has one', () => {
  assert.equal(
    parseKindData('opportunity', roleData({ stage: 'closed', outcome: 'passed' })).ok,
    true,
  );
  assert.match(
    parseKindData('opportunity', roleData({ stage: 'closed' })).message,
    /^Invalid opportunity: outcome /,
  );
  assert.equal(parseKindData('opportunity', roleData({ outcome: 'rejected' })).ok, false);
});

test('a resume holds up to 20,000 characters and a profile; a draft 8,000 and neither', () => {
  const profile = { currentEmployer: 'Ledgerly', skills: ['Payments'], pastRoles: [] };

  assert.equal(
    parseKindData('document', {
      docType: 'resume',
      body: 'x'.repeat(20_000),
      profile,
      fileName: 'cv.pdf',
    }).ok,
    true,
  );
  assert.equal(
    parseKindData('document', { docType: 'cover_letter', body: 'x'.repeat(8_001) }).ok,
    false,
  );
  assert.equal(
    parseKindData('document', { docType: 'cover_letter', body: 'Dear Halyard', profile }).ok,
    false,
  );
});

test('an interview is at a time with an offset, or on a date', () => {
  for (const at of ['2026-10-21T14:00:00+01:00', '2026-10-21']) {
    assert.equal(parseKindData('interview', { at, label: 'Phone screen' }).ok, true, at);
  }

  assert.equal(
    parseKindData('interview', { at: '2026-10-21T14:00:00', label: 'Phone screen' }).ok,
    false,
  );
});

test('stages and pass reasons are listed in the order the app shows them', () => {
  assert.deepEqual(
    STAGES.map((stage) => stage.value),
    stageSchema.options,
  );
  assert.deepEqual(
    PASS_REASONS.map((reason) => reason.value),
    passReasonSchema.options,
  );
  assert.deepEqual(
    PASS_REASONS.map((reason) => reason.label),
    [
      'Too junior',
      'Too senior',
      'Wrong location',
      'Not this company',
      'Pay too low',
      'Not the work I want',
    ],
  );
});

test("a job key is the provider, the board's token and its id for the role", () => {
  assert.equal(
    jobKey({ provider: 'lever', token: 'palantir', region: 'eu', job: 'a1b2' }),
    'lever:palantir:a1b2',
  );
});

test('a follow-up is due after 7 quiet days, and a third becomes "close it"', () => {
  const applied = (changes) => roleData({ stage: 'applied', appliedAt: daysAgo(8), ...changes });

  assert.equal(followUpState(applied(), NOW), 'due');
  assert.equal(followUpState(applied({ appliedAt: daysAgo(6) }), NOW), null);
  assert.equal(followUpState(applied({ lastContactAt: daysAgo(3) }), NOW), null);
  assert.equal(followUpState(applied({ followUps: 1, lastContactAt: daysAgo(7) }), NOW), 'due');
  assert.equal(followUpState(applied({ followUps: 2, lastContactAt: daysAgo(8) }), NOW), 'close');
  assert.equal(
    followUpState(roleData({ stage: 'interviewing', appliedAt: daysAgo(20) }), NOW),
    null,
  );
});

test("a search's figures count roles by stage, the next 7 days' interviews and due follow-ups", () => {
  const snapshot = jobSnapshot({
    objects: [
      jobObject(id(1), 'opportunity', roleData()),
      jobObject(id(2), 'opportunity', roleData({ stage: 'interested' })),
      jobObject(id(3), 'opportunity', roleData({ stage: 'applied', appliedAt: daysAgo(9) })),
      jobObject(id(4), 'opportunity', roleData({ stage: 'closed', outcome: 'passed' })),
      jobObject(id(5), 'interview', { at: '2026-10-22T14:00:00+01:00', label: 'Phone screen' }),
      jobObject(id(6), 'interview', { at: '2026-11-02', label: 'Panel' }),
    ],
  });

  assert.deepEqual(searchFigures(snapshot, SEARCH_ID, NOW), {
    new: 1,
    inPlay: 2,
    applied: 1,
    interviewing: 0,
    offers: 0,
    interviewsThisWeek: 1,
    followUpsDue: 1,
  });
  assert.equal(anchorFigures(snapshot).kind, 'search');
});
