import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChangesQuery, ChangesResponse, IntentListItem } from '@nexui/types';

import { mapRpcError } from './errors.ts';
import { mapChangeRow, mapIntentListRow } from './mappers.ts';

/** Home's cards: the user's intents that aren't archived, most recently active first. */
export async function listIntents(db: SupabaseClient): Promise<IntentListItem[]> {
  const { data, error } = await db
    .from('intents')
    .select('id, goal, template, status, summary, last_activity_at')
    .neq('status', 'archived')
    .order('last_activity_at', { ascending: false })
    .limit(100);

  if (error) {
    throw mapRpcError(error);
  }

  return (data ?? []).map(mapIntentListRow);
}

/** One page of Changes, newest first. A full page means there may be more. */
export async function listChanges(
  db: SupabaseClient,
  query: ChangesQuery,
): Promise<ChangesResponse> {
  const { data, error } = await db.rpc('changes_page', {
    p_limit: query.limit,
    p_before_seq: query.cursor ?? null,
    p_intent_id: query.intentId ?? null,
  });

  if (error) {
    throw mapRpcError(error);
  }

  const items = ((data ?? []) as unknown[]).map(mapChangeRow);
  const last = items.at(-1);

  return {
    items,
    nextCursor: items.length === query.limit && last ? String(last.seq) : null,
  };
}
