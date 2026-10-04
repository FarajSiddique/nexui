import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { createIntentChannels } from './intent-channel';
import { editKey, queryKeys } from './queries';
import { supabase } from './supabase';

const intentChannels = createIntentChannels(supabase);

/**
 * Keeps an open intent current while the server writes to it without the client asking (a run
 * filling it in). The database broadcasts a `changed` signal on the intent's private channel for
 * each changeset and run write; a burst of signals becomes one refresh. The run, intents and
 * changes lists are always refetched, since they can't disturb an optimistic edit. The intent
 * snapshot itself waits while the user's own edits are in flight (so a refetch can't briefly
 * undo an optimistic change) by re-arming only its own retry until they settle, rather than
 * dropping the signal or repeating the list refresh. Every join runs the same catch-up,
 * including a rejoin after a dropped socket or a `CHANNEL_ERROR`/`TIMED_OUT`, since Broadcast
 * doesn't replay what was sent while disconnected.
 */
export function useIntentLive(intentId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!intentId) {
      return;
    }

    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    let intentTimer: ReturnType<typeof setTimeout> | null = null;

    // One retry chain at a time, so cleanup always clears the live timer.
    const catchUpIntent = (): void => {
      if (intentTimer) {
        clearTimeout(intentTimer);
        intentTimer = null;
      }

      if (client.isMutating({ mutationKey: editKey(intentId) }) > 0) {
        intentTimer = setTimeout(catchUpIntent, 300);

        return;
      }

      void client.invalidateQueries({ queryKey: queryKeys.intent(intentId) });
    };

    const catchUp = (): void => {
      void client.invalidateQueries({ queryKey: queryKeys.runs });
      void client.invalidateQueries({ queryKey: queryKeys.intents });
      void client.invalidateQueries({ queryKey: queryKeys.changes });
      catchUpIntent();
    };

    const onChange = (): void => {
      if (burstTimer) {
        return;
      }

      burstTimer = setTimeout(() => {
        burstTimer = null;
        catchUp();
      }, 300);
    };

    const release = intentChannels.watch(intentId, { onChange, onSubscribed: catchUp });

    return () => {
      if (burstTimer) {
        clearTimeout(burstTimer);
      }

      if (intentTimer) {
        clearTimeout(intentTimer);
      }

      release();
    };
  }, [client, intentId]);
}
