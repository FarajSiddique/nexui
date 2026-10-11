import assert from 'node:assert/strict';
import test from 'node:test';

import { CapabilityError } from '../apps/api/src/lib/capabilities/types.ts';
import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { idSequence, RUN_ID } from './support/graph.mjs';
import {
  COMPANY_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  ROLE_ID,
  roleData,
  SEARCH_ID,
  searchData,
} from './support/jobs.mjs';

const NOW = '2026-10-20T12:00:00.000Z';
const CORVID_JOB = '3f2a9c1e-5b7d-4e2a-9c1f-0a1b2c3d4e5f';
const posting = {
  company: { name: 'Corvid', board: { provider: 'ashby', token: 'corvid' } },
  title: 'Principal PM, Lending',
  url: `https://jobs.ashbyhq.com/corvid/${CORVID_JOB}`,
  source: { provider: 'ashby', token: 'corvid', job: CORVID_JOB },
  location: 'London',
  workMode: 'remote',
};

// A started search with Halyard (a target) and one of its roles.
function planWith({ role = roleData(), search = searchData } = {}) {
  return jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    search,
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: true }, { title: 'Halyard' }),
      jobObject(ROLE_ID, 'opportunity', role, { title: role.title }),
    ],
    links: [jobLink(1, ROLE_ID, COMPANY_ID, 'at')],
  });
}

function stager(snapshot, actor = 'ai') {
  return createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot,
    actor,
    runId: actor === 'ai' ? RUN_ID : null,
    newId: idSequence(),
    clock: () => new Date(NOW),
  });
}

const refused = (message) => (error) =>
  error instanceof CapabilityError && message.test(error.message);
const dataOf = (s, id) => s.graph().objects.find((object) => object.id === id).data;

// What a call staged commits as one changeset: kinds, links and derived figures all validate.
function commitsAsOne(before, s) {
  assert.doesNotThrow(() => prepareChangeset(before, s.takeOps(), 'ai', NOW, idSequence()));
}

test("adding a role reuses the plan's company and links the role to it; a model's fit is dropped", () => {
  const plan = planWith();
  const s = stager(plan);

  s.call('jobs.addRole', {
    ...posting,
    company: { name: 'halyard' },
    title: 'Group PM',
    ref: 'group-pm',
    source: { provider: 'greenhouse', token: 'halyard', job: '202' },
    url: 'https://job-boards.greenhouse.io/halyard/jobs/202',
    fit: { score: 0.9, reasons: ['Made up'], gaps: [] },
  });

  const graph = s.graph();
  const role = graph.objects.find((object) => object.title === 'Group PM');

  assert.equal(s.refs.byRef.get('group-pm'), role.id);
  assert.deepEqual(role.data, {
    title: 'Group PM',
    url: 'https://job-boards.greenhouse.io/halyard/jobs/202',
    source: { provider: 'greenhouse', token: 'halyard', job: '202' },
    location: 'London',
    workMode: 'remote',
    stage: 'new',
    followUps: 0,
  });
  assert.deepEqual(role.source, { type: 'ai', runId: RUN_ID });
  assert.ok(
    graph.relationships.some(
      (edge) => edge.type === 'at' && edge.sourceId === role.id && edge.targetId === COMPANY_ID,
    ),
  );
  assert.equal(graph.objects.filter((object) => object.kind === 'company').length, 1);
  commitsAsOne(plan, s);
});

test("the app's Add it keeps what the scan found: the fit, and the role stamped live", () => {
  const plan = planWith();
  const s = stager(plan, 'user');
  const fit = { score: 0.7, reasons: ['Strong on payments'], gaps: ['On-site four days'] };

  s.call('jobs.addRole', { ...posting, fit });

  const role = s.graph().objects.find((object) => object.title === posting.title);

  assert.deepEqual(role.data.fit, fit);
  assert.equal(role.data.lastSeenLiveAt, NOW);
  assert.deepEqual(role.source, { type: 'user' });
  commitsAsOne(plan, s);
});

test("accepting an offer is the user's call", () => {
  const s = stager(planWith({ role: roleData({ stage: 'offer' }) }));

  assert.throws(
    () => s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'closed', outcome: 'accepted' }),
    refused(/^Accepting an offer is the user's call/),
  );
});

test('a role at a new company adds it, not as a target; a duplicate or an excluded one is refused', () => {
  const plan = planWith({ search: { ...searchData, excludeCompanies: ['Ledgerly'] } });
  const s = stager(plan);

  s.call('jobs.addRole', posting);

  const corvid = s
    .graph()
    .objects.find((object) => object.kind === 'company' && object.data.name === 'Corvid');

  assert.deepEqual(corvid.data, {
    name: 'Corvid',
    board: { provider: 'ashby', token: 'corvid' },
    target: false,
  });
  assert.throws(
    () => s.call('jobs.addRole', posting),
    refused(/^Principal PM, Lending at Corvid is already in this search\.$/),
  );
  assert.throws(
    () =>
      s.call('jobs.addRole', {
        company: { name: 'ledgerly' },
        title: 'Head of Product',
      }),
    refused(/^ledgerly is on this search's never-show list\.$/),
  );
  commitsAsOne(plan, s);
});

test('moving a role stamps Applied once, and closing it needs an outcome', () => {
  const plan = planWith();
  const s = stager(plan, 'user');

  s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'applied' });
  assert.equal(dataOf(s, ROLE_ID).appliedAt, NOW);
  assert.throws(
    () => s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'applied' }),
    refused(/ is already Applied\.$/),
  );
  assert.throws(
    () => s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'closed' }),
    refused(/^Say how the role closed/),
  );
  assert.throws(
    () => s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'offer', outcome: 'accepted' }),
    refused(/^Only a closed role has an outcome\.$/),
  );

  s.call('jobs.setStage', { objectId: ROLE_ID, stage: 'closed', outcome: 'rejected' });

  const role = dataOf(s, ROLE_ID);

  assert.deepEqual([role.stage, role.outcome, role.appliedAt], ['closed', 'rejected', NOW]);
  assert.deepEqual(
    s
      .takeEntries()
      .filter((entry) => entry.ok)
      .map((entry) => entry.label),
    [
      'Moved Staff Product Manager, Payments to Applied',
      'Closed Staff Product Manager, Payments (rejected)',
    ],
  );
  commitsAsOne(plan, s);
});

test('passing closes a role, and a reason joins the last 30', () => {
  const older = Array.from({ length: 30 }, (_, n) => ({
    reason: 'too_junior',
    company: 'Old',
    title: `Role ${n}`,
    at: '2026-10-01T09:00:00.000Z',
  }));
  const plan = planWith({ search: { ...searchData, passReasons: older } });
  const s = stager(plan, 'user');

  s.call('jobs.pass', { objectId: ROLE_ID, reason: 'wrong_location' });

  const reasons = dataOf(s, SEARCH_ID).passReasons;

  assert.deepEqual([dataOf(s, ROLE_ID).stage, dataOf(s, ROLE_ID).outcome], ['closed', 'passed']);
  assert.equal(reasons.length, 30);
  assert.equal(reasons[0].title, 'Role 1');
  assert.deepEqual(reasons.at(-1), {
    reason: 'wrong_location',
    company: 'Halyard',
    title: 'Staff Product Manager, Payments',
    at: NOW,
  });
  assert.throws(() => s.call('jobs.pass', { objectId: ROLE_ID }), refused(/ is already closed\.$/));
  commitsAsOne(plan, s);
});

test('a pass with no reason records none', () => {
  const s = stager(planWith(), 'user');

  s.call('jobs.pass', { objectId: ROLE_ID });
  assert.deepEqual(dataOf(s, SEARCH_ID).passReasons, []);
});

test('a sent follow-up counts, up to two; a reply only moves the last contact', () => {
  const plan = planWith({
    role: roleData({ stage: 'applied', appliedAt: '2026-10-01T09:00:00.000Z', followUps: 1 }),
  });
  const s = stager(plan, 'user');

  s.call('jobs.logContact', { objectId: ROLE_ID, direction: 'sent' });
  s.call('jobs.logContact', {
    objectId: ROLE_ID,
    direction: 'sent',
    at: '2026-10-20T13:00:00.000Z',
  });
  assert.deepEqual(
    [dataOf(s, ROLE_ID).followUps, dataOf(s, ROLE_ID).lastContactAt],
    [2, '2026-10-20T13:00:00.000Z'],
  );

  s.call('jobs.logContact', { objectId: ROLE_ID, direction: 'received' });
  assert.deepEqual([dataOf(s, ROLE_ID).followUps, dataOf(s, ROLE_ID).lastContactAt], [2, NOW]);
  commitsAsOne(plan, s);
});

test('an interview is for its role, with whom, and moves the role to Interviewing', () => {
  const plan = planWith({ role: roleData({ stage: 'applied', appliedAt: NOW }) });
  const s = stager(plan);

  s.call('jobs.addInterview', {
    objectId: ROLE_ID,
    ref: 'screen',
    at: '2026-10-22T14:00:00+01:00',
    label: 'Phone screen',
    with: { name: 'Maya Lind', role: 'recruiter' },
  });
  // The same person again, in another case: no second person.
  s.call('jobs.addInterview', {
    objectId: ROLE_ID,
    at: '2026-10-29',
    label: 'Panel',
    with: { name: 'maya lind' },
  });

  const graph = s.graph();
  const interviews = graph.objects.filter((object) => object.kind === 'interview');

  assert.deepEqual(
    interviews.map((interview) => interview.data),
    [
      { at: '2026-10-22T14:00:00+01:00', label: 'Phone screen', with: 'Maya Lind' },
      { at: '2026-10-29', label: 'Panel', with: 'maya lind' },
    ],
  );
  assert.deepEqual(
    graph.objects.filter((object) => object.kind === 'person').map((person) => person.data),
    [{ name: 'Maya Lind', role: 'recruiter' }],
  );
  assert.ok(
    graph.relationships.some(
      (edge) =>
        edge.type === 'for' && edge.sourceId === interviews[0].id && edge.targetId === ROLE_ID,
    ),
  );
  assert.equal(dataOf(s, ROLE_ID).stage, 'interviewing');
  assert.equal(s.refs.byRef.get('screen'), interviews[0].id);
  commitsAsOne(plan, s);
});

test('a draft is a document for its role or interview, never a resume, at most 8,000 characters', () => {
  const plan = planWith();
  const s = stager(plan);

  s.call('jobs.draft', {
    for: ROLE_ID,
    docType: 'cover_letter',
    body: 'Dear Halyard team,',
    subject: 'Staff PM',
  });

  const doc = s.graph().objects.find((object) => object.kind === 'document');

  assert.equal(doc.title, 'Cover letter for Staff Product Manager, Payments');
  assert.deepEqual(doc.data, {
    docType: 'cover_letter',
    body: 'Dear Halyard team,',
    subject: 'Staff PM',
  });
  assert.ok(
    s
      .graph()
      .relationships.some(
        (edge) => edge.type === 'for' && edge.sourceId === doc.id && edge.targetId === ROLE_ID,
      ),
  );
  assert.throws(
    () => s.call('jobs.draft', { for: ROLE_ID, docType: 'resume', body: 'x' }),
    refused(/^docType: /),
  );
  assert.throws(
    () => s.call('jobs.draft', { for: ROLE_ID, docType: 'brief', body: 'x'.repeat(8_001) }),
    refused(/^body: /),
  );
  assert.throws(
    () => s.call('jobs.draft', { for: 'search', docType: 'brief', body: 'x' }),
    refused(/^A draft is for a role or an interview/),
  );
  commitsAsOne(plan, s);
});

test('the search pauses and resumes, and new-role checks resume; a hired search is done', () => {
  const plan = planWith({ search: { ...searchData, roleChecks: 'paused' } });
  const s = stager(plan, 'user');

  s.call('jobs.setSearchStatus', { status: 'paused' });
  s.call('jobs.setSearchStatus', { status: 'active', roleChecks: 'on' });
  assert.deepEqual(
    [dataOf(s, SEARCH_ID).status, dataOf(s, SEARCH_ID).roleChecks],
    ['active', 'on'],
  );
  assert.deepEqual(
    s.takeEntries().map((entry) => entry.label),
    ['Paused the search', 'Resumed the search and resumed new-role checks'],
  );
  assert.throws(
    () => s.call('jobs.setSearchStatus', { status: 'active' }),
    refused(/^The search is already like that\.$/),
  );

  const hired = stager(planWith({ search: { ...searchData, status: 'hired' } }), 'user');

  assert.throws(
    () => hired.call('jobs.setSearchStatus', { status: 'active' }),
    refused(/^This search ended with a hire\.$/),
  );
});

test('buttons may add, move, pass, log contact and pause; only models add interviews and drafts', () => {
  const expected = {
    'jobs.addRole': [true, true],
    'jobs.setStage': [true, true],
    'jobs.pass': [false, true],
    'jobs.logContact': [true, true],
    'jobs.addInterview': [true, false],
    'jobs.draft': [true, false],
    'jobs.setSearchStatus': [true, true],
  };
  const flags = (name) => {
    const capability = TEMPLATES.job_search.capabilities.find(
      (candidate) => candidate.name === name,
    );

    return [capability.exposeToModel, capability.callableByUser];
  };

  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((name) => [name, flags(name)])),
    expected,
  );
});

test("a model's role takes its source from its URL or the confirmed careers link, never its word", () => {
  const LEVER_JOB = 'a1b2c3d4-0000-4000-8000-000000000001';
  const s = stager(planWith());
  const added = (title, url, source) => {
    s.call('jobs.addRole', { company: { name: 'Corvid' }, title, url, source });

    return s.graph().objects.find((object) => object.title === title).data.source;
  };

  // A board URL names the source; a source that disagrees is ignored.
  assert.deepEqual(
    added('Lead PM', `https://jobs.lever.co/corvid/${LEVER_JOB}/apply`, {
      provider: 'greenhouse',
      token: 'elsewhere',
      job: '1',
    }),
    { provider: 'lever', token: 'corvid', job: LEVER_JOB },
  );
  // A careers-site URL keeps the Greenhouse source a lookup confirmed for that host.
  assert.deepEqual(
    added('Group PM', 'https://corvid.com/jobs?gh_jid=77', {
      provider: 'greenhouse',
      token: 'corvid',
      job: '77',
    }),
    { provider: 'greenhouse', token: 'corvid', job: '77' },
  );
  // Any other URL, or none, gives no source.
  assert.equal(
    added('Head of Product', 'https://www.linkedin.com/jobs/view/1', {
      provider: 'ashby',
      token: 'corvid',
      job: CORVID_JOB,
    }),
    undefined,
  );
});
