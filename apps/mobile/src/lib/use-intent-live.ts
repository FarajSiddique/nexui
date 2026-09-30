import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { editKey, queryKeys } from './queries';
import { supabase } from './supabase';

const TABLES = ['objects', 'relationships', 'workspaces', 'runs', 'events'] as const;

/**
 * Keeps an open intent current while the server writes to it without the client asking (a run
 * filling it in). Realtime, scoped by RLS, is only the signal: a burst of row changes becomes
 * one refetch of the API's snapshot, which stays the source of truth. The run, intents and
 * changes lists are always refetched, since they can't disturb an optimistic edit. The intent
 * snapshot itself waits while the user's own edits are in flight (so a refetch can't briefly
 * undo an optimistic change) by re-arming the timer until they settle, rather than dropping the
 * signal.
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

        void client.invalidateQueries({ queryKey: queryKeys.runs });
        void client.invalidateQueries({ queryKey: queryKeys.intents });
        void client.invalidateQueries({ queryKey: queryKeys.changes });

        if (client.isMutating({ mutationKey: editKey(intentId) }) > 0) {
          refresh();

          return;
        }

        void client.invalidateQueries({ queryKey: queryKeys.intent(intentId) });
      }, 300);
    };

    // A fresh topic per mount: `supabase.channel` returns an existing channel for a topic
    // already in use, which throws on a second `.on(...)` call for a remount of the same intent,
    // or leaves a quick remount without a subscription while the old one is still leaving.
    const channel = supabase.channel(`intent-${intentId}-${Math.random().toString(36).slice(2)}`);

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
