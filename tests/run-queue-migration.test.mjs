// Static checks on the run queue: only the service role may claim, record, commit as or reap a
// run; every worker write checks the lease; clients lose the step and finish writers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261004130000_run_queue.sql', 'utf8');
const bodyOf = (name) =>
  sql.match(new RegExp(`function public\\.${name}\\(([\\s\\S]*?)\\n\\$\\$;`))?.[1];
const workerFunctions = {
  claim_runs: 'uuid, integer, integer, integer',
  run_record_step: 'uuid, uuid, jsonb, jsonb',
  run_finish: 'uuid, uuid, text, text',
  run_apply_changeset: 'uuid, uuid, jsonb, timestamptz',
  reap_runs: '',
};

test('the worker functions pin search_path and are the service role’s alone', () => {
  for (const [name, args] of Object.entries(workerFunctions)) {
    const body = bodyOf(name);
    const signature = `public\\.${name}\\(${args}\\)`;

    assert.ok(body, name);
    assert.match(body, /security definer/, name);
    assert.match(body, /set search_path = ''/, name);
    assert.doesNotMatch(body, /auth\.uid\(\)/, `${name} never trusts a caller id`);
    assert.match(
      sql,
      new RegExp(`revoke execute on function ${signature}\\s+from public, anon, authenticated;`),
      name,
    );
    assert.match(sql, new RegExp(`grant execute on function ${signature}\\s+to service_role;`));
  }
});

test('every write as a run checks its lease', () => {
  for (const name of ['run_record_step', 'run_finish', 'run_apply_changeset']) {
    const body = bodyOf(name);

    assert.match(body, /lease_id is distinct from p_lease_id/, name);
    assert.match(body, /errcode = 'NXU13'/, name);
  }
});

test('a run commits as itself: user, intent and actor come from the run row', () => {
  const body = bodyOf('run_apply_changeset');

  assert.doesNotMatch(body, /p_intent_id|p_actor|p_user/);
  assert.match(
    body,
    /private\.apply_ops\(found_run\.user_id, found_run\.intent_id, 'ai', found_run\.id, p_ops\)/,
  );
  assert.match(body, /status not in \('running', 'stopping'\)/);
  assert.match(body, /errcode = 'NXU08'/);
});

test('claims are exclusive, capped and kept inside the deadline', () => {
  const body = bodyOf('claim_runs');

  assert.match(body, /for update skip locked/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /p_max_active - count\(\*\)/);
  assert.match(body, /r\.lease_id is null/);
  assert.match(body, /interval '15 minutes'/);
  assert.match(body, /interval '10 seconds'/);
});

test('the reaper retries a run once, only if it committed nothing', () => {
  const body = bodyOf('reap_runs');

  assert.match(body, /attempts >= 2/);
  assert.match(body, /exists \(select 1 from public\.events e where e\.run_id = found_run\.id\)/);
  assert.match(body, /'This run stopped unexpectedly\.'/);
  assert.match(body, /for update skip locked/);
});

test('clients can no longer record steps or finish runs, and get no direct writes', () => {
  assert.match(sql, /drop function public\.record_run_step\(uuid, jsonb, jsonb\);/);
  assert.match(sql, /drop function public\.finish_run\(uuid, text, text\);/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /to authenticated/);
});

test('create_run and delete_intent count a run as working for 15 minutes', () => {
  for (const name of ['create_run', 'delete_intent']) {
    const body = bodyOf(name);

    assert.ok(body, name);
    assert.match(body, /caller uuid := auth\.uid\(\);/, name);
    assert.match(body, /interval '15 minutes'/, name);
    assert.match(body, /errcode = 'NXU12'/, name);
  }
});
