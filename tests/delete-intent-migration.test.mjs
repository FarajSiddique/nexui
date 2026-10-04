// Static checks on the delete migration: a user deletes their own plan with everything under it,
// but not while a run is still writing to it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261004000000_delete_intent.sql', 'utf8');
const body = sql.match(/create function public\.delete_intent\(([\s\S]*?)\n\$\$;/)?.[1];

test('delete_intent deletes only the caller’s intent', () => {
  assert.ok(body, 'the migration creates delete_intent');
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /caller uuid := auth\.uid\(\);/);
  assert.match(body, /where i\.id = p_intent_id and i\.user_id = caller\s+for update;/);
  assert.match(body, /raise exception 'Not found' using errcode = 'NXU04';/);
  assert.match(
    body,
    /delete from public\.intents i\s+where i\.id = p_intent_id and i\.user_id = caller;/,
  );
});

test('delete_intent refuses while a run is working, like create_run', () => {
  assert.match(body, /r\.status in \('queued', 'running', 'stopping'\)/);
  assert.match(body, /r\.created_at > now\(\) - interval '6 minutes'/);
  assert.match(body, /using errcode = 'NXU12'/);
  assert.ok(
    body.indexOf("errcode = 'NXU12'") < body.indexOf('delete from public.intents'),
    'the run check comes before the delete',
  );
});

test('delete_intent is for signed-in users only and grants no table writes', () => {
  assert.match(sql, /revoke execute on function public\.delete_intent\(uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.delete_intent\(uuid\) to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /create policy/i);
});
