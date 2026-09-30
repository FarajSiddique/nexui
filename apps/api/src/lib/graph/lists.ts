import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChangesQuery, ChangesResponse, IntentListItem, IntentSummary } from '@nexui/types';

import { activeRunIntentIds } from '../runs/store.ts';
import { mapRpcError } from './errors.ts';
import { mapChangeRow, mapIntentListRow } from './mappers.ts';

const DRAFTING: NonNullable<IntentSummary['badge']> = { text: 'Drafting', tone: 'running' };

/**
 * Home's cards: the user's intents that aren't archived, most recently active first. An intent
 * with a run still working on it shows "Drafting" instead of its own badge (spec section D).
 */
export async function listIntents(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<IntentListItem[]> {
  const [{ data, error }, drafting] = await Promise.all([
    db
      .from('intents')
      .select('id, goal, template, status, summary, last_activity_at')
      .neq('status', 'archived')
      .order('last_activity_at', { ascending: false })
      .limit(100),
    activeRunIntentIds(db, now),
  ]);

  if (error) {
    throw mapRpcError(error);
  }

  return (data ?? []).map((row) => {
    const item = mapIntentListRow(row);

    return drafting.has(item.id)
      ? { ...item, summary: { ...item.summary, badge: DRAFTING } }
      : item;
  });
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
