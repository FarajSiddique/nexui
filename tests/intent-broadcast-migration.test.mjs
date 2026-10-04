// Static checks on Broadcast: one signal per changeset and run write on a private topic, only
// the owner may join it, nobody may send on it, and postgres_changes is off for the graph.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261004120000_intent_broadcast.sql', 'utf8');

test('the trigger function sends a private signal on the intent topic', () => {
  const body = sql.match(
    /create function private\.broadcast_intent_change\(\)([\s\S]*?)\n\$\$;/,
  )?.[1];

  assert.ok(body);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /realtime\.send\(/);
  assert.match(body, /'intent:' \|\| new\.intent_id::text,\s+true/);
  assert.match(body, /jsonb_build_object\('table', tg_table_name\)/);
  assert.match(
    sql,
    /revoke execute on function private\.broadcast_intent_change\(\) from public, anon, authenticated;/,
  );
});

test('changesets and run writes broadcast, once per row of events or runs', () => {
  assert.match(sql, /create trigger events_broadcast after insert on public\.events/);
  assert.match(sql, /create trigger runs_broadcast after insert or update on public\.runs/);
  assert.equal(sql.match(/when \(new\.intent_id is not null\)/g)?.length, 2);
  assert.doesNotMatch(sql, /on public\.(objects|relationships|workspaces)/);
});

test('only the owner may join an intent topic, and nobody may send on one', () => {
  const policy = sql.match(/create policy "Owners join their intent topics"([\s\S]*?);\n/)?.[1];

  assert.ok(policy);
  assert.match(policy, /on realtime\.messages\s+for select to authenticated/);
  assert.match(policy, /extension = 'broadcast'/);
  assert.match(policy, /i\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(policy, /case\s+when realtime\.topic\(\) ~ '\^intent:/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i);
});

test('postgres_changes is off for every graph table', () => {
  assert.match(
    sql,
    /alter publication supabase_realtime drop table\s+public\.objects, public\.relationships, public\.workspaces, public\.events, public\.runs;/,
  );
});
