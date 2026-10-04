import type { SupabaseClient } from '@supabase/supabase-js';

import { storageUrlSchema, type IntentListItem } from '@nexui/types';

import { logLine } from '#lib/graph';

import { readRows } from './cache.ts';
import type { MediaRow } from './rules.ts';
import { publicPhotoUrl } from './storage.ts';

/** A Home card shows the photos of its plan's first three stops (spec section 4). */
const CARD_STOPS = 3;

function cardKeys(item: IntentListItem): string[] {
  return (item.summary.strip ?? [])
    .slice(0, CARD_STOPS)
    .flatMap((stop) => (stop.key ? [stop.key] : []));
}

// A stop's 500px photo URL from its cached row, or nothing.
function cardPhoto(db: SupabaseClient, row: MediaRow | undefined): string[] {
  if (row?.status !== 'found' || !row.photo || !row.credit) {
    return [];
  }

  const url = storageUrlSchema.safeParse(publicPhotoUrl(db, row.photo.thumbPath));

  return url.success ? [url.data] : [];
}

/**
 * Home's cards with their photos (spec section 4): the 500px copies of each plan's first three
 * stops, read from the cache in one go. Nothing is looked up, so Home stays fast. A stop with
 * no cached photo, or a summary from before photos, is simply left out, and expired rows still
 * count, since stored files never move. A failed read is logged, and the cards keep no photos.
 */
export async function withHomePhotos(
  db: SupabaseClient,
  items: IntentListItem[],
): Promise<IntentListItem[]> {
  const keys = [...new Set(items.flatMap(cardKeys))];

  if (keys.length === 0) {
    return items;
  }

  let rows: Map<string, MediaRow>;

  try {
    rows = await readRows(db, keys);
  } catch (error) {
    console.error('[media]', logLine(error, 'Could not load Home photos'));

    return items;
  }

  return items.map((item) => ({
    ...item,
    photos: cardKeys(item).flatMap((key) => cardPhoto(db, rows.get(key))),
  }));
}
