import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { editKey, queryKeys } from './queries';
import { supabase } from './supabase';

const TABLES = ['objects', 'relationships', 'workspaces', 'runs', 'events'] as const;

/**
 * Keeps an open intent current while the server writes to it without the client asking (a run
 * filling it in). Realtime, scoped by RLS, is only the signal: a burst of row changes becomes
 * one refetch of the API's snapshot, which stays the source of truth. Refetches wait while the
 * user's own edits are in flight, so a refetch can't briefly undo an optimistic change.
 */
export function useIntentLive(intentId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!intentId) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = (): void => {
      if (timer) {
        return;
      }

      timer = setTimeout(() => {
        timer = null;

        if (client.isMutating({ mutationKey: editKey(intentId) }) > 0) {
          return;
        }

        void client.invalidateQueries({ queryKey: queryKeys.intent(intentId) });
        void client.invalidateQueries({ queryKey: queryKeys.runs });
        void client.invalidateQueries({ queryKey: queryKeys.intents });
        void client.invalidateQueries({ queryKey: queryKeys.changes });
      }, 300);
    };

    const channel = supabase.channel(`intent-${intentId}`);

    for (const table of TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `intent_id=eq.${intentId}` },
        refresh,
      );
    }

    channel.subscribe();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }

      void supabase.removeChannel(channel);
    };
  }, [client, intentId]);
}
