/**
 * The part of a Realtime channel this module uses; supabase-js's `RealtimeChannel` fits it.
 */
export interface BroadcastChannel {
  on(type: 'broadcast', filter: { event: string }, callback: () => void): BroadcastChannel;
  subscribe(callback: (status: string) => void): BroadcastChannel;
}

/** The part of the Supabase client this module uses: `supabase` itself in the app. */
export interface IntentRealtime {
  channel(topic: string, options: { config: { private: boolean } }): BroadcastChannel;
  removeChannel(channel: BroadcastChannel): Promise<unknown>;
}

export interface IntentWatcher {
  /** Something on the intent changed: refetch it. */
  onChange(): void;
  /** The channel (re)joined. Broadcast doesn't replay what was sent while disconnected. */
  onSubscribed(): void;
}

export interface IntentChannels {
  /** Starts watching one intent. Returns the release; calling it twice is harmless. */
  watch(intentId: string, watcher: IntentWatcher): () => void;
}

interface OpenChannel {
  channel: BroadcastChannel;
  watchers: Set<IntentWatcher>;
  subscribed: boolean;
}

/**
 * Shares one private Broadcast channel per intent, `intent:<id>`, among everything watching it.
 * The database sends a `changed` signal there for each changeset and run write, and Realtime lets
 * only the intent's owner join. Realtime keeps one channel per topic and hands back an existing
 * one, even one still leaving, so the last release removes the channel and a watch that arrives
 * during that removal waits for it before opening a fresh one.
 *
 * @example
 * const channels = createIntentChannels(supabase);
 * const release = channels.watch(intentId, { onChange: refetch, onSubscribed: refetch });
 */
export function createIntentChannels(realtime: IntentRealtime): IntentChannels {
  const open = new Map<string, OpenChannel>();
  const leaving = new Map<string, Promise<unknown>>();

  const join = (intentId: string): OpenChannel => {
    const entry: OpenChannel = {
      channel: realtime.channel(`intent:${intentId}`, { config: { private: true } }),
      watchers: new Set(),
      subscribed: false,
    };

    entry.channel
      .on('broadcast', { event: 'changed' }, () => {
        for (const watcher of entry.watchers) {
          watcher.onChange();
        }
      })
      .subscribe((status) => {
        entry.subscribed = status === 'SUBSCRIBED';

        if (entry.subscribed) {
          for (const watcher of entry.watchers) {
            watcher.onSubscribed();
          }
        }
      });
    open.set(intentId, entry);

    return entry;
  };

  const add = (intentId: string, watcher: IntentWatcher): void => {
    const entry = open.get(intentId) ?? join(intentId);

    entry.watchers.add(watcher);

    if (entry.subscribed) {
      watcher.onSubscribed();
    }
  };

  const remove = (intentId: string, watcher: IntentWatcher): void => {
    const entry = open.get(intentId);

    if (!entry?.watchers.delete(watcher) || entry.watchers.size > 0) {
      return;
    }

    open.delete(intentId);

    const removal = realtime.removeChannel(entry.channel).catch(() => undefined);

    leaving.set(intentId, removal);
    void removal.then(() => {
      if (leaving.get(intentId) === removal) {
        leaving.delete(intentId);
      }
    });
  };

  return {
    watch(intentId, watcher) {
      let released = false;
      const pending = open.has(intentId) ? undefined : leaving.get(intentId);

      if (pending) {
        void pending.then(() => {
          if (!released) {
            add(intentId, watcher);
          }
        });
      } else {
        add(intentId, watcher);
      }

      return () => {
        if (!released) {
          released = true;
          remove(intentId, watcher);
        }
      };
    },
  };
}
