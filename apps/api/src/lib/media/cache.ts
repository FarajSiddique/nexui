import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { MediaRow } from './rules.ts';

const COLUMNS = 'key, status, lookup_version, pinned, page_title, page_url, extract, expires_at';

const rowSchema = z.object({
  key: z.string(),
  status: z.enum(['found', 'none', 'failed']),
  lookup_version: z.number().int(),
  pinned: z.boolean(),
  page_title: z.string().nullable(),
  page_url: z.string().nullable(),
  extract: z.string().nullable(),
  expires_at: z.string(),
});

/** A database error from the cache. Keeps only its code, for the log. */
export class MediaCacheError extends Error {
  readonly code: string | undefined;

  constructor(code: string | undefined) {
    super('The place media cache failed.');
    this.code = code;
  }
}

/** The cached rows for some keys, in one query. A row that doesn't parse is left out. */
export async function readRows(
  db: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, MediaRow>> {
  const rows = new Map<string, MediaRow>();

  if (keys.length === 0) {
    return rows;
  }

  const { data, error } = await db
    .from('place_media')
    .select(COLUMNS)
    .in('key', [...keys]);

  if (error) {
    throw new MediaCacheError(error.code);
  }

  for (const raw of data) {
    const parsed = rowSchema.safeParse(raw);

    if (parsed.success) {
      const row = parsed.data;

      rows.set(row.key, {
        key: row.key,
        status: row.status,
        lookupVersion: row.lookup_version,
        pinned: row.pinned,
        pageTitle: row.page_title,
        pageUrl: row.page_url,
        extract: row.extract,
        photo: null,
        credit: null,
        expiresAt: row.expires_at,
      });
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
    photo: null,
    credit: null,
    fetched_at: now.toISOString(),
    expires_at: row.expiresAt,
  });

  if (error) {
    throw new MediaCacheError(error.code);
  }
}
