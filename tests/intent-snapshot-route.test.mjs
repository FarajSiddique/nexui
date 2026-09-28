import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/intents/[id]/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = (id) => ({ params: Promise.resolve({ id }) });

test('the snapshot comes back in contract shape', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: (args) => {
        asked = args;

        return snapshotRow(travelWorkspace(TRIP_ID));
      },
    }),
  );

  const response = await GET(
    authed(`http://localhost/api/intents/${INTENT_ID}`),
    context(INTENT_ID),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_intent_id: INTENT_ID });
  assert.equal(body.objects.length, 3);
  assert.equal(body.workspace.doc.anchorId, TRIP_ID);
});

test('a missing or foreign intent is 404, and so is a bad id', async (t) => {
  mockSupabaseAuth(t, postgrest({ get_intent_snapshot: () => null }));

  assert.equal((await GET(authed('http://localhost/x'), context(INTENT_ID))).status, 404);
  assert.equal((await GET(authed('http://localhost/x'), context('nope'))).status, 404);
});
