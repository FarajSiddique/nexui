// Static checks on the intent graph migration: writers are functions only, every function
// pins search_path, and definer functions check the caller.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260927000000_intent_graph.sql', 'utf8');
const tables = ['intents', 'objects', 'relationships', 'events', 'workspaces', 'runs'];
const functions = [...sql.matchAll(/create function ([\w.]+)\(([\s\S]*?)\n\$\$;/g)];

test('all six tables exist with RLS on', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated`), table);
  }
});

test('clients cannot write any graph table directly', () => {
  assert.match(
    sql,
    /revoke all on\s+public\.intents, public\.objects, public\.relationships, public\.events, public\.workspaces, public\.runs\s+from anon, authenticated;/,
  );
  assert.match(
    sql,
    /grant select on\s+public\.intents, public\.objects, public\.relationships, public\.events, public\.workspaces, public\.runs\s+to authenticated;/,
  );
  assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
  assert.doesNotMatch(sql, /for (insert|update|delete|all) to/i);
});

test('every function pins search_path; definer functions check auth.uid()', () => {
  assert.ok(functions.length >= 8, `found ${functions.length} functions`);

  for (const [, name, body] of functions) {
    assert.match(body, /set search_path = ''/, `${name} search_path`);

    if (/security definer/.test(body)) {
      assert.match(body, /auth\.uid\(\)/, `${name} checks the caller`);
    }
  }
});

test('the private schema is closed and the public writers are for signed-in users only', () => {
  assert.match(sql, /revoke all on schema private from public, anon, authenticated;/);

  for (const name of [
    'create_intent',
    'apply_changeset',
    'revert_event',
    'get_intent_snapshot',
    'changes_page',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`),
      name,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`),
      name,
    );
  }
});

test('Realtime publishes the tables the app subscribes to', () => {
  assert.match(
    sql,
    /alter publication supabase_realtime add table\s+public\.objects, public\.relationships, public\.workspaces, public\.events, public\.runs;/,
  );
});

test('private helpers are not callable by any client role', () => {
  const revoke = sql.indexOf(
    'revoke execute on all functions in schema private from public, anon, authenticated;',
  );

  assert.ok(revoke > -1, 'private functions are revoked');
  assert.ok(revoke > sql.lastIndexOf('create function private.'), 'after every private function');
});

test('apply_changeset takes the expected activity time, with no older overload', () => {
  assert.match(
    sql,
    /create function public\.apply_changeset\(\s*p_intent_id uuid,\s*p_actor text,\s*p_run_id uuid,\s*p_ops jsonb,\s*p_expected_activity_at timestamptz default null\s*\)/,
  );
  assert.equal(sql.match(/create function public\.apply_changeset\(/g).length, 1);

  const privileges = sql.match(/(grant|revoke) execute on function public\.apply_changeset\([^)]*\)/g);

  assert.equal(privileges.length, 2);

  for (const statement of privileges) {
    assert.match(statement, /\(uuid, text, uuid, jsonb, timestamptz\)$/, statement);
  }
});
