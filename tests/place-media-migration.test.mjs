// Static checks on the place media cache: one shared row per place, which only the API's
// secret-key client can read or write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261004140000_place_media.sql', 'utf8');

test('place_media has every column phase 2 needs, with its limits', () => {
  assert.match(sql, /create table public\.place_media \(/);
  assert.match(sql, /key\s+text primary key check \(char_length\(key\) <= 200\)/);
  assert.match(sql, /status\s+text not null check \(status in \('found', 'none', 'failed'\)\)/);
  assert.match(sql, /lookup_version\s+int\s+not null/);
  assert.match(sql, /pinned\s+boolean not null default false/);
  assert.match(sql, /extract\s+text check \(char_length\(extract\) <= 600\)/);
  assert.match(sql, /fetched_at\s+timestamptz not null default now\(\)/);
  assert.match(sql, /expires_at\s+timestamptz not null/);

  for (const column of ['page_title', 'page_url', 'photo', 'credit']) {
    assert.match(sql, new RegExp(`\\n\\s+${column}\\s`), column);
  }
});

test('only the secret-key client can reach it', () => {
  assert.match(sql, /alter table public\.place_media enable row level security;/);
  assert.match(sql, /revoke all on public\.place_media from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\bgrant\b/i);
});

const bucket = readFileSync('supabase/migrations/20261004150000_place_photos_bucket.sql', 'utf8');

test('place-photos is a public bucket of JPEG, PNG and WebP files up to 2 MB', () => {
  assert.match(
    bucket,
    /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/,
  );
  assert.match(bucket, /'place-photos', 'place-photos', true, 2097152,/);
  assert.match(bucket, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(bucket, /on conflict \(id\) do update/);
});

test('no policy lets an app user list, upload or change photos', () => {
  assert.doesNotMatch(bucket, /create policy/i);
  assert.doesNotMatch(bucket, /\bgrant\b/i);
});
