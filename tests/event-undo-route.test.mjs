import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/events/[id]/undo/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { EVENT_ID, eventRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = (id) => ({ params: Promise.resolve({ id }) });
const undoRow = {
  ...eventRow,
  id: 'a1b2c3d4-0000-4000-8000-000000000008',
  seq: 43,
  reverts_event_id: EVENT_ID,
};

function undo(id = EVENT_ID) {
  return POST(authed(`http://localhost/api/events/${id}/undo`, { method: 'POST' }), context(id));
}

test('undo requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  const response = await POST(
    new Request(`http://localhost/api/events/${EVENT_ID}/undo`, { method: 'POST' }),
    context(EVENT_ID),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(typeof body.error, 'string');
  assert.equal(upstream.mock.callCount(), 0);
});

test('undo reverts the event and returns the new event and snapshot', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      revert_event: (args) => {
        asked = args;

        return undoRow;
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
    }),
  );

  const response = await undo();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_event_id: EVENT_ID });
  assert.equal(body.event.revertsEventId, EVENT_ID);
});

test('a row changed since, or a second undo, is a 409', async (t) => {
  for (const [code, message] of [
    ['NXU09', "Something changed since then, so this can't be undone."],
    ['NXU10', 'That was already undone.'],
  ]) {
    t.mock.restoreAll();
    mockSupabaseAuth(t, postgrest({ revert_event: () => pgError(code) }));

    const response = await undo();

    assert.equal(response.status, 409, code);
    assert.equal((await response.json()).error, message);
  }
});

test('an unknown event or bad id is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ revert_event: () => pgError('NXU04') }));

  assert.equal((await undo()).status, 404);
  assert.equal((await undo('nope')).status, 404);
});
