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
  // Channels this module removed. A removal that doesn't end `ok` leaves the channel in the
  // client, which then hands it back for the topic, already subscribed.
  const retired = new WeakSet<BroadcastChannel>();

  const retire = (intentId: string, channel: BroadcastChannel): void => {
    retired.add(channel);

    const removal = realtime.removeChannel(channel).catch(() => undefined);

    leaving.set(intentId, removal);
    void removal.then(() => {
      if (leaving.get(intentId) === removal) {
        leaving.delete(intentId);
      }
    });
  };

  // Null when Realtime handed back a channel that never finished leaving: it is removed again.
  const join = (intentId: string): OpenChannel | null => {
    const channel = realtime.channel(`intent:${intentId}`, { config: { private: true } });

    if (retired.has(channel)) {
      retire(intentId, channel);

      return null;
    }

    const entry: OpenChannel = { channel, watchers: new Set(), subscribed: false };

    channel
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

  // Adds the watcher once no removal of the intent's channel is in flight.
  const start = (intentId: string, watcher: IntentWatcher, released: () => boolean): void => {
    const pending = open.has(intentId) ? undefined : leaving.get(intentId);

    if (pending) {
      void pending.then(() => {
        if (!released()) {
          start(intentId, watcher, released);
        }
      });

      return;
    }

    const entry = open.get(intentId) ?? join(intentId);

    if (!entry) {
      start(intentId, watcher, released);

      return;
    }

    entry.watchers.add(watcher);

    if (entry.subscribed) {
      watcher.onSubscribed();
    }
  };

  const stop = (intentId: string, watcher: IntentWatcher): void => {
    const entry = open.get(intentId);

    if (!entry?.watchers.delete(watcher) || entry.watchers.size > 0) {
      return;
    }

    open.delete(intentId);
    retire(intentId, entry.channel);
  };

  return {
    watch(intentId, watcher) {
      let released = false;

      start(intentId, watcher, () => released);

      return () => {
        if (!released) {
          released = true;
          stop(intentId, watcher);
        }
      };
    },
  };
}
