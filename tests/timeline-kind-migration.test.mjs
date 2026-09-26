// Contract for anchored-shell.md, Slice A "API for slice A": a new migration replaces
// `timeline_page` with one that takes a `kind_filter` argument and does not keep the old
// three-argument signature. Postgres overloads functions by argument list, so "replace"
// means the old `timeline_page(integer, timestamp, uuid)` is dropped.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../supabase/migrations/', import.meta.url);
const EXISTING = [
  '20260924000000_persistence.sql',
  '20260925000000_intent_actions.sql',
  '20260926000000_completed_tasks_leave_lists.sql',
];

// Lower-cased, comment-free, single-spaced SQL of the migration that adds kind_filter.
function kindMigration() {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && !EXISTING.includes(name))
    .sort()
    .map((name) =>
      readFileSync(new URL(name, dir), 'utf8')
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase(),
    )
    .find((sql) => /function public\.timeline_page ?\(/.test(sql) && sql.includes('kind_filter'));
}

test('a new migration defines timeline_page with a kind_filter argument', () => {
  const sql = kindMigration();
  assert.ok(sql, 'no new migration defines public.timeline_page with kind_filter');
  assert.match(sql, /create (or replace )?function public\.timeline_page ?\([^)]*kind_filter/);
});

test('the old three-argument timeline_page is dropped', () => {
  const sql = kindMigration();
  assert.ok(sql, 'no new migration defines public.timeline_page with kind_filter');
  assert.match(
    sql,
    /drop function (if exists )?public\.timeline_page ?\( ?integer, ?timestamp( without time zone)?, ?uuid ?\)/,
  );
});
