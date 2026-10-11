import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, OPTIONS, POST } from '../apps/api/src/app/api/intents/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { captureRuns, useMockAi } from './support/ai.mjs';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, intentRow, RUN_ID, runRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { cacheRow } from './support/media.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = 'http://localhost/api/intents';

// Sets env vars for one test and restores them after; `undefined` deletes one.
function useEnv(t, values) {
  const assign = (entries) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));

  assign(values);
  t.after(() => assign(previous));
}

test('the preflight allows GET and POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
});

test('listing requires a token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(new Request(url))).status, 401);
});

test('Home lists intents, most recent first', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': (query) => {
        asked = query;

        return [intentRow];
      },
      'table:runs': () => [],
      'table:place_media': () => [],
    }),
  );

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: intentRow.id,
        goal: intentRow.goal,
        template: 'travel',
        status: 'exploring',
        summary: intentRow.summary,
        lastActivityAt: intentRow.last_activity_at,
        photos: [],
      },
    ],
  });
  assert.equal(asked.searchParams.get('status'), 'neq.archived');
  assert.equal(asked.searchParams.get('order'), 'last_activity_at.desc');
});

test('Home shows "Drafting" while a run works on an intent', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow],
      'table:runs': (query) => {
        asked = query;

        return [{ intent_id: INTENT_ID }];
      },
      'table:place_media': () => [],
    }),
  );

  const [item] = (await (await GET(authed(url))).json()).items;

  assert.deepEqual(item.summary.badge, { text: 'Drafting', tone: 'running' });
  assert.deepEqual(item.summary.strip, intentRow.summary.strip);
  assert.equal(asked.searchParams.get('status'), 'in.(queued,running,stopping)');
  assert.match(asked.searchParams.get('created_at'), /^gte\./);
});

const BUCKET = 'https://nexui-test.supabase.co/storage/v1/object/public/place-photos';
const OLDER_ID = 'a1b2c3d4-0000-4000-8000-000000000301';

test('Home fills each card with its first stops’ cached photos and never looks anything up', async (t) => {
  const [tokyo, kyoto] = intentRow.summary.strip.map((stop) => stop.key);
  const older = {
    ...intentRow,
    id: OLDER_ID,
    summary: { line: '1 stop', strip: [{ label: 'Paris', ai: false }] },
  };
  let asked;
  const upstream = mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow, older],
      'table:runs': () => [],
      'table:place_media': (query) => {
        asked = query;

        return [
          cacheRow(tokyo, {
            photo: { path: 'a/b-960.jpg', thumbPath: 'a/b-500.jpg', width: 960, height: 640 },
            credit: {
              author: 'Kasa Fue',
              license: 'CC BY-SA 4.0',
              sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg',
            },
          }),
          cacheRow(kyoto, { status: 'none', page_title: null, page_url: null, extract: null }),
        ];
      },
    }),
  );

  const { items } = await (await GET(authed(url))).json();
  const hosts = upstream.mock.calls.map((call) => {
    const [input] = call.arguments;

    return new URL(input instanceof Request ? input.url : String(input)).hostname;
  });

  assert.deepEqual(
    items.map((item) => item.photos),
    [[`${BUCKET}/a/b-500.jpg`], []],
  );
  assert.ok(asked.searchParams.get('key').includes(tokyo));
  assert.ok(
    hosts.every((host) => host === 'nexui-test.supabase.co'),
    'nothing is looked up',
  );
});

test('without the secret key Home still lists the plans, without photos', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ 'table:intents': () => [intentRow], 'table:runs': () => [] }));
  delete process.env.SUPABASE_SECRET_KEY;

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items[0].photos, []);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'SUPABASE_SECRET_KEY is required for runs, account deletion and place details.',
  ]);
});

test('a failed photo read still lists the plans, without photos', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow],
      'table:runs': () => [],
      'table:place_media': () => pgError('XX000', 500),
    }),
  );

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items[0].photos, []);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'Could not load Home photos (XX000).',
  ]);
});

test('creating a plan requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);

  const response = await POST(
    new Request(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(typeof body.error, 'string');
  assert.equal(upstream.mock.callCount(), 0);
});

test('creating an intent seeds the trip, starts its run and answers at once', async (t) => {
  useMockAi(t);

  const tasks = captureRuns(t);
  let created;
  let run;

  mockSupabaseAuth(
    t,
    postgrest({
      create_intent: (args) => {
        created = args;

        return {};
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      create_run: (args) => {
        run = args;

        return runRow({ input: args.p_input });
      },
    }),
  );

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: '  Plan Japan in December ' }) }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.snapshot.intent.goal, 'Plan Japan in December');
  assert.equal(body.runId, RUN_ID);
  assert.equal(created.p_goal, 'Plan Japan in December');
  assert.equal(created.p_template, 'travel');
  assert.deepEqual(
    created.p_ops.map((op) => op.op),
    ['insert_object', 'set_workspace', 'insert_object', 'insert_relationship', 'update_intent'],
  );
  assert.equal(run.p_kind, 'create_intent');
  assert.equal(run.p_input.text, 'Plan Japan in December');
  assert.equal(tasks.length, 1);
});

test('a goal must be 3 to 500 characters', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'hi' }) }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    'Describe what you are planning in 3 to 500 characters.',
  );
});

test('a goal Jev can’t read is a 503, and nothing is written', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  useEnv(t, { AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: 'vck_test' });

  // The Gateway refuses at once (a 401 isn't retried); the database must never be reached.
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json(
      { error: { message: 'unauthorized', type: 'authentication_error' } },
      {
        status: 401,
      },
    ),
  );
  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );
  const hosts = upstream.mock.calls.map(
    ({ arguments: [input] }) =>
      new URL(input instanceof Request ? input.url : String(input)).hostname,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Nexui couldn't read that goal. Try again." });
  assert.ok(hosts.length > 0, 'Jev was asked');
  assert.ok(
    hosts.every((host) => host === 'ai-gateway.vercel.sh'),
    'nothing reached the database',
  );
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments, ['[perception]', 'Template routing failed.']);
});

test('a database failure returns a safe 500 and logs only its code', async (t) => {
  useMockAi(t);

  const logged = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(t, postgrest({ create_intent: () => pgError('XX000', 500) }));

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intents]',
    'Could not start that plan (XX000).',
  ]);
});

test('a misconfigured AI provider is a safe 500 that names the variable in the log', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  useEnv(t, { AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: undefined });
  mockSupabaseAuth(t);

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intents]',
    'AI_PROVIDER=live needs AI_GATEWAY_API_KEY.',
  ]);
});

test('a body over 64 KiB is a 413 and nothing is written', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const body = JSON.stringify({ goal: 'Plan Japan', padding: 'x'.repeat(65_536) });

  const response = await POST(authed(url, { method: 'POST', body }));

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'That change is too large.');
  assert.equal(upstream.mock.callCount(), 0);
});

test('bad JSON is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(authed(url, { method: 'POST', body: '{' }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid JSON');
});
