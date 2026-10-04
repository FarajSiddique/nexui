# Realtime Broadcast and the run queue

**Status:** draft for review (2026-10-04). Implemented as a draft PR on
`realtime-broadcast-run-queue`.
**Adds to:** "AI runs" and "Tables and writers" in `docs/architecture/intent-graph.md`, and
spec section F of `2026-09-27-intent-graph-design.md`.

**Why now:** two parts of the current design get worse with every concurrent user, and both are
cheaper to change before launch than after.

1. **Live updates use `postgres_changes`.** For every row written to `objects`,
   `relationships`, `workspaces`, `events` or `runs`, Realtime decodes the WAL and checks RLS
   once per subscriber of that table. Supabase's own guidance is that this doesn't scale. One AI
   step writes many rows, and every open plan screen is a subscriber.
2. **A run lives and dies inside the request that started it.** `after()` runs it in the same
   Vercel function instance, with the user's access token. If the instance is recycled, the
   deploy rolls or the 300-second limit hits, the run is lost. Nothing retries it, and clients
   find out only when a 6-minute read-time cutoff relabels it as failed. Because the run holds the
   user's token, nothing else can pick it up either.

## 0. Decisions

| Topic                 | Decision                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live updates          | **Broadcast from the database**: triggers call `realtime.send` on a private `intent:<id>` topic. One message per changeset and per run write, not per row. Clients still treat it as a signal and refetch.                              |
| Who may listen        | An RLS policy on `realtime.messages` lets a signed-in user join `intent:<id>` only for their own intent. No insert policy, so clients can't send on it.                                                                                 |
| `postgres_changes`    | Removed: the five tables leave the `supabase_realtime` publication in the same migration. No compatibility path (prototype rule).                                                                                                       |
| Queue transport       | **The `runs` table is the queue.** Postgres leases (`claim_runs`, `for update skip locked`). No new vendor, and the same functions back an SQS or container worker on AWS later. Vercel Queues/Workflow, Inngest: see sections 5 and 6. |
| Who executes          | A **worker** using the service-role key, scoped by the run: every worker write names the run and its lease, and the database takes the user and intent from the run row. Runs no longer need the user's token.                          |
| Fast path             | Unchanged latency: the route still schedules the run with `after()`, which now claims it and executes it as the worker.                                                                                                                 |
| Safety net            | A **Vercel Cron** hits `GET /api/cron/runs` every minute. It reaps dead leases and claims runs nobody claimed.                                                                                                                          |
| Retries               | A run that **committed nothing** is retried once (2 attempts). A run that **committed a step** is failed, keeping its steps. Retrying mid-run would replay steps over its own changes. Step-level resume is phase 2.                    |
| Concurrency cap       | `RUN_MAX_ACTIVE` (default 100) caps runs claimed at once across all instances. Over the cap, a run waits queued and the cron starts it. This protects Gateway rate limits and smooths cost spikes.                                      |
| Deadline              | A run must finish within **15 minutes** of creation (two 330-second leases plus cron slack). Past that it reads as failed and stops blocking new runs. Replaces the 6-minute cutoff.                                                    |
| Client writes to runs | `record_run_step` and `finish_run` are dropped. Only the worker functions (service role) can record steps or finish runs. Clients keep `create_run` (through the API) and `cancel_run`.                                                 |
| Packaging             | One draft PR: spec, two migrations, API, mobile, docs, in that order.                                                                                                                                                                   |

## 1. Broadcast

**Migration `20261004120000_intent_broadcast.sql`.**

- `private.broadcast_intent_change()`: a `security definer` trigger function (`search_path = ''`)
  that calls `realtime.send(jsonb_build_object('table', tg_table_name), 'changed',
'intent:' || new.intent_id, true)`. `realtime.send` turns its own errors into a warning, so a
  failed broadcast never rolls back a changeset.
- Triggers: `after insert on public.events` and `after insert or update on public.runs`, both
  `for each row when (new.intent_id is not null)`. Every graph write goes through
  `private.apply_ops` or `revert_event`, and both insert exactly one `events` row. So the events
  trigger fires once per changeset, however many objects, relationships or workspace rows it
  touched. Run writes (claim, each step, finish, cancel, reap) fire the runs trigger.
- Policy `"Owners join their intent topics"` on `realtime.messages`, `for select to
authenticated`: the extension is `broadcast`, the topic is `intent:<uuid>` (matched by
  pattern before the cast, inside a `case`, so a malformed topic can't raise), and that intent's
  `user_id` is `auth.uid()`. Realtime checks it when a channel joins and caches the result for
  the connection, not per message.
- `alter publication supabase_realtime drop table` for the five tables.

**Mobile: `apps/mobile/src/data/intent-channel.ts`.** Realtime-js keeps one channel per topic:
`supabase.channel(topic)` returns the existing channel, even one that is still leaving. Today's
hook avoids that with a random topic per mount. A private topic must be exact, so channels are
shared instead:

- `createIntentChannels(realtime)` returns `watch(intentId, { onChange, onSubscribed })`, which
  returns a release function. It keeps one channel per intent with a set of watchers.
- Each channel is `channel('intent:<id>', { config: { private: true } })` and listens with
  `.on('broadcast', { event: 'changed' }, …)`.
- `onSubscribed` runs on every `SUBSCRIBED` (including rejoins), and at once for a watcher that
  joins an already-subscribed channel. It is the catch-up, since Broadcast doesn't replay
  messages missed while disconnected.
- The last release removes the channel. A watch that arrives while a removal is still in flight
  waits for it and then opens a fresh channel.
- `realtime` is injected (`{ channel, removeChannel }`), so the module is unit-tested without
  Supabase.

`useIntentLive` keeps its debounce and its wait for the user's own edits to settle. Only the
subscription moves to `intentChannels.watch`. supabase-js already passes the session's access
token to Realtime, which the private join needs.

## 2. The run queue

**Migration `20261004130000_run_queue.sql`.**

New columns on `runs`:

| Column             | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `attempts`         | `integer not null default 0`, incremented on each claim             |
| `lease_id`         | `uuid`, the current claim; every worker write must present it       |
| `lease_expires_at` | `timestamptz`, when the claim lapses; cleared when the run finishes |

There is also a partial index `runs_active_idx (created_at) where status in ('queued',
'running', 'stopping')`, which the claim and reap scans use.

Worker functions are all `security definer` and `search_path = ''`. Execute is revoked from
`public`, `anon` and `authenticated`, and granted to `service_role`:

- `claim_runs(p_run_id uuid, p_limit integer, p_lease_seconds integer, p_max_active integer)`
  returns a `jsonb` array of claimed rows, with `lease_id`.
  - With `p_run_id`, it claims that run only (the fast path). Without it, it claims up to
    `p_limit` of the oldest unclaimed runs created more than 10 seconds ago (the cron), so the
    fast path normally wins the race.
  - It claims only `queued` runs with no live lease that are younger than the 15-minute deadline,
    with `for update skip locked`.
  - It claims nothing past `p_max_active` runs holding a live lease.
  - A claim sets `lease_id = gen_random_uuid()`, `lease_expires_at = now() + p_lease_seconds`
    and `attempts + 1`.
- `run_record_step(p_run_id, p_lease_id, p_entries, p_usage)` returns `text`. It works like the
  old `record_run_step` but checks the lease instead of `auth.uid()`. A run that is no longer
  active returns its status, as before. A lease that isn't the run's raises `NXU13` (lease
  lost), so a zombie worker stops without writing.
- `run_finish(p_run_id, p_lease_id, p_status, p_error)` returns `jsonb`. It has `finish_run`'s
  status rules, a lease check (`NXU13`), and clears `lease_expires_at`.
- `run_apply_changeset(p_run_id, p_lease_id, p_ops, p_expected_activity_at)` returns `jsonb`.
  It locks the run and checks the lease, then locks the run's intent, compares
  `last_activity_at` (`NXU08`), and calls `private.apply_ops(run.user_id, run.intent_id, 'ai',
run.id, p_ops)`. It has no intent or actor parameter, so the service key can only write as
  the run it holds.
- `reap_runs()` returns `integer`. For each active run whose lease has lapsed, or that is past
  the deadline:
  - `stopping` becomes `cancelled`.
  - A run with a committed changeset (an `events` row with its `run_id`) becomes `failed`,
    "This run stopped unexpectedly.".
  - A run past the deadline, or with 2 attempts, becomes `failed` with the same message.
  - Anything else goes back to `queued`, with the lease cleared and `progress` emptied.
    `model_usage` is kept, because those tokens were spent.

The migration also does the following:

- `drop function public.record_run_step(uuid, jsonb, jsonb)` and
  `public.finish_run(uuid, text, text)`.
- `create_run` and `delete_intent` count a run as working for 15 minutes instead of 6.
- `cancel_run` is unchanged. A claimed run stays `queued` until its first step, so Stop cancels
  it at once and the worker's first `run_record_step` returns `cancelled`.

**API: `src/lib/runs`.**

- `worker.ts`:
  - `workRun(worker, runId)` claims one run. If it gets the run, it opens an AI session from
    `run.kind` and `run.input.text` and calls `executeRun` with the admin client and the lease.
    It never throws: a failed claim is logged and left to the cron.
  - `sweepRuns(worker)` calls `reap_runs`, then `claim_runs` with no run id, and hands each
    claimed run to `scheduleRun`.
  - A `RunWorker` is `{ db, openSession, maxActive }`. `runWorker(env)` builds it from the
    service-role client, `sessionOpener` and `RUN_MAX_ACTIVE`, so tests inject their own.
  - `RUN_LEASE_SECONDS = 330` (the 300-second function limit plus margin) and
    `RUN_SWEEP_LIMIT = 10`.
- `execute.ts`:
  - `RunJob` gains `leaseId`.
  - `recordRunStep` and `finishRun` call the worker functions.
  - `commitChangeset` gets `lease` in `CommitInput`. With a run id and lease, it calls
    `run_apply_changeset` instead of `apply_changeset`.
  - `NXU13` maps to `RunLeaseLostError`. The executor stops on it without finishing the run,
    because the run belongs to someone else now.
- `store.ts`: `RUN_STALE_MS` becomes 15 minutes. It is still applied when reading, as a backstop
  in case the cron is down.
- Orchestrator:
  - `startIntent` and `startAsk` create the run with the user's client, as before, then
    `scheduleRun(() => workRun(deps.worker, run.id))`.
  - The session opened for perception is no longer handed to the run. The worker reopens one,
    which mock mode resolves to the same fixture.
- `getAdminClient`'s missing-key message no longer says "account deletion".

**Cron: `apps/api/src/app/api/cron/runs/route.ts`.**

- `GET` checks `Authorization: Bearer <CRON_SECRET>` with a timing-safe compare. A wrong or
  missing header gets 401. An unset `CRON_SECRET` gets 503 and is logged under `[cron]`.
- It then calls `sweepRuns` and answers `{ reaped, claimed }`. The claimed runs execute in
  `after()` (`maxDuration = 300`).
- `apps/api/vercel.json` schedules it `* * * * *`. That needs a Pro plan: Hobby runs crons once
  a day, which would still work but only as a slow backstop.

**Env (`apps/api/.env.example`):**

- `SUPABASE_SECRET_KEY` is now needed for runs too, not only account deletion.
- `CRON_SECRET` is new. Vercel sends it to cron routes.
- `RUN_MAX_ACTIVE` is optional and defaults to 100.

## 3. Behavior a user sees

- No change on the happy path: same latency, same progress, same Stop.
- A run lost before it committed anything restarts by itself within about a minute and a half
  (lease plus cron). Today it shows "This run stopped unexpectedly." after 6 minutes.
- A run lost after committing a step fails within about a minute and a half and keeps its steps.
  Today this takes 6 minutes.
- Under a spike past `RUN_MAX_ACTIVE`, new runs show as working (`queued`) and start within a
  minute as capacity frees.
- "Drafting" on Home and the one-run-per-intent rule now wait up to 15 minutes for a run nobody
  reaped. With the cron running, the reaper settles such runs in about 6 minutes.

## 4. Testing and verification

- **Static migration tests** (`tests/intent-broadcast-migration.test.mjs`,
  `tests/run-queue-migration.test.mjs`) check that:
  - Every new function pins `search_path`.
  - The worker functions are granted to `service_role` only.
  - The dropped functions are gone, and no client gets direct writes.
  - The publication drops all five tables.
  - The `realtime.messages` policy is select-only and checks ownership.
- **`tests/support/graph-db.mjs`** gains `claim_runs`, `run_record_step`, `run_finish`,
  `run_apply_changeset` and `reap_runs`, with lease checks.
- **Unit tests:**
  - `tests/run-worker.test.mjs`: claim and execute as the service role, nothing to claim, a
    failed claim, and sweep scheduling every claimed run.
  - `tests/run-executor.test.mjs`: commits go through `run_apply_changeset` with the lease, and a
    lease lost mid-run stops the executor without writing or finishing.
  - `tests/cron-runs-route.test.mjs`: 401, 503 and 200.
  - `tests/mobile-intent-channel.test.mjs`: shared channel, late watcher catch-up, last release
    removes, re-watch during removal.
- **Route tests:** the existing ones still pass through the worker, with the admin key set in
  their env.
- **Database:** `supabase/tests/runs-smoke.sql` moves to the worker functions (as
  `service_role`) and adds lease loss, reap-and-retry, reap-to-failed and the concurrency cap.
  `supabase/tests/broadcast-smoke.sql` checks that a changeset sends one message, and that the
  policy lets the owner join and keeps another user out. Both run against a local
  `supabase start`.
- **End to end (done for the draft PR).** Run `next dev` against a local `supabase start` with
  `AI_PROVIDER=mock`, then use supabase-js as two users. Results:
  - The create run succeeds on the fast path.
  - The owner joins `intent:<id>`, and the other user gets `CHANNEL_ERROR` ("Unauthorized").
  - An ask sends the owner 7 signals (6 run writes, 1 changeset) and the other user none.
  - The cron leaves a fresh orphan alone, then claims and finishes it after 10 seconds.
  - A claimed run whose lease lapsed is reaped, its dead lease gets `NXU13`, and the retry
    succeeds on attempt 2.
  - A user calling `claim_runs` gets `42501`, and `record_run_step` no longer exists.
- **Manual, still to do:**
  - In Expo, open a plan and start an ask: the plan updates live.
  - Kill the API mid-run: the cron retries the run or fails it.
  - Toggle the network: the plan catches up on rejoin.

## 5. Why not Vercel Workflow now

The intent-graph spec planned to move runs to Vercel Workflow "if runs need retries or more
time". Workflow would give durable steps and longer runs, but it would tie run execution to
Vercel just as hosting elsewhere (AWS) is being weighed, and it adds a second state machine next
to `runs`, which clients already read. Leases in Postgres are needed under any transport anyway:
they make claims exclusive and make a duplicate delivery harmless. Workflow or Queues can still
sit in front of them later (section 6).

## 6. Later (phase 2, not in this PR)

- **Step-level resume.** Persist each step's model messages on the run, so a lost run continues
  from its last committed step instead of failing. Retries then cover every lost run.
- **Push transport.** When cron latency or per-minute draining isn't enough, put a queue in
  front of the same functions: Vercel Queues on Vercel, or SQS feeding an ECS or Lambda worker
  on AWS. `claim_runs` and the lease checks stay as the source of truth, so delivering a message
  twice is harmless.
- **Heartbeats.** A worker that isn't capped at 300 seconds (a container) should extend its lease
  each step. `run_record_step` is the natural place.
- **Run history.** Prune `realtime.messages` (Supabase keeps a few days of partitions) and old
  `runs.progress` once volume matters.
