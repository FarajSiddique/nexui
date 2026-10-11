import assert from 'node:assert/strict';
import test from 'node:test';

import * as route from '../apps/api/src/app/api/intents/[id]/resume/route.ts';
import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { authed } from './support/graph-api.mjs';
import { graphDb, toSnapshotRow } from './support/graph-db.mjs';
import { INTENT_ID } from './support/graph.mjs';
import { jobSnapshot, SEARCH_ID } from './support/jobs.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = `http://localhost/api/intents/${INTENT_ID}/resume`;
const context = { params: Promise.resolve({ id: INTENT_ID }) };
const PDF = '%PDF-1.7\n%a fictional resume\n';

function plan({ goal = 'Find a Staff PM role in London', started = true } = {}) {
  const jobs = { timezone: 'Europe/London', seen: [] };

  if (started) {
    jobs.startedAt = '2026-10-20T12:00:00.000Z';
  }

  const snapshot = jobSnapshot({ doc: jobSearchWorkspace(SEARCH_ID), context: { jobs } });

  return toSnapshotRow({ ...snapshot, intent: { ...snapshot.intent, goal } });
}

function setup(t, row) {
  useMockAi(t);

  const tasks = captureRuns(t);
  const fake = graphDb(row);

  mockSupabaseAuth(t, fake.fetch);

  return { fake, tasks };
}

function upload(body = PDF) {
  const form = new FormData();

  form.set('file', new File([body], 'cv.pdf', { type: 'application/pdf' }));

  return route.POST(authed(url, { method: 'POST', body: form }), context);
}

test('resume waits only for its read: 90 seconds', () => {
  assert.equal(route.maxDuration, 90);
});

test('a later resume is stored as one changeset, and no run starts', async (t) => {
  const { fake, tasks } = setup(t, plan());
  const response = await upload();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.event.id.length, 36);
  assert.equal(
    fake.state.snapshot.objects.filter((object) => object.kind === 'document').length,
    1,
  );
  assert.equal(fake.state.applied.length, 1);
  assert.equal(fake.state.applied[0].p_payload.label, 'Added your resume');
  assert.equal(tasks.length, 0);
});

test('a resume that can’t be read changes nothing: 400 with the reason', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake } = setup(t, plan({ goal: 'Find a backend role in Austin' }));
  const response = await upload();

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Couldn't read that PDF. Try another file." });
  assert.equal(fake.state.applied.length, 0);
});

test('a plan not yet started takes its resume through start; no file is a 400', async (t) => {
  setup(t, plan({ started: false }));

  const early = await upload();

  assert.equal(early.status, 409);
  assert.deepEqual(await early.json(), { error: 'Start this plan first.' });

  const empty = await route.POST(authed(url, { method: 'POST' }), context);

  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Add a PDF.' });
});
