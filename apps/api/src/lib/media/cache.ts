import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { photoCreditSchema } from '@nexui/types';

import type { MediaRow } from './rules.ts';

const COLUMNS =
  'key, status, lookup_version, pinned, page_title, page_url, extract, photo, credit, expires_at';

// Keys per query: a PostgREST filter rides in the URL, and Home can ask for 300 keys.
const KEYS_PER_QUERY = 100;

const rowSchema = z.object({
  key: z.string(),
  status: z.enum(['found', 'none', 'failed']),
  lookup_version: z.number().int(),
  pinned: z.boolean(),
  page_title: z.string().nullable(),
  page_url: z.string().nullable(),
  extract: z.string().nullable(),
  photo: z.unknown(),
  credit: z.unknown(),
  expires_at: z.string(),
});

// `place_media.photo`. An operator may edit it by hand, so it's checked like the rest.
const storedPhotoSchema = z.object({
  path: z.string().min(1).max(200),
  thumbPath: z.string().min(1).max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** A database error from the cache. Keeps only its code, for the log. */
export class MediaCacheError extends Error {
  readonly code: string | undefined;

  constructor(code: string | undefined) {
    super('The place media cache failed.');
    this.code = code;
  }
}

/** The cached rows for some keys, 100 keys per query. A row that doesn't parse is left out. */
export async function readRows(
  db: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, MediaRow>> {
  const rows = new Map<string, MediaRow>();
  const chunks: string[][] = [];

  for (let start = 0; start < keys.length; start += KEYS_PER_QUERY) {
    chunks.push(keys.slice(start, start + KEYS_PER_QUERY));
  }

  const answers = await Promise.all(
    chunks.map((chunk) => db.from('place_media').select(COLUMNS).in('key', chunk)),
  );

  for (const { data, error } of answers) {
    if (error) {
      throw new MediaCacheError(error.code);
    }

    for (const raw of data) {
      const parsed = rowSchema.safeParse(raw);

      if (parsed.success) {
        const row = parsed.data;
        const photo = storedPhotoSchema.safeParse(row.photo);
        const credit = photoCreditSchema.safeParse(row.credit);

        rows.set(row.key, {
          key: row.key,
          status: row.status,
          lookupVersion: row.lookup_version,
          pinned: row.pinned,
          pageTitle: row.page_title,
          pageUrl: row.page_url,
          extract: row.extract,
          photo: photo.success ? photo.data : null,
          credit: credit.success ? credit.data : null,
          expiresAt: row.expires_at,
        });
      }
    }
  }

  return rows;
}

/** Writes one lookup's result. `pinned` is never sent, so an operator's pin survives. */
export async function saveRow(db: SupabaseClient, row: MediaRow, now: Date): Promise<void> {
  const { error } = await db.from('place_media').upsert({
    key: row.key,
    status: row.status,
    lookup_version: row.lookupVersion,
    page_title: row.pageTitle,
    page_url: row.pageUrl,
    extract: row.extract,
    photo: row.photo,
    credit: row.credit,
    fetched_at: now.toISOString(),
    expires_at: row.expiresAt,
  });

  if (error) {
    throw new MediaCacheError(error.code);
  }
}
