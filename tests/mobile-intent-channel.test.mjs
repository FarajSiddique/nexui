import assert from 'node:assert/strict';
import test from 'node:test';

import { createIntentChannels } from '../apps/mobile/src/data/intent-channel.ts';

const INTENT = 'a1b2c3d4-0000-4000-8000-000000000001';

/**
 * A Realtime stand-in. Like realtime-js, `channel` hands back the existing channel for a topic
 * until its removal finishes; `finishRemoval()` settles the oldest pending removal.
 */
function fakeRealtime() {
  const channels = [];
  const removals = [];

  const realtime = {
    channels,
    channel(topic, options) {
      const existing = channels.find((channel) => channel.topic === topic && !channel.removed);

      if (existing) {
        return existing;
      }

      const channel = {
        topic,
        options,
        listeners: [],
        status: null,
        removed: false,
        on(type, filter, callback) {
          this.listeners.push({ type, filter, callback });

          return this;
        },
        subscribe(callback) {
          this.status = callback;

          return this;
        },
        send() {
          for (const listener of this.listeners) {
            listener.callback({});
          }
        },
      };

      channels.push(channel);

      return channel;
    },
    removeChannel(channel) {
      return new Promise((resolve) => {
        removals.push((status) => {
          // Like realtime-js, only an `ok` leave takes the channel out of the client.
          channel.removed = status === 'ok';
          resolve(status);
        });
      });
    },
    async finishRemoval(status = 'ok') {
      removals.shift()(status);
      await new Promise((resolve) => setImmediate(resolve));
    },
    pendingRemovals: () => removals.length,
  };

  return realtime;
}

function watcher() {
  const seen = { changes: 0, joins: 0 };

  return {
    seen,
    onChange: () => {
      seen.changes += 1;
    },
    onSubscribed: () => {
      seen.joins += 1;
    },
  };
}

test('a watch joins the private intent topic and listens for changed signals', () => {
  const realtime = fakeRealtime();
  const one = watcher();

  createIntentChannels(realtime).watch(INTENT, one);

  const [channel] = realtime.channels;

  assert.equal(channel.topic, `intent:${INTENT}`);
  assert.deepEqual(channel.options, { config: { private: true } });
  assert.deepEqual(
    channel.listeners.map(({ type, filter }) => [type, filter]),
    [['broadcast', { event: 'changed' }]],
  );

  channel.status('SUBSCRIBED');
  channel.send();

  assert.deepEqual(one.seen, { changes: 1, joins: 1 });
});

test('every join catches up, including a rejoin, but an error does not', () => {
  const realtime = fakeRealtime();
  const one = watcher();

  createIntentChannels(realtime).watch(INTENT, one);

  const [channel] = realtime.channels;

  channel.status('SUBSCRIBED');
  channel.status('CHANNEL_ERROR');
  channel.status('SUBSCRIBED');

  assert.equal(one.seen.joins, 2);
});

test('two watchers of one intent share its channel', () => {
  const realtime = fakeRealtime();
  const channels = createIntentChannels(realtime);
  const one = watcher();
  const two = watcher();

  channels.watch(INTENT, one);
  realtime.channels[0].status('SUBSCRIBED');
  channels.watch(INTENT, two);

  assert.equal(realtime.channels.length, 1);
  assert.equal(two.seen.joins, 1, 'a late watcher catches up at once');
  assert.equal(realtime.channels[0].listeners.length, 1);

  realtime.channels[0].send();

  assert.equal(one.seen.changes, 1);
  assert.equal(two.seen.changes, 1);
});

test('the channel stays until its last watcher releases it', async () => {
  const realtime = fakeRealtime();
  const channels = createIntentChannels(realtime);
  const one = watcher();
  const releaseOne = channels.watch(INTENT, one);
  const releaseTwo = channels.watch(INTENT, watcher());

  releaseOne();
  releaseOne();
  realtime.channels[0].send();

  assert.equal(realtime.pendingRemovals(), 0);
  assert.equal(one.seen.changes, 0, 'a released watcher hears nothing');

  releaseTwo();

  assert.equal(realtime.pendingRemovals(), 1);
});

test('a watch during a removal waits for it, then opens a fresh channel', async () => {
  const realtime = fakeRealtime();
  const channels = createIntentChannels(realtime);

  channels.watch(INTENT, watcher())();

  const again = watcher();

  channels.watch(INTENT, again);

  assert.equal(realtime.channels.length, 1, 'nothing reuses the channel that is leaving');

  await realtime.finishRemoval();

  assert.equal(realtime.channels.length, 2);
  assert.equal(realtime.channels[1].removed, false);

  realtime.channels[1].status('SUBSCRIBED');

  assert.equal(again.seen.joins, 1);
});

test('a watch released while it waited never opens a channel', async () => {
  const realtime = fakeRealtime();
  const channels = createIntentChannels(realtime);

  channels.watch(INTENT, watcher())();
  channels.watch(INTENT, watcher())();
  await realtime.finishRemoval();

  assert.equal(realtime.channels.length, 1);
  assert.equal(realtime.pendingRemovals(), 0);
});

test('a channel whose removal timed out is removed again, never reused', async () => {
  const realtime = fakeRealtime();
  const channels = createIntentChannels(realtime);

  channels.watch(INTENT, watcher())();
  await realtime.finishRemoval('timed out');

  const again = watcher();

  // Realtime still hands back the old, subscribed channel for the topic.
  assert.doesNotThrow(() => channels.watch(INTENT, again));
  assert.equal(realtime.channels.length, 1);
  assert.equal(realtime.channels[0].listeners.length, 1, 'nothing is added to the old channel');
  assert.equal(realtime.pendingRemovals(), 1, 'it is removed again');

  await realtime.finishRemoval();

  assert.equal(realtime.channels.length, 2);
  realtime.channels[1].status('SUBSCRIBED');
  assert.equal(again.seen.joins, 1);
});
