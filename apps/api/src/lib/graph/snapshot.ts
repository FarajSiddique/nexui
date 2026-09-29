import type { SupabaseClient } from '@supabase/supabase-js';

import type { GraphSnapshot } from '@nexui/types';

import { GraphNotFoundError, mapRpcError } from './errors.ts';
import { mapSnapshotRow } from './mappers.ts';

/** One intent with its workspace and live objects and relationships, read as the user. */
export async function loadSnapshot(db: SupabaseClient, intentId: string): Promise<GraphSnapshot> {
  const { data, error } = await db.rpc('get_intent_snapshot', { p_intent_id: intentId });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data) {
    throw new GraphNotFoundError('Not found.');
  }

  return mapSnapshotRow(data);
}
