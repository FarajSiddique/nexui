// Static checks on the changeset payload: both commit functions take it last with a default (so
// an API that doesn't send it keeps working), keep their grants, and store it only through the
// checked helper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261005000000_changeset_payload.sql', 'utf8');
const bodyOf = (schema, name) =>
  sql.match(new RegExp(`create function ${schema}\\.${name}\\(([\\s\\S]*?)\\n\\$\\$;`))?.[1];

test('both commit functions replace their old signature and take the payload last', () => {
  assert.match(
    sql,
    /drop function public\.apply_changeset\(uuid, text, uuid, jsonb, timestamptz\);/,
  );
  assert.match(sql, /drop function public\.run_apply_changeset\(uuid, uuid, jsonb, timestamptz\);/);

  for (const name of ['apply_changeset', 'run_apply_changeset']) {
    const body = bodyOf('public', name);

    assert.ok(body, name);
    assert.match(
      body,
      /p_expected_activity_at timestamptz default null,\s*p_payload jsonb default '\{\}'\s*\)/,
      name,
    );
    assert.match(body, /security definer/, name);
    assert.match(body, /set search_path = ''/, name);
    assert.match(body, /return private\.set_event_payload\(\s*private\.apply_ops\(/, name);
  }
});

test('users commit through apply_changeset, and only the worker through run_apply_changeset', () => {
  const user = 'public\\.apply_changeset\\(uuid, text, uuid, jsonb, timestamptz, jsonb\\)';
  const run = 'public\\.run_apply_changeset\\(uuid, uuid, jsonb, timestamptz, jsonb\\)';

  assert.match(sql, new RegExp(`revoke execute on function ${user}\\s+from public, anon;`));
  assert.match(sql, new RegExp(`grant execute on function ${user}\\s+to authenticated;`));
  assert.match(
    sql,
    new RegExp(`revoke execute on function ${run}\\s+from public, anon, authenticated;`),
  );
  assert.match(sql, new RegExp(`grant execute on function ${run}\\s+to service_role;`));
  assert.match(
    sql,
    /revoke execute on function private\.set_event_payload\(jsonb, jsonb\)\s+from public, anon, authenticated;/,
  );
});

test('a payload is a small JSON object, set on the event just logged', () => {
  const body = bodyOf('private', 'set_event_payload');

  assert.ok(body);
  assert.match(body, /jsonb_typeof\(p_payload\) <> 'object' or length\(p_payload::text\) > 4000/);
  assert.match(body, /errcode = 'NXU22'/);
  assert.match(body, /where e\.id = \(p_event ->> 'id'\)::uuid/);
  assert.match(body, /returning \* into strict logged/, 'a missing event raises, not a null row');
  assert.doesNotMatch(body, /security definer/);
});

test('a user commits only to their own intent, and only with their own run', () => {
  const body = bodyOf('public', 'apply_changeset');

  assert.match(body, /caller uuid := auth\.uid\(\)/);
  assert.match(body, /if caller is null then\s+raise exception 'Sign in to continue'/);
  assert.match(body, /where i\.id = p_intent_id and i\.user_id = caller\s+for update/);
  assert.match(body, /r\.id = p_run_id and r\.user_id = caller/);
  assert.match(body, /errcode = 'NXU04'/);
  assert.match(body, /errcode = 'NXU08'/);
  assert.match(body, /errcode = 'NXU22'/);
});

test('a run still commits as itself, holding its lease', () => {
  const body = bodyOf('public', 'run_apply_changeset');

  assert.doesNotMatch(body, /p_intent_id|p_actor|p_user/);
  assert.match(
    body,
    /private\.apply_ops\(found_run\.user_id, found_run\.intent_id, 'ai', found_run\.id, p_ops\)/,
  );
  assert.match(body, /p_lease_id is null\s+or found_run\.lease_id is distinct from p_lease_id/);
  assert.match(body, /found_run\.lease_expires_at <= now\(\)/);
  assert.match(body, /status not in \('running', 'stopping'\)/);
  assert.match(body, /errcode = 'NXU13'/);
  assert.match(body, /errcode = 'NXU08'/);
  assert.doesNotMatch(body, /auth\.uid\(\)/, 'a run never trusts a caller id');
});
