import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { prepareChangeset } from '../apps/api/src/lib/graph/prepare.ts';
import {
  isPdf,
  normalizeProfile,
  readResume,
  RESUME_INTAKE,
} from '../apps/api/src/lib/jobs/resume.ts';
import { jobSearchWorkspace, START_INSIGHT } from '../apps/api/src/lib/jobs/seed.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { MockLanguageModelV4, scriptedModel, textStep } from './support/ai.mjs';
import { idSequence, STAMP } from './support/graph.mjs';
import { jobObject, jobSnapshot, RESUME_ID, SEARCH_ID } from './support/jobs.mjs';

const NOW = '2026-10-20T12:00:00.000Z';
const CARD_ID = 'f4000000-0000-4000-8000-000000000001';
const PDF = {
  bytes: new TextEncoder().encode('%PDF-1.7\n%fictional\n'),
  name: 'cv.pdf',
  type: 'application/pdf',
};
// A fictional person; no real data.
const answer = {
  readable: true,
  isResume: true,
  text: 'Priya Rao\nSenior Product Manager, Ledgerly\n2019 to now',
  profile: {
    headline: 'Payments product manager',
    currentTitle: 'Senior Product Manager',
    currentEmployer: 'Ledgerly',
    location: 'London',
    years: 9,
    skills: ['Payments', 'Risk'],
    pastRoles: [{ title: 'Product Manager', company: 'Tessera', years: 3 }],
  },
};
const ai = (model, timeoutMs) => ({ model, providerOptions: undefined, timeoutMs });
const never = new MockLanguageModelV4({
  doGenerate: async () => {
    throw new Error('not called');
  },
});

test('a readable resume comes back as its text and profile, with the read’s usage', async () => {
  const seen = [];
  const read = await readResume(PDF, ai(scriptedModel([textStep(JSON.stringify(answer))], seen)));

  assert.equal(read.outcome, 'read');
  assert.equal(read.text, answer.text);
  assert.deepEqual(read.profile, {
    headline: 'Payments product manager',
    currentTitle: 'Senior Product Manager',
    currentEmployer: 'Ledgerly',
    location: 'London',
    years: 9,
    skills: ['Payments', 'Risk'],
    pastRoles: [{ title: 'Product Manager', company: 'Tessera', years: 3 }],
  });
  assert.deepEqual(read.usage, { inputTokens: 12, outputTokens: 3, model: 'mock-model-id' });

  const user = seen[0].prompt.find((message) => message.role === 'user');

  assert.equal(user.content.find((part) => part.type === 'file').mediaType, 'application/pdf');
  assert.equal(seen[0].maxOutputTokens, 16_000);
  assert.equal(seen[0].responseFormat.type, 'json');
});

test('a blank, illegible or non-resume file is unreadable, and so is any failed call', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const answering = (body) => ai(scriptedModel([textStep(JSON.stringify(body))]));

  assert.equal(
    (await readResume(PDF, answering({ ...answer, readable: false, text: '', profile: null })))
      .outcome,
    'unreadable',
  );
  assert.equal(
    (await readResume(PDF, answering({ ...answer, isResume: false }))).outcome,
    'unreadable',
  );
  // What mock mode answers without a fixture: free text where JSON was asked for.
  assert.equal(
    (await readResume(PDF, ai(scriptedModel([textStep('Done.')])))).outcome,
    'unreadable',
  );

  // Gateway answers a damaged or locked PDF with a 400 it names GatewayInternalServerError.
  const rejected = new MockLanguageModelV4({
    doGenerate: async () => {
      throw Object.assign(new Error('The PDF specified was not valid.'), { statusCode: 400 });
    },
  });

  assert.deepEqual(await readResume(PDF, ai(rejected)), { outcome: 'unreadable', usage: null });
  assert.deepEqual(logged.mock.calls.at(-1).arguments, [
    '[resume]',
    'Reading a resume failed (400).',
  ]);
});

test('a slow read is abandoned at its timeout', async (t) => {
  t.mock.method(console, 'error', () => {});

  const slow = new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  const started = Date.now();

  assert.equal((await readResume(PDF, ai(slow, 20))).outcome, 'unreadable');
  assert.ok(Date.now() - started < 1_000);
});

test('only a PDF is read; no file means none, with no model call', async () => {
  assert.equal(isPdf(PDF.bytes), true);
  assert.equal(
    RESUME_INTAKE.refuse({ ...PDF, bytes: new TextEncoder().encode('PK\u0003\u0004') }),
    "That file isn't a PDF.",
  );
  assert.deepEqual(await RESUME_INTAKE.read(null, ai(never)), {
    outcome: 'none',
    input: { status: 'none' },
    usage: null,
  });
});

test("mock mode reads the matching fixture's answer", async () => {
  const fixture = {
    name: 'test-resume',
    kind: 'create_intent',
    match: ['staff pm'],
    perception: { template: 'job_search' },
    steps: [],
    output: answer,
  };
  const session = sessionOpener({ AI_PROVIDER: 'mock' }, [fixture])(
    'create_intent',
    'Find a Staff PM role in London',
  );
  const read = await RESUME_INTAKE.read(PDF, ai(session.languageModel('fast')));

  assert.equal(read.outcome, 'read');
  assert.equal(read.input.profile.currentEmployer, 'Ledgerly');
  assert.equal(read.input.fileName, 'cv.pdf');
});

test('a profile is held to its limits', () => {
  assert.deepEqual(
    normalizeProfile({
      headline: '  ',
      currentTitle: null,
      currentEmployer: 'Ledgerly',
      location: null,
      years: 72.4,
      skills: Array.from({ length: 25 }, (_, n) => `Skill ${n}`),
      pastRoles: [],
    }),
    {
      currentEmployer: 'Ledgerly',
      years: 60,
      skills: Array.from({ length: 20 }, (_, n) => `Skill ${n}`),
      pastRoles: [],
    },
  );
});

// A plan waiting for its start: the seeded card, no resume.
function waiting(objects = []) {
  return jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    context: { jobs: { timezone: 'Europe/London', seen: [] } },
    objects: [
      jobObject(CARD_ID, 'insight', START_INSIGHT, {
        title: START_INSIGHT.text,
        source: { type: 'derived' },
      }),
      ...objects,
    ],
  });
}

function stager(snapshot) {
  return createStager({
    capabilities: TEMPLATES.job_search.capabilities,
    snapshot,
    actor: 'user',
    runId: null,
    newId: idSequence(),
    clock: () => new Date(NOW),
  });
}

test("a read resume becomes the plan's resume, excludes the employer, clears the card and starts", () => {
  const plan = waiting();
  const s = stager(plan);
  const profile = normalizeProfile(answer.profile);

  s.call('jobs.setResume', {
    status: 'read',
    text: answer.text,
    profile,
    fileName: 'cv.pdf',
    start: true,
  });

  const graph = s.graph();
  const resume = graph.objects.find((object) => object.kind === 'document');

  assert.equal(resume.title, 'Your resume');
  assert.deepEqual(resume.data, {
    docType: 'resume',
    body: answer.text,
    profile,
    fileName: 'cv.pdf',
  });
  assert.deepEqual(graph.objects.find((object) => object.id === SEARCH_ID).data.excludeCompanies, [
    'Ledgerly',
  ]);
  assert.equal(
    graph.objects.some((object) => object.id === CARD_ID),
    false,
  );
  assert.deepEqual(graph.intent.context.jobs, {
    timezone: 'Europe/London',
    seen: [],
    startedAt: NOW,
  });
  assert.doesNotThrow(() => prepareChangeset(plan, s.takeOps(), 'user', NOW, idSequence()));
});

test('a later resume replaces the first in place, and the plan stays started when it was', () => {
  const started = jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    objects: [
      jobObject(RESUME_ID, 'document', {
        docType: 'resume',
        body: 'Old text',
        profile: { skills: [], pastRoles: [] },
      }),
    ],
  });
  const s = stager(started);

  s.call('jobs.setResume', {
    status: 'read',
    text: 'New text',
    profile: { skills: ['Lending'], pastRoles: [] },
    start: false,
  });

  assert.equal(s.graph().objects.filter((object) => object.kind === 'document').length, 1);
  assert.equal(s.graph().objects.find((object) => object.id === RESUME_ID).data.body, 'New text');
  assert.equal(s.graph().intent.context.jobs.startedAt, STAMP);
  assert.equal(s.takeEntries()[0].label, 'Replaced your resume');
});

test('an unreadable file, or none, says so on the card, and the plan starts', () => {
  const unreadable = stager(waiting());

  unreadable.call('jobs.setResume', { status: 'unreadable', start: true });

  const card = unreadable.graph().objects.find((object) => object.id === CARD_ID);

  assert.equal(card.data.text, "Couldn't read that PDF. Try another file.");
  assert.deepEqual(
    card.data.actions.map((action) => action.type),
    ['upload'],
  );
  assert.equal(unreadable.graph().intent.context.jobs.startedAt, NOW);

  const none = stager(waiting());

  none.call('jobs.setResume', { status: 'none', start: true });
  assert.equal(
    none.graph().objects.find((object) => object.id === CARD_ID).data.text,
    'Add your resume',
  );
});
