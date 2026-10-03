import assert from 'node:assert/strict';
import test from 'node:test';

import { ChangesetConflictError, GraphNotFoundError } from '../apps/api/src/lib/graph/errors.ts';
import {
  activeRunIntentIds,
  cancelRun,
  createRun,
  finishRun,
  getRun,
  mapRunRow,
  recordRunStep,
  STALE_RUN_ERROR,
} from '../apps/api/src/lib/runs/store.ts';
import { getUserClient } from '../apps/api/src/lib/supabase/clients.ts';
import { pgError, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, RUN_ID, runRow } from './support/graph.mjs';
import { mockSupabaseAuth, signToken } from './support/supabase-auth.mjs';

function client(t, handlers) {
  mockSupabaseAuth(t, postgrest(handlers));

  return getUserClient(signToken());
}

const input = { text: 'Make Kyoto 3 days', route: 'edit', perception: 'model' };

test('createRun starts a run on the intent', async (t) => {
  let sent;
  const db = client(t, {
    create_run: (args) => {
      sent = args;

      return runRow({ kind: 'ask', input });
    },
  });

  const run = await createRun(db, { intentId: INTENT_ID, kind: 'ask', input });

  assert.deepEqual(sent, { p_intent_id: INTENT_ID, p_kind: 'ask', p_input: input });
  assert.equal(run.id, RUN_ID);
  assert.equal(run.status, 'queued');
  assert.deepEqual(run.input, input);
});

test('a second active run on one intent is refused', async (t) => {
  const db = client(t, { create_run: () => pgError('NXU12') });

  await assert.rejects(
    createRun(db, { intentId: INTENT_ID, kind: 'ask', input }),
    (error) =>
      error instanceof ChangesetConflictError &&
      error.message === 'Nexui is still working on this plan.',
  );
});

test('recordRunStep sends the entries and usage and returns the status', async (t) => {
  const sent = [];
  const db = client(t, {
    record_run_step: (args) => {
      sent.push(args);

      return sent.length === 1 ? 'running' : 'cancelled';
    },
  });
  const entry = {
    step: 0,
    capability: 'object.create',
    label: 'Added Kyoto',
    ok: true,
    ms: 2,
    input: { ref: 'kyoto' },
  };
  const usage = { inputTokens: 10, outputTokens: 2, model: 'anthropic/claude-haiku-4.5' };

  assert.equal(await recordRunStep(db, RUN_ID, [entry], usage), 'running');
  assert.equal(await recordRunStep(db, RUN_ID, [], null), 'cancelled');
  assert.deepEqual(sent, [
    { p_run_id: RUN_ID, p_entries: [entry], p_usage: usage },
    { p_run_id: RUN_ID, p_entries: [], p_usage: {} },
  ]);
});

test('finishRun and cancelRun return the run as it now is', async (t) => {
  let finished;
  const db = client(t, {
    finish_run: (args) => {
      finished = args;

      return runRow({
        status: 'failed',
        error: args.p_error,
        finished_at: new Date().toISOString(),
      });
    },
    cancel_run: () => runRow({ status: 'cancelled', finished_at: new Date().toISOString() }),
  });

  const failed = await finishRun(db, RUN_ID, 'failed', "Nexui couldn't finish this.");

  assert.deepEqual(finished, {
    p_run_id: RUN_ID,
    p_status: 'failed',
    p_error: "Nexui couldn't finish this.",
  });
  assert.equal(failed.status, 'failed');
  assert.equal((await cancelRun(db, RUN_ID)).status, 'cancelled');
});

test('getRun reads the caller’s run, or reports it missing', async (t) => {
  let asked;
  const db = client(t, {
    'table:runs': (url) => {
      asked = url;

      return url.searchParams.get('id') === `eq.${RUN_ID}` ? [runRow()] : [];
    },
  });

  assert.equal((await getRun(db, RUN_ID)).id, RUN_ID);
  assert.equal(asked.searchParams.get('id'), `eq.${RUN_ID}`);
  await assert.rejects(
    getRun(db, 'c0000000-0000-4000-8000-000000000999'),
    (error) => error instanceof GraphNotFoundError,
  );
});

test('a run left queued, running or stopping for 6 minutes reads as failed', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const old = '2026-09-29T11:53:00Z';
  const recent = '2026-09-29T11:55:00Z';

  assert.deepEqual(
    (({ status, error }) => ({ status, error }))(
      mapRunRow(runRow({ status: 'running', created_at: old }), now),
    ),
    { status: 'failed', error: STALE_RUN_ERROR },
  );
  assert.equal(mapRunRow(runRow({ status: 'queued', created_at: old }), now).status, 'failed');
  assert.equal(mapRunRow(runRow({ status: 'stopping', created_at: old }), now).status, 'failed');
  assert.equal(mapRunRow(runRow({ status: 'running', created_at: recent }), now).status, 'running');
  assert.equal(
    mapRunRow(runRow({ status: 'stopping', created_at: recent }), now).status,
    'stopping',
  );
  assert.equal(
    mapRunRow(runRow({ status: 'succeeded', created_at: old }), now).status,
    'succeeded',
  );
});

test('activeRunIntentIds finds intents with a recent active run', async (t) => {
  let asked;
  const db = client(t, {
    'table:runs': (url) => {
      asked = url;

      return [{ intent_id: INTENT_ID }];
    },
  });
  const now = new Date('2026-09-29T12:00:00Z');

  assert.deepEqual([...(await activeRunIntentIds(db, now))], [INTENT_ID]);
  assert.equal(asked.searchParams.get('status'), 'in.(queued,running,stopping)');
  assert.equal(asked.searchParams.get('created_at'), 'gte.2026-09-29T11:54:00.000Z');
});
