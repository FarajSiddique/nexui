import assert from 'node:assert/strict';
import test from 'node:test';

import * as route from '../apps/api/src/app/api/intents/[id]/start/route.ts';
import { jobSearchWorkspace, START_INSIGHT } from '../apps/api/src/lib/jobs/seed.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { authed } from './support/graph-api.mjs';
import { graphDb, toSnapshotRow } from './support/graph-db.mjs';
import { INTENT_ID, RUN_ID, runRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { jobObject, jobSnapshot, SEARCH_ID } from './support/jobs.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = `http://localhost/api/intents/${INTENT_ID}/start`;
const context = { params: Promise.resolve({ id: INTENT_ID }) };
const CARD_ID = 'f5000000-0000-4000-8000-000000000001';
const PDF = '%PDF-1.7\n%a fictional resume\n';

// A job search waiting for its start. Mock mode's `job-search-staff-pm` fixture answers a read
// for this goal; any other goal reads as unreadable.
function waiting({ goal = 'Find a Staff PM role in London', startedAt } = {}) {
  const jobs = { timezone: 'Europe/London', seen: [] };

  if (startedAt) {
    jobs.startedAt = startedAt;
  }

  const snapshot = jobSnapshot({
    doc: jobSearchWorkspace(SEARCH_ID),
    context: { jobs },
    objects: [
      jobObject(CARD_ID, 'insight', START_INSIGHT, {
        title: START_INSIGHT.text,
        source: { type: 'derived' },
      }),
    ],
  });

  return toSnapshotRow({ ...snapshot, intent: { ...snapshot.intent, goal } });
}

function setup(t, row, options = {}) {
  useMockAi(t);

  const tasks = captureRuns(t);
  const fake = graphDb(row, options);

  mockSupabaseAuth(t, fake.fetch);

  return { fake, tasks };
}

function withFile(body, name = 'cv.pdf', type = 'application/pdf') {
  const form = new FormData();

  form.set('file', new File([body], name, { type }));

  return route.POST(authed(url, { method: 'POST', body: form }), context);
}

const withoutFile = () => route.POST(authed(url, { method: 'POST' }), context);
const objectsOf = (fake, kind) =>
  fake.state.snapshot.objects.filter((object) => object.kind === kind);

test('start waits the whole 300 seconds: the build run executes after its response', () => {
  assert.equal(route.maxDuration, 300);
});

test('a readable resume is read once, stored, and the build run queued with its usage', async (t) => {
  const { fake, tasks } = setup(t, waiting());
  const response = await withFile(PDF);
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.intake, 'read');
  assert.equal(body.runId, RUN_ID);
  assert.equal(objectsOf(fake, 'document')[0].data.profile.currentEmployer, 'Ledgerly');
  assert.deepEqual(objectsOf(fake, 'search')[0].data.excludeCompanies, ['Ledgerly']);
  assert.equal(objectsOf(fake, 'insight').length, 0);
  assert.equal(typeof fake.state.snapshot.intent.context.jobs.startedAt, 'string');
  assert.deepEqual(fake.state.createdRun.p_input, {
    text: 'Find a Staff PM role in London',
    route: 'reasoning',
    template: 'job_search',
    perception: 'model',
    intake: { inputTokens: 0, outputTokens: 0, model: 'mock-model-id' },
  });
  assert.equal(fake.state.applied[0].p_actor, 'user');
  assert.equal(tasks.length, 1);
});

test('starting without a file asks for the resume later, and queues the run', async (t) => {
  const { fake, tasks } = setup(t, waiting());
  const response = await withoutFile();

  assert.equal(response.status, 202);
  assert.equal((await response.json()).intake, 'none');
  assert.equal(objectsOf(fake, 'insight')[0].data.text, 'Add your resume');
  assert.equal(fake.state.createdRun.p_input.intake, undefined);
  assert.equal(tasks.length, 1);
});

test('a resume that can’t be read still starts the build, and the card says so', async (t) => {
  t.mock.method(console, 'error', () => {});

  // No fixture matches this goal, so the mock read answers free text.
  const { fake, tasks } = setup(t, waiting({ goal: 'Find a backend role in Austin' }));
  const response = await withFile(PDF);

  assert.equal(response.status, 202);
  assert.equal((await response.json()).intake, 'unreadable');
  assert.equal(
    objectsOf(fake, 'insight')[0].data.text,
    "Couldn't read that PDF. Try another file.",
  );
  assert.equal(tasks.length, 1);
});

test('a plan already started answers 409 while its build is going; nothing is read, written or queued', async (t) => {
  // The fake's one run is the build, queued.
  const { fake, tasks } = setup(t, waiting({ startedAt: '2026-10-20T12:00:00.000Z' }));
  const response = await withFile(PDF);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'This plan has already started.' });
  assert.equal(fake.state.applied.length, 0);
  assert.equal(tasks.length, 0);
});

test('a plan whose build failed starts again: no new read, the resume kept, a new run', async (t) => {
  const { fake, tasks } = setup(t, waiting({ startedAt: '2026-10-20T12:00:00.000Z' }), {
    run: runRow({ status: 'failed', error: "Nexui couldn't finish this." }),
  });
  const response = await withoutFile();

  assert.equal(response.status, 202);
  assert.equal((await response.json()).intake, 'none');
  assert.equal(fake.state.runQueries[0].kind, 'eq.create_intent');
  assert.equal(fake.state.applied.length, 0);
  assert.equal(fake.state.createdRun.p_input.intake, undefined);
  assert.equal(tasks.length, 1);
});

test('a file that isn’t a PDF is a 400, one over 4 MB a 413, and nothing is written', async (t) => {
  const { fake } = setup(t, waiting());
  const notPdf = await withFile('PK\u0003\u0004', 'cv.docx', 'application/zip');

  assert.equal(notPdf.status, 400);
  assert.deepEqual(await notPdf.json(), { error: "That file isn't a PDF." });

  const huge = await withFile(`${PDF}${'x'.repeat(4 * 1024 * 1024)}`);

  assert.equal(huge.status, 413);
  assert.deepEqual(await huge.json(), { error: 'That file is over 4 MB.' });
  assert.equal(fake.state.applied.length, 0);
});

test('a plan with no intake (a trip) answers 400', async (t) => {
  setup(t, snapshotRow(travelWorkspace(TRIP_ID)));

  const response = await withoutFile();

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "That action isn't available." });
});

test('if the run can’t be queued, the start is undone so the user can try again', async (t) => {
  const { fake, tasks } = setup(t, waiting(), { failCreateRun: 'NXU14' });
  const response = await withoutFile();

  assert.equal(response.status, 409);
  assert.ok(fake.state.reverted, 'the start was undone');
  assert.equal(tasks.length, 0);
});

test('start needs a signed-in user', async () => {
  const response = await route.POST(new Request(url, { method: 'POST' }), context);

  assert.equal(response.status, 401);
});
