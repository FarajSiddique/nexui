// Static checks on the stopping migration: Stop lets the step in flight finish, nothing new
// starts meanwhile, and every function keeps the usual guards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261003000000_run_stopping.sql', 'utf8');
const bodyOf = (name) =>
  sql.match(
    new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\n\\$\\$;`),
  )?.[1];

test('runs may be stopping', () => {
  assert.match(
    sql,
    /check \(status in \('queued', 'running', 'stopping', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'\)\)/,
  );
});

test('Stop moves a running run to stopping and cancels anything else at once', () => {
  const body = bodyOf('cancel_run');

  assert.ok(body);
  assert.match(
    body,
    /status = case when r\.status = 'running' then 'stopping' else 'cancelled' end/,
  );
  assert.match(body, /r\.status in \('queued', 'running', 'awaiting_approval'\)/);
});

test('a stopping run blocks a new run and still records its last step', () => {
  assert.match(bodyOf('create_run'), /r\.status in \('queued', 'running', 'stopping'\)/);
  assert.match(bodyOf('create_run'), /interval '6 minutes'/);
  assert.match(bodyOf('record_run_step'), /not in \('queued', 'running', 'stopping'\)/);
  assert.match(bodyOf('record_run_step'), /when r\.status = 'stopping' then 'stopping'/);
});

test('finish_run ends a stopping run cancelled, or failed when its last step failed', () => {
  const body = bodyOf('finish_run');

  assert.match(body, /not in \('succeeded', 'failed', 'cancelled'\)/);
  assert.match(body, /when r\.status = 'stopping' and p_status = 'failed' then 'failed'/);
  assert.match(body, /when r\.status = 'stopping' then 'cancelled'/);
});

test('every function pins search_path, checks the caller and is for signed-in users only', () => {
  for (const name of ['create_run', 'record_run_step', 'finish_run', 'cancel_run']) {
    const body = bodyOf(name);

    assert.ok(body, name);
    assert.match(body, /security definer/, name);
    assert.match(body, /set search_path = ''/, name);
    assert.match(body, /caller uuid := auth\.uid\(\);/, name);
    assert.match(body, /r\.user_id = caller|i\.user_id = caller/, name);
  }

  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /create policy/i);
});
