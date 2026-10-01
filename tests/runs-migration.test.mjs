// Static checks on the run functions: callers are checked, search_path is pinned, and only
// signed-in users may call them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260929000000_runs.sql', 'utf8');
const functions = new Map(
  [...sql.matchAll(/create function public\.(\w+)\(([\s\S]*?)\n\$\$;/g)].map(([, name, body]) => [
    name,
    body,
  ]),
);
const signatures = {
  create_run: 'uuid, text, jsonb',
  record_run_step: 'uuid, jsonb, jsonb',
  finish_run: 'uuid, text, text',
  cancel_run: 'uuid',
};

test('the four run functions exist, pin search_path and check the caller', () => {
  assert.deepEqual([...functions.keys()].sort(), Object.keys(signatures).sort());

  for (const [name, body] of functions) {
    assert.match(body, /security definer/, name);
    assert.match(body, /set search_path = ''/, name);
    assert.match(body, /caller uuid := auth\.uid\(\);/, name);
    assert.match(body, /r\.user_id = caller|i\.user_id = caller/, `${name} scopes to the caller`);
  }
});

test('only signed-in users may call them', () => {
  for (const [name, args] of Object.entries(signatures)) {
    const signature = `public\\.${name}\\(${args}\\)`;

    assert.match(sql, new RegExp(`revoke execute on function ${signature} from public, anon;`));
    assert.match(sql, new RegExp(`grant execute on function ${signature} to authenticated;`));
  }
});

test('clients still get no direct writes', () => {
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /create policy/i);
});

test('one active run per intent, and stale runs stop counting after 6 minutes', () => {
  const cutoff = readFileSync('supabase/migrations/20260930000000_run_cutoff.sql', 'utf8');
  const body = cutoff.match(
    /create or replace function public\.create_run\(([\s\S]*?)\n\$\$;/,
  )?.[1];

  assert.ok(body, 'the cutoff migration redefines create_run');
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /errcode = 'NXU12'/);
  assert.match(body, /interval '6 minutes'/);
  assert.match(body, /for update/);
  assert.doesNotMatch(cutoff, /grant (insert|update|delete|all)/i);
});
