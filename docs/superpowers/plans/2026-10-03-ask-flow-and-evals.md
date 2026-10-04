# Ask Flow and Travel Evals (Slice 1, Steps 7–8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish slice 1. The insight's "Ask Nexui for ideas" proposes a decision, the user picks, and the plan updates with no leftover candidates. Runs stop cleanly and report every refused call. `pnpm eval:travel` runs spec H's eight prompts live as a manual gate.

**Architecture:** Run hardening comes first.

- A new `stopping` run status closes the cancel race.
- Calls the AI SDK refuses for their schema reach run progress through the stager.
- A forced step that fails and then answers in text is `invalid`.

The ask flow is pure capability work in `decisions.ts`:

- Options carry a suggested length and a leg hint.
- Resolve deletes the unpicked candidates in the same changeset, so Undo restores them.
- The decision stores what the user asked.

On mobile, the decision card shows "You asked …", and the + sheet offers "See the choice" or "Back to plan". A small Zustand store tells the workspace to scroll to its Open band. The eval is a Node script over the running API that shares a QA helper with `try-run.mjs` and the smoke script. Its pure checks are unit-tested.

**Tech Stack:** Next.js 16 route handlers and the AI SDK 7 (`generateText`), Supabase Postgres functions (plpgsql), Zod 4 contracts in `@nexui/types`, Expo Router, TanStack Query 5, Zustand 5, Node 24's test runner with type stripping.

**Spec:** `docs/superpowers/specs/2026-10-03-ask-flow-and-evals-design.md`, which adds to `docs/superpowers/specs/2026-09-27-intent-graph-design.md` section H, steps 7 and 8. Read both.

## Global Constraints

- Node.js 24, pnpm 10.34.5. Run every command from the repo root (the worktree root).
- **Primitives never call the API.** Mobile section components get `{ section, data, snapshot, onAction, busy }` and report `WorkspaceAction`s (spec section D). Only screens use query hooks.
- **Colors come only from tokens** (`useColors()` and `createThemedStyles()`). `tests/theme-tokens.test.mjs` enforces it.
- **Pure mobile modules** in `apps/mobile/src/lib/` (such as the new `run-outcome.ts`) must not import `react-native`, `expo-*` or the `@/` alias. They import types from `@nexui/types` so `tests/*.test.mjs` can load them.
- **User text is data.** Never log run input, goals or tokens. Log with `logLine(error, '…')` from `apps/api/src/lib/graph/respond.ts`, which logs only error codes.
- **SQL functions** are `security definer`, use `set search_path = ''`, check `caller uuid := auth.uid();`, scope every row to the caller, and are granted to `authenticated` only.
- **Copy (verbatim from the spec):**
  - sheet buttons "See the choice" and "Back to plan", and the secondary link "See changes";
  - RunCard title "Stopping…";
  - decision line _You asked "…"_.
- Style:
  - strict TypeScript;
  - braces on every `if`, `else` and loop;
  - a blank line before `return`, after blocks and after declaration groups;
  - explicit parameter and return types on exported functions;
  - no nested ternaries;
  - kebab-case filenames.

  `.claude/hooks/format.sh` runs Prettier and ESLint after each edit. Run `pnpm fix` before each commit anyway.

- Each task keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` passing. A single test file runs with `node --experimental-strip-types --test tests/<file>.test.mjs`.
- Commit messages: a concise imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ask before anything outward-facing:** `pnpm db:push` (Task 12), live model calls that cost money (Tasks 12 and 16), and pushing or opening the PR (Task 16).

## Decisions this plan makes (flagged for review)

1. **"You asked …" is stored on the decision.** Spec addendum section 3 says the card reads the run through `useRun`, but spec section D forbids primitives from calling the API. `decision.propose` therefore copies the run's request into a new optional `DecisionData.asked` field (up to 300 characters). It reaches the stager as `request`. The card reads it from the snapshot, and it renders offline.
2. **The new fixture matches `['i have free']`,** not `['days i have free']`. The insight says "the 1 day I have free" when one day is free, and the smoke script frees exactly one day.
3. **Stop on `awaiting_approval` cancels at once.** Nothing executes while a run awaits approval, so only a `running` run goes through `stopping`. Slice 1 never uses `awaiting_approval`.
4. **`record_run_step` keeps a stopping run's last step.** It appends the entries and usage, keeps the status `stopping`, and returns it. Otherwise the step that Stop let finish would vanish from progress.
5. **A trip whose run can't start is discarded by a new `discard_intent` SQL function.** Clients can't delete intents under RLS. The function deletes only an intent of the caller's that no run has started on.
6. **The eval tags each plan right after creating it,** not after its goal run, so a crash mid-run still leaves the plan tagged for `--clean`.
7. **The eval reads `.qa/session.json`** like `try-run.mjs`, so `qa-session.mjs` is unchanged. The shared `scripts/lib/qa-api.mjs` holds `readSession`, `qaApi` (`call`, `waitForRun`), `qaAdmin`, `printRun` and `printPlan`.
8. **The RunCard's success footer gains "See changes".** The spec says the link "stays" as the secondary action, but today only failed and cancelled runs show it.
9. **Stated trip lengths are checked as ranges of ±1 day,** because a model may set dates whose difference is one off (Dec 1–14 for "two weeks").

## Review Focus

1. **Stop, then ask again at once.** Expected: the new ask gets the 409 "A run is already working on this intent" until the old run's last step commits. The sheet shows that error and Send works again within seconds. Pinned by Task 1's migration test (`create_run` blocks `stopping`) and Task 2's executor test (a stopping run ends `cancelled` after committing its step).
2. **Picking after the route changed underneath the proposal** (the user reordered stops). Expected: the new leg starts from the current last stop, with mode `other` and no hours, rather than claiming the old hint. Pinned by Task 8's reorder test.
3. **A candidate the user already put on the route by hand, then "Keep the day free".** Expected: that stop stays on the route and only the other candidates go. Pinned by Task 8's dismiss test.
4. **Picking when the trip has no length yet** (free days null) **or is over-allocated** (negative). Expected: the place gets the model's suggested days, or 1, never 0. Pinned by Task 8's fallback test.
5. **Undo right after a pick.** Expected: the decision is open again with its comparison, the deleted candidates are back, and the route and day bar return to where they were. Pinned by Task 13's smoke-script assertions against the real database's inverse ops.

---

## File Structure

```
supabase/migrations/20261003000000_run_stopping.sql   (create) stopping status, run functions, discard_intent
packages/types/src/runs.ts                           (modify) 'stopping', ACTIVE_RUN_STATUSES, isActiveRunStatus
packages/types/src/kinds/travel.ts                   (modify) DecisionData.asked; OptionData.suggestedDays, .leg
apps/api/src/lib/runs/store.ts                       (modify) active statuses, finishRun 'cancelled'
apps/api/src/lib/runs/execute.ts                     (modify) stopped → cancelled; refused calls; request
apps/api/src/lib/cognition/run-model.ts              (modify) StepReport.refused; fail-then-text → invalid
apps/api/src/lib/cognition/tools.ts                  (modify) capabilityForTool
apps/api/src/lib/capabilities/stage.ts               (modify) recordRefused; request option
apps/api/src/lib/capabilities/types.ts               (modify) CapabilityContext.request
apps/api/src/lib/capabilities/graph.ts               (modify) DATA_HELP limits
apps/api/src/lib/capabilities/decisions.ts           (modify) propose hints + asked; resolve days, leg, cleanup
apps/api/src/lib/graph/commit.ts                     (modify) discardIntent
apps/api/src/lib/orchestrator/orchestrate.ts         (modify) discard a trip whose run can't start
apps/api/src/lib/ai/fixtures/japan-ask-free-days.ts  (create, recorded) replaces japan-ask-rural.ts (delete)
apps/api/src/lib/ai/fixtures/index.ts                (modify) FIXTURES
apps/mobile/src/lib/queries.ts                       (modify) isRunActive via isActiveRunStatus
apps/mobile/src/lib/run-outcome.ts                   (create) afterAsk (pure)
apps/mobile/src/stores/use-reveal-store.ts           (create) "scroll to the Open band" flag
apps/mobile/src/components/run-card.tsx              (modify) Stopping…; See changes on success
apps/mobile/src/components/sections/decision-section.tsx (modify) You asked line
apps/mobile/src/app/(app)/compose.tsx                (modify) See the choice / Back to plan; one channel
apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx  (modify) reveal the Open band
scripts/lib/qa-api.mjs                               (create) shared QA API + admin helpers
scripts/lib/eval-checks.mjs                          (create) pure eval checks
scripts/eval-travel-cases.mjs                        (create) the eight cases
scripts/eval-travel.mjs                              (create) the runner, --case, --clean
scripts/try-run.mjs, scripts/smoke-intent-graph.mjs  (modify) use qa-api; smoke covers propose/resolve/undo
package.json                                         (modify) "eval:travel"
tests/support/graph-db.mjs                           (modify) stopping semantics, discard_intent, failCreateRun
tests/run-stopping-migration.test.mjs                (create)
tests/eval-checks.test.mjs                           (create)
tests/mobile-run-outcome.test.mjs                    (create)
tests/run-contracts.test.mjs, runs-store.test.mjs, run-executor.test.mjs, orchestrator.test.mjs,
cognition.test.mjs, capabilities-graph.test.mjs, capabilities-travel.test.mjs (modify)
```

---

### Task 1: The `stopping` run status, from database to app

**Files:**

- Create: `supabase/migrations/20261003000000_run_stopping.sql`
- Create: `tests/run-stopping-migration.test.mjs`
- Modify: `packages/types/src/runs.ts:9-18`
- Modify: `apps/api/src/lib/runs/store.ts` (`mapRunRow`, `finishRun`, `cancelRun`, `activeRunIntentIds`)
- Modify: `apps/mobile/src/lib/queries.ts:53-55`, `apps/mobile/src/components/run-card.tsx`
- Modify: `tests/support/graph-db.mjs` (run functions), `tests/run-contracts.test.mjs`, `tests/runs-store.test.mjs`

**Interfaces:**

- Produces: `runStatusSchema` with `'stopping'`; `ACTIVE_RUN_STATUSES: readonly ['queued', 'running', 'stopping']`; `isActiveRunStatus(status: RunStatus | undefined): boolean` (all exported from `@nexui/types`); `finishRun(db, runId, status: 'succeeded' | 'failed' | 'cancelled', error)`. In SQL: `cancel_run` moves a running run to `stopping`; `record_run_step` returns `'stopping'` for one; `finish_run` accepts `'cancelled'`. The fake DB in `tests/support/graph-db.mjs` mirrors all of this.

- [ ] **Step 1: Write the failing tests**

Add to `tests/run-contracts.test.mjs` (extend the import from `../packages/types/src/index.ts` with `isActiveRunStatus`):

```js
test('a stopping run is still active; finished ones are not', () => {
  for (const status of ['queued', 'running', 'stopping']) {
    assert.equal(isActiveRunStatus(status), true, status);
  }

  for (const status of ['awaiting_approval', 'succeeded', 'failed', 'cancelled', undefined]) {
    assert.equal(isActiveRunStatus(status), false, String(status));
  }
});
```

In `tests/runs-store.test.mjs`, extend the stale test and change the active-intents assertion:

```js
test('a run left queued, running or stopping for 6 minutes reads as failed', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const old = '2026-09-29T11:53:00Z';
  const recent = '2026-09-29T11:55:00Z';

  assert.deepEqual(
    (({ status, error }) => ({ status, error }))(
      mapRunRow(runRow({ status: 'running', created_at: old }), now),
    ),
    { status: 'failed', error: STALE_RUN_ERROR },
  );
  assert.equal(mapRunRow(runRow({ status: 'queued', created_at: old }), now).status, 'failed');
  assert.equal(mapRunRow(runRow({ status: 'stopping', created_at: old }), now).status, 'failed');
  assert.equal(mapRunRow(runRow({ status: 'running', created_at: recent }), now).status, 'running');
  assert.equal(
    mapRunRow(runRow({ status: 'stopping', created_at: recent }), now).status,
    'stopping',
  );
  assert.equal(
    mapRunRow(runRow({ status: 'succeeded', created_at: old }), now).status,
    'succeeded',
  );
});
```

Replace the old `'a run left queued or running for 6 minutes reads as failed'` test with it. In `'activeRunIntentIds finds intents with a recent queued or running run'`, rename it to `'activeRunIntentIds finds intents with a recent active run'` and change the status assertion to:

```js
assert.equal(asked.searchParams.get('status'), 'in.(queued,running,stopping)');
```

Create `tests/run-stopping-migration.test.mjs`:

```js
// Static checks on the stopping migration: Stop lets the step in flight finish, nothing new
// starts meanwhile, and every function keeps the usual guards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261003000000_run_stopping.sql', 'utf8');
const bodyOf = (name) =>
  sql.match(
    new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\n\\$\\$;`),
  )?.[1];

test('runs may be stopping', () => {
  assert.match(
    sql,
    /check \(status in \('queued', 'running', 'stopping', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'\)\)/,
  );
});

test('Stop moves a running run to stopping and cancels anything else at once', () => {
  const body = bodyOf('cancel_run');

  assert.ok(body);
  assert.match(
    body,
    /status = case when r\.status = 'running' then 'stopping' else 'cancelled' end/,
  );
  assert.match(body, /r\.status in \('queued', 'running', 'awaiting_approval'\)/);
});

test('a stopping run blocks a new run and still records its last step', () => {
  assert.match(bodyOf('create_run'), /r\.status in \('queued', 'running', 'stopping'\)/);
  assert.match(bodyOf('create_run'), /interval '6 minutes'/);
  assert.match(bodyOf('record_run_step'), /not in \('queued', 'running', 'stopping'\)/);
  assert.match(bodyOf('record_run_step'), /when r\.status = 'stopping' then 'stopping'/);
});

test('finish_run ends a stopping run cancelled, or failed when its last step failed', () => {
  const body = bodyOf('finish_run');

  assert.match(body, /not in \('succeeded', 'failed', 'cancelled'\)/);
  assert.match(body, /when r\.status = 'stopping' and p_status = 'failed' then 'failed'/);
  assert.match(body, /when r\.status = 'stopping' then 'cancelled'/);
});

test('every function pins search_path, checks the caller and is for signed-in users only', () => {
  for (const name of ['create_run', 'record_run_step', 'finish_run', 'cancel_run']) {
    const body = bodyOf(name);

    assert.ok(body, name);
    assert.match(body, /security definer/, name);
    assert.match(body, /set search_path = ''/, name);
    assert.match(body, /caller uuid := auth\.uid\(\);/, name);
    assert.match(body, /r\.user_id = caller|i\.user_id = caller/, name);
  }

  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /create policy/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/run-contracts.test.mjs tests/runs-store.test.mjs tests/run-stopping-migration.test.mjs`
Expected: FAIL. `isActiveRunStatus` is not exported, `'stopping'` fails `runStatusSchema`, the status filter is still `in.(queued,running)`, and the migration file doesn't exist (ENOENT).

- [ ] **Step 3: Add the status to the contract**

In `packages/types/src/runs.ts`, replace the status schema and type with:

```ts
export const runStatusSchema = z.enum([
  'queued',
  'running',
  'stopping',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * A run in one of these statuses is still working on its intent, so no other run may start.
 * Stop moves a running run to `stopping` until the step it was taking commits.
 */
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'stopping',
] as const satisfies readonly RunStatus[];

/**
 * @example
 * isActiveRunStatus('stopping') // true
 * isActiveRunStatus('cancelled') // false
 */
export function isActiveRunStatus(status: RunStatus | undefined): boolean {
  return status !== undefined && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}
```

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261003000000_run_stopping.sql`:

```sql
-- Stop lets a running run finish the step it is taking (spec addendum 2026-10-03, section 1).
-- cancel_run moves a running run to `stopping`; the executor commits that step, records it and
-- finishes the run as cancelled. Meanwhile create_run refuses a new run, so a stopped run's last
-- commit can never land under a newer run. A stopping run older than 6 minutes has stopped, like
-- a running one (RUN_STALE_MS in apps/api/src/lib/runs/store.ts).

alter table public.runs drop constraint runs_status_check;
alter table public.runs add constraint runs_status_check
  check (status in ('queued', 'running', 'stopping', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'));

create or replace function public.create_run(p_intent_id uuid, p_kind text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  created public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_kind is null or p_kind not in ('create_intent', 'ask')
    or p_input is null or jsonb_typeof(p_input) <> 'object'
  then
    raise exception 'That run is not valid' using errcode = 'NXU22';
  end if;

  perform 1
  from public.intents i
  where i.id = p_intent_id and i.user_id = caller
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if exists (
    select 1
    from public.runs r
    where r.intent_id = p_intent_id
      and r.user_id = caller
      and r.status in ('queued', 'running', 'stopping')
      and r.created_at > now() - interval '6 minutes'
  ) then
    raise exception 'A run is already working on this intent' using errcode = 'NXU12';
  end if;

  insert into public.runs (user_id, intent_id, kind, input)
  values (caller, p_intent_id, p_kind, p_input)
  returning * into created;

  return to_jsonb(created);
end;
$$;

-- Appends one step's progress entries and token usage, and returns the run's status. A stopping
-- run keeps its last step's entries and stays stopping, so the executor stops after it.
create or replace function public.record_run_step(p_run_id uuid, p_entries jsonb, p_usage jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  found_run public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
    or p_usage is null or jsonb_typeof(p_usage) <> 'object'
  then
    raise exception 'That step is not valid' using errcode = 'NXU22';
  end if;

  select * into found_run
  from public.runs r
  where r.id = p_run_id and r.user_id = caller
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if found_run.status not in ('queued', 'running', 'stopping') then
    return found_run.status;
  end if;

  update public.runs r set
    status = case when r.status = 'stopping' then 'stopping' else 'running' end,
    started_at = coalesce(r.started_at, now()),
    progress = case
      when jsonb_array_length(r.progress) + jsonb_array_length(p_entries) > 100 then r.progress
      else r.progress || p_entries
    end,
    model_usage = jsonb_strip_nulls(jsonb_build_object(
      'inputTokens', coalesce((r.model_usage ->> 'inputTokens')::bigint, 0)
        + coalesce((p_usage ->> 'inputTokens')::bigint, 0),
      'outputTokens', coalesce((r.model_usage ->> 'outputTokens')::bigint, 0)
        + coalesce((p_usage ->> 'outputTokens')::bigint, 0),
      'model', coalesce(p_usage ->> 'model', r.model_usage ->> 'model')
    ))
  where r.id = p_run_id and r.user_id = caller;

  return case when found_run.status = 'stopping' then 'stopping' else 'running' end;
end;
$$;

-- Ends a run. A stopping run ends cancelled, or failed if its last step failed. A finished run
-- keeps its status; its finish time is kept.
create or replace function public.finish_run(p_run_id uuid, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  finished public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_status is null or p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'That status is not valid' using errcode = 'NXU22';
  end if;

  update public.runs r set
    status = case
      when r.status in ('queued', 'running') then p_status
      when r.status = 'stopping' and p_status = 'failed' then 'failed'
      when r.status = 'stopping' then 'cancelled'
      else r.status
    end,
    error = case
      when r.status in ('queued', 'running', 'stopping') and p_status = 'failed'
        then left(p_error, 300)
      else r.error
    end,
    finished_at = coalesce(r.finished_at, now())
  where r.id = p_run_id and r.user_id = caller
  returning * into finished;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  return to_jsonb(finished);
end;
$$;

-- Stops a run (spec section F): a running run finishes the step it is taking first; anything
-- else not yet finished is cancelled at once. What a run committed stays and can be undone. A
-- run that already finished, or is already stopping, is returned unchanged.
create or replace function public.cancel_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  stopped public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  update public.runs r set
    status = case when r.status = 'running' then 'stopping' else 'cancelled' end,
    finished_at = case when r.status = 'running' then r.finished_at else now() end
  where r.id = p_run_id
    and r.user_id = caller
    and r.status in ('queued', 'running', 'awaiting_approval')
  returning * into stopped;

  if not found then
    select * into stopped
    from public.runs r
    where r.id = p_run_id and r.user_id = caller;

    if not found then
      raise exception 'Not found' using errcode = 'NXU04';
    end if;
  end if;

  return to_jsonb(stopped);
end;
$$;
```

`create or replace` keeps each function's existing grants, so no grant lines are needed. Task 3 appends `discard_intent` to this file. Task 12 pushes it.

- [ ] **Step 5: Use the active statuses in the API store**

In `apps/api/src/lib/runs/store.ts`:

- Add `ACTIVE_RUN_STATUSES` and `isActiveRunStatus` to the `@nexui/types` import.
- Change the `RUN_STALE_MS` doc comment to `/** A queued, running or stopping run older than this has stopped: its function instance ended. */`.
- In `mapRunRow`, replace `const active = record.status === 'queued' || record.status === 'running';` with `const active = isActiveRunStatus(record.status);`, and change its doc comment's "still queued or running" to "still active".
- Replace `finishRun` and `cancelRun`'s signatures and doc comments:

```ts
/**
 * Ends the run. A stopping run ends cancelled, or failed when `status` is failed; a finished run
 * keeps its status. `error` must be safe to show the user.
 */
export async function finishRun(
  db: SupabaseClient,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  error: string | null,
): Promise<RunRecord> {
```

Keep the body unchanged. Then:

```ts
/**
 * Asks the run to stop. A running run moves to `stopping` and finishes the step it is taking;
 * anything else not yet finished is cancelled at once. A finished run comes back unchanged.
 */
export async function cancelRun(db: SupabaseClient, runId: string): Promise<RunRecord> {
```

In `activeRunIntentIds`, replace `.in('status', ['queued', 'running'])` with `.in('status', [...ACTIVE_RUN_STATUSES])`.

- [ ] **Step 6: Mirror the new semantics in the fake database**

In `tests/support/graph-db.mjs`, replace the `active` helper and the three run handlers:

```js
const active = () => ['queued', 'running', 'stopping'].includes(state.run.status);
```

```js
    record_run_step: (args) => {
      state.steps.push(args);

      if (active()) {
        state.run = {
          ...state.run,
          status: state.run.status === 'stopping' ? 'stopping' : 'running',
          progress: [...state.run.progress, ...args.p_entries],
        };
      }

      return state.run.status;
    },
    finish_run: (args) => {
      state.finished = args;

      if (state.run.status === 'stopping') {
        const status = args.p_status === 'failed' ? 'failed' : 'cancelled';

        state.run = { ...state.run, status, error: status === 'failed' ? args.p_error : null };
      } else if (active()) {
        state.run = { ...state.run, status: args.p_status, error: args.p_error };
      }

      return state.run;
    },
    cancel_run: () => {
      if (state.run.status === 'running') {
        state.run = { ...state.run, status: 'stopping' };
      } else if (state.run.status === 'queued' || state.run.status === 'awaiting_approval') {
        state.run = { ...state.run, status: 'cancelled' };
      }

      return state.run;
    },
```

Update the `graphDb` doc comment's sentence about the run functions to: "the run functions keep one run with the SQL's statuses, including `stopping`".

- [ ] **Step 7: Show `stopping` in the app**

In `apps/mobile/src/lib/queries.ts`, add `isActiveRunStatus` to the `@nexui/types` import and replace `isRunActive`'s body:

```ts
export function isRunActive(run: RunRecord | undefined): boolean {
  return isActiveRunStatus(run?.status);
}
```

In `apps/mobile/src/components/run-card.tsx`, add the title (the `Record` must list every status or typecheck fails):

```ts
const TITLES: Record<RunRecord['status'], string> = {
  queued: 'Starting…',
  running: 'Working on it',
  stopping: 'Stopping…',
  awaiting_approval: 'Waiting for you',
  succeeded: 'Done',
  failed: 'Stopped partway — Undo or retry',
  cancelled: 'Stopped',
};
```

Replace the `if (active) { … }` block in `renderFooter` with:

```tsx
if (active) {
  const isStopping = run.status === 'stopping';

  return (
    <View style={styles.footer}>
      <Text style={styles.note}>
        {isStopping
          ? 'Nexui is saving the change it was making, then it stops.'
          : "Each change is saved to the plan as it arrives. Closing this sheet doesn't stop it."}
      </Text>
      {isStopping ? null : <Button label="Stop" busy={stopping} onPress={() => onStop(run.id)} />}
    </View>
  );
}
```

- [ ] **Step 8: Run the tests and checks**

Run: `node --experimental-strip-types --test tests/run-contracts.test.mjs tests/runs-store.test.mjs tests/run-stopping-migration.test.mjs tests/run-executor.test.mjs tests/runs-route.test.mjs`
Expected: PASS. `run-executor`'s `'a cancel stops the run after the step that sees it'` still passes: its `onApply` sets `cancelled` directly. Task 2 rewrites it.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
pnpm fix
git add supabase/migrations/20261003000000_run_stopping.sql packages/types/src/runs.ts apps/api/src/lib/runs/store.ts apps/mobile/src/lib/queries.ts apps/mobile/src/components/run-card.tsx tests/support/graph-db.mjs tests/run-contracts.test.mjs tests/runs-store.test.mjs tests/run-stopping-migration.test.mjs
git commit -m "Add a stopping run status so Stop lets the current step finish

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The executor ends a stopped run as cancelled

**Files:**

- Modify: `apps/api/src/lib/runs/execute.ts` (the end of `executeRun`)
- Modify: `tests/run-executor.test.mjs:138-150`

**Interfaces:**

- Consumes: from Task 1, `finishRun(db, runId, 'cancelled', null)`, and the fake DB's `record_run_step` returning `'stopping'`.
- Produces: a run whose `recordRunStep` returns anything but `running` stops after that step and calls `finish_run` with `p_status: 'cancelled'`.

- [ ] **Step 1: Write the failing test**

Replace `'a cancel stops the run after the step that sees it'` in `tests/run-executor.test.mjs` with:

```js
test('Stop lets the current step commit and record, then the run ends cancelled', async (t) => {
  const { fake, db } = start(t, seedRow(travelWorkspace(TRIP_ID), 'A test trip'), {
    onApply: (state) => {
      state.run = { ...state.run, status: 'stopping' };
    },
  });
  const run = createRun();

  await executeRun({ db, run, session: mockSession(run, [createFixture]) }, deps());

  const { state } = fake;

  assert.equal(state.applied.length, 1);
  // The start marker, then the step Stop let finish, with its three calls.
  assert.deepEqual(
    state.steps.map((step) => step.p_entries.length),
    [0, 3],
  );
  assert.equal(state.run.progress.length, 3);
  assert.deepEqual(state.finished, { p_run_id: RUN_ID, p_status: 'cancelled', p_error: null });
  assert.equal(state.run.status, 'cancelled');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/run-executor.test.mjs`
Expected: FAIL. `state.finished.p_status` is `'succeeded'`.

- [ ] **Step 3: Finish stopped runs as cancelled**

In `apps/api/src/lib/runs/execute.ts`, replace the outcome block at the end of the `try` in `executeRun`:

```ts
if (outcome === 'invalid') {
  await finishRun(db, run.id, 'failed', INVALID_RUN_ERROR);
} else if (outcome === 'stopped') {
  await finishRun(db, run.id, 'cancelled', null);
} else {
  await finishRun(db, run.id, 'succeeded', null);
}
```

Change `executeRun`'s doc comment sentence "a cancel stops the run after its current step" to "Stop lets the current step commit, then the run ends cancelled".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/run-executor.test.mjs tests/orchestrator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/api/src/lib/runs/execute.ts tests/run-executor.test.mjs
git commit -m "End a stopped run as cancelled after its last step commits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A trip whose run can't start is discarded

**Files:**

- Modify: `supabase/migrations/20261003000000_run_stopping.sql` (append)
- Modify: `apps/api/src/lib/graph/commit.ts` (add `discardIntent` after `createIntent`)
- Modify: `apps/api/src/lib/orchestrator/orchestrate.ts` (`startIntent`)
- Modify: `tests/support/graph-db.mjs` (option `failCreateRun`, handler `discard_intent`)
- Modify: `tests/orchestrator.test.mjs`, `tests/run-stopping-migration.test.mjs`

**Interfaces:**

- Produces: SQL `public.discard_intent(p_intent_id uuid) returns void`; `discardIntent(db: SupabaseClient, intentId: string): Promise<void>` in `graph/commit.ts`, which throws the mapped RPC error. The fake DB gains `graphDb(row, { failCreateRun: 'XX000' })`, and its `state.discarded` holds the `discard_intent` args.

- [ ] **Step 1: Write the failing tests**

Append to `tests/run-stopping-migration.test.mjs`:

```js
test('discard_intent deletes only the caller’s intent that no run started on', () => {
  const body = sql.match(/create function public\.discard_intent\(([\s\S]*?)\n\$\$;/)?.[1];

  assert.ok(body, 'the migration creates discard_intent');
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /i\.user_id = caller/);
  assert.match(body, /not exists \(select 1 from public\.runs r where r\.intent_id = i\.id\)/);
  assert.match(sql, /revoke execute on function public\.discard_intent\(uuid\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.discard_intent\(uuid\) to authenticated;/);
});
```

In `tests/support/graph-db.mjs`, add `failCreateRun` to the options destructuring (`{ run = runRow(), onApply, onLoad, failApplyOnce, failCreateRun } = {}`), add `discarded: null,` to `state`, and add to the doc comment: "`failCreateRun` makes `create_run` fail with that SQLSTATE." Then change `create_run` and add `discard_intent`:

```js
    create_run: (args) => {
      if (failCreateRun) {
        return pgError(failCreateRun, 500);
      }

      state.createdRun = args;
      state.run = {
        ...state.run,
        intent_id: args.p_intent_id,
        kind: args.p_kind,
        input: args.p_input,
        status: 'queued',
      };

      return state.run;
    },
    discard_intent: (args) => {
      state.discarded = args;
      state.snapshot = null;

      return null;
    },
```

Add to `tests/orchestrator.test.mjs`:

```js
test('a trip whose run cannot start is discarded, and the error stands', async (t) => {
  t.mock.method(console, 'error', () => {});

  const fake = graphDb(null, { failCreateRun: 'XX000' });

  mockSupabaseAuth(t, fake.fetch);

  const tasks = captureRuns(t);
  const deps = {
    db: getUserClient(signToken()),
    openSession: sessionOpener({ AI_PROVIDER: 'mock' }, fixtures),
  };

  await assert.rejects(startIntent(deps, 'A test trip to Lisbon'));
  assert.deepEqual(fake.state.discarded, { p_intent_id: fake.state.created.p_intent_id });
  assert.equal(fake.state.snapshot, null);
  assert.equal(tasks.length, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/orchestrator.test.mjs tests/run-stopping-migration.test.mjs`
Expected: FAIL. `discard_intent` is missing from the SQL, and `state.discarded` is `null`.

- [ ] **Step 3: Add the SQL function**

Append to `supabase/migrations/20261003000000_run_stopping.sql`:

```sql

-- Deletes one of the caller's intents that no run ever started on: a trip whose first run could
-- not be created, so the user isn't left with a plan nothing will fill in. Its graph cascades.
create function public.discard_intent(p_intent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  delete from public.intents i
  where i.id = p_intent_id
    and i.user_id = caller
    and not exists (select 1 from public.runs r where r.intent_id = i.id);

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;
end;
$$;

revoke execute on function public.discard_intent(uuid) from public, anon;
grant execute on function public.discard_intent(uuid) to authenticated;
```

- [ ] **Step 4: Add `discardIntent` and use it in `startIntent`**

In `apps/api/src/lib/graph/commit.ts`, after `createIntent`:

```ts
/** Deletes an intent no run has started on, such as a trip whose run could not be created. */
export async function discardIntent(db: SupabaseClient, intentId: string): Promise<void> {
  const { error } = await db.rpc('discard_intent', { p_intent_id: intentId });

  if (error) {
    throw mapRpcError(error);
  }
}
```

In `apps/api/src/lib/orchestrator/orchestrate.ts`, change the imports (`import { createIntent, discardIntent } from '../graph/commit.ts';`, `import { logLine } from '../graph/respond.ts';`, and `import type { GraphSnapshot, RunRecord, RunRoute } from '@nexui/types';`). Then replace the run creation in `startIntent`:

```ts
const snapshot = await createIntent(deps.db, goal, 'travel');
let run: RunRecord;

try {
  run = await createRun(deps.db, {
    intentId: snapshot.intent.id,
    kind: 'create_intent',
    input: { text: goal, route: 'reasoning', template: 'travel', perception: template.source },
  });
} catch (error) {
  await discardTrip(deps.db, snapshot.intent.id);

  throw error;
}

scheduleRun(() => executeRun({ db: deps.db, run, session }));

return { snapshot, runId: run.id };
```

Add this helper above `startIntent`:

```ts
// A trip with no run would sit empty forever; the run's error is what the user sees.
async function discardTrip(db: SupabaseClient, intentId: string): Promise<void> {
  try {
    await discardIntent(db, intentId);
  } catch (error) {
    console.error('[intents]', logLine(error, 'Could not discard a trip without a run'));
  }
}
```

Add to `startIntent`'s doc comment: "If its run can't be created, the seeded trip is deleted and the error is rethrown."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/orchestrator.test.mjs tests/run-stopping-migration.test.mjs tests/intents-route.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add supabase/migrations/20261003000000_run_stopping.sql apps/api/src/lib/graph/commit.ts apps/api/src/lib/orchestrator/orchestrate.ts tests/support/graph-db.mjs tests/orchestrator.test.mjs tests/run-stopping-migration.test.mjs
git commit -m "Discard a seeded trip when its run cannot be created

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Calls refused for their schema show in run progress

**Files:**

- Modify: `apps/api/src/lib/cognition/run-model.ts` (`StepReport`, `onStepEnd`)
- Modify: `apps/api/src/lib/cognition/tools.ts` (add `capabilityForTool`)
- Modify: `apps/api/src/lib/capabilities/stage.ts` (add `recordRefused`)
- Modify: `apps/api/src/lib/runs/execute.ts` (`StepContext`, `commitStep`)
- Modify: `tests/cognition.test.mjs`, `tests/run-executor.test.mjs`

**Interfaces:**

- Produces:
  - `RefusedCall { toolName: string; input: unknown }`
  - `StepReport.refused: RefusedCall[]`
  - `capabilityForTool(toolName: string, capabilities: readonly Capability[]): string | null`
  - `Stager.recordRefused(name: string, input: unknown): void`
  - `StepContext.capabilities`

Background: when the model's input fails a tool's `inputSchema`, AI SDK 7 never calls `execute`. It adds a `tool-error` part with `dynamic: true` and a string `error` instead. Every Nexui tool is static, so a dynamic `tool-error` is always one of these refused calls.

- [ ] **Step 1: Write the failing tests**

Add to `tests/cognition.test.mjs`:

```js
test('a call whose input breaks the tool schema is reported as refused', async () => {
  const { tools } = setup();
  const reports = [];
  const model = scriptedModel([toolStep([invalidDays]), toolStep([shortenTokyo])]);

  await run(model, tools, 'single', async (report) => {
    reports.push(report.refused);

    return 'continue';
  });

  assert.deepEqual(reports, [
    [{ toolName: 'trip_setPlaceDays', input: { placeId: 'o2', days: -1 } }],
    [],
  ]);
});

test('a tool name maps back to its capability', () => {
  assert.equal(capabilityForTool('trip_setPlaceDays', CAPABILITIES), 'trip.setPlaceDays');
  assert.equal(capabilityForTool('trip_teleport', CAPABILITIES), null);
});

test('the stager records a refused call with the schema’s reason', () => {
  const { stager } = setup();

  stager.recordRefused('trip.setPlaceDays', { placeId: 'o2', days: -1 });

  const [entry] = stager.takeEntries();

  assert.equal(entry.capability, 'trip.setPlaceDays');
  assert.equal(entry.ok, false);
  assert.deepEqual(entry.input, { placeId: 'o2', days: -1 });
  assert.match(entry.error, /^days: /);
  assert.equal(stager.takeOps().length, 0);
});
```

Extend the tools import in `tests/cognition.test.mjs`: `import { capabilityForTool, toModelTools, toolNameFor } from '../apps/api/src/lib/cognition/tools.ts';`.

Add to `tests/run-executor.test.mjs`:

```js
test('a call refused for its schema still shows in progress, and the run goes on', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)));
  const run = askRun('edit');
  const fixture = askFixture('edit', [[setDays('o2', 400)], [setDays('o2', 3)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  const refused = entriesOf(fake.state).filter((entry) => !entry.ok);

  assert.deepEqual(
    refused.map((entry) => [entry.step, entry.capability, entry.input]),
    [[0, 'trip.setPlaceDays', { placeId: 'o2', days: 400 }]],
  );
  assert.match(refused[0].error, /^days: /);
  assert.equal(fake.state.applied.length, 1);
  assert.equal(fake.state.finished.p_status, 'succeeded');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/cognition.test.mjs tests/run-executor.test.mjs`
Expected: FAIL. `report.refused` is undefined, `capabilityForTool` and `recordRefused` don't exist, and progress has no refused entry.

- [ ] **Step 3: Report refused calls from `runModel`**

In `apps/api/src/lib/cognition/run-model.ts`, add above `StepReport`:

```ts
/** A tool call the AI SDK refused before running it, because its input broke the tool's schema. */
export interface RefusedCall {
  toolName: string;
  input: unknown;
}
```

Add a field to `StepReport` after `hadErrors`:

```ts
  /** Calls refused before they ran, which the stager never saw. */
  refused: RefusedCall[];
```

In `onStepEnd`, after `const hadErrors = …`, add:

```ts
// Every Nexui tool is static, so a dynamic tool error is a call the SDK refused.
const refused = step.content.flatMap((part): RefusedCall[] =>
  part.type === 'tool-error' && part.dynamic === true
    ? [{ toolName: part.toolName, input: part.input }]
    : [],
);
```

Pass `refused,` in the `input.onStep({ … })` object, after `hadErrors,`.

- [ ] **Step 4: Map tool names back, and record refusals in the stager**

In `apps/api/src/lib/cognition/tools.ts`, after `toolNameFor`:

```ts
/**
 * The capability a model tool name stands for, or null for a name no capability has.
 *
 * @example
 * capabilityForTool('trip_setPlaceDays', CAPABILITIES) // 'trip.setPlaceDays'
 */
export function capabilityForTool(
  toolName: string,
  capabilities: readonly Capability[],
): string | null {
  return capabilities.find((capability) => toolNameFor(capability.name) === toolName)?.name ?? null;
}
```

In `apps/api/src/lib/capabilities/stage.ts`, add to the `Stager` interface after `call`:

```ts
  /**
   * Records a call the model SDK refused before it ran (its input broke the tool's schema), so
   * the run's progress shows it with the schema's reason. Stages nothing.
   */
  recordRefused(name: string, input: unknown): void;
```

Add the method to the object `createStager` returns, after `call`:

```ts
    recordRefused(name, input) {
      const capability = options.capabilities.find((candidate) => candidate.name === name);
      const parsed = capability?.input.safeParse(input);
      let error = "That action isn't available.";

      if (capability) {
        error = parsed && !parsed.success ? describeIssue(parsed.error) : 'That input is not valid.';
      }

      entries.push({
        capability: name,
        label: `Could not run ${name}`,
        ok: false,
        ms: 0,
        input: entryInput(input),
        error,
      });
    },
```

- [ ] **Step 5: Record refusals before each commit**

In `apps/api/src/lib/runs/execute.ts`, import `capabilityForTool` with `toModelTools` (`import { capabilityForTool, toModelTools } from '../cognition/tools.ts';`), and add to `StepContext`:

```ts
  capabilities: readonly Capability[];
```

At the top of `commitStep`, before `const ops = step.stager.takeOps();`:

```ts
for (const call of report.refused) {
  const name = capabilityForTool(call.toolName, step.capabilities);

  if (name) {
    step.stager.recordRefused(name, call.input);
  }
}
```

In `executeRun`, build the step context with the capabilities: `const step: StepContext = { db, intentId, runId: run.id, stager, clock, newId, capabilities };`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/cognition.test.mjs tests/run-executor.test.mjs`
Expected: PASS. Existing tests that build reports by hand don't construct `StepReport`, so they need no change.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add apps/api/src/lib/cognition/run-model.ts apps/api/src/lib/cognition/tools.ts apps/api/src/lib/capabilities/stage.ts apps/api/src/lib/runs/execute.ts tests/cognition.test.mjs tests/run-executor.test.mjs
git commit -m "Record tool calls refused for their schema in run progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A forced step that fails and then answers in text is invalid

**Files:**

- Modify: `apps/api/src/lib/cognition/run-model.ts` (the `catch` after `generateText`)
- Modify: `tests/cognition.test.mjs`, `tests/run-executor.test.mjs`

**Interfaces:**

- Produces: `runModel` returns `'invalid'` when `ToolChoiceViolationError` follows a step with errors, and `'finished'` when the first forced step answers in text.

- [ ] **Step 1: Write the failing tests**

Add to `tests/cognition.test.mjs` after `'a forced step that answers in text changes nothing and finishes'`:

```js
test('a forced step that fails and then answers in text is invalid', async () => {
  const { tools } = setup();
  const model = scriptedModel([toolStep([invalidDays]), textStep()]);

  assert.equal(await run(model, tools, 'single', async () => 'continue'), 'invalid');
});
```

Add to `tests/run-executor.test.mjs`. The mock model answers in text once a fixture runs out of steps, so a one-step fixture is a failed call followed by text:

```js
test('an edit that fails and then gives up in text fails the run as invalid', async (t) => {
  const { fake, db } = start(t, snapshotRow(travelWorkspace(TRIP_ID)));
  const run = askRun('edit');
  const fixture = askFixture('edit', [[setDays('o2', 400)]]);

  await executeRun({ db, run, session: mockSession(run, [fixture]) }, deps());

  assert.equal(fake.state.applied.length, 0);
  assert.deepEqual(fake.state.finished, {
    p_run_id: RUN_ID,
    p_status: 'failed',
    p_error: INVALID_RUN_ERROR,
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/cognition.test.mjs tests/run-executor.test.mjs`
Expected: FAIL with `'finished' !== 'invalid'`, and with the executor test's `p_status: 'succeeded'`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/cognition/run-model.ts`, replace the `catch` block after `generateText`:

```ts
  } catch (error) {
    if (!ToolChoiceViolationError.isInstance(error)) {
      throw error;
    }

    // A forced step answered in text. After a refused step, the model gave up on the change it
    // was asked for; as the first step, it found nothing to change.
    if (invalidStreak > 0 && outcome === null) {
      outcome = 'invalid';
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/cognition.test.mjs tests/run-executor.test.mjs`
Expected: PASS, including `'a forced step that answers in text changes nothing and finishes'`.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/api/src/lib/cognition/run-model.ts tests/cognition.test.mjs tests/run-executor.test.mjs
git commit -m "Treat a forced step that fails then answers in text as invalid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The data help text states the schema limits

**Files:**

- Modify: `apps/api/src/lib/capabilities/graph.ts:24-30`
- Modify: `tests/capabilities-graph.test.mjs`

**Interfaces:**

- Produces: `DATA_HELP` mentions `days (whole days, 0 to 365)`, `estHours? (0 to 200)` and `nights (1 to 365)`, matching `placeDataSchema`, `legDataSchema` and `stayDataSchema`.

- [ ] **Step 1: Write the failing test**

Add to `tests/capabilities-graph.test.mjs` (add `import { legDataSchema, placeDataSchema, stayDataSchema } from '../packages/types/src/index.ts';`):

```js
test('the help text states the same limits as the kind schemas', () => {
  const create = GRAPH_CAPABILITIES.find((candidate) => candidate.name === 'object.create');
  const dataHelp = create.input.shape.data.description;
  const days = placeDataSchema.shape.days;
  const hours = legDataSchema.shape.estHours.unwrap();
  const nights = stayDataSchema.shape.nights;

  assert.match(dataHelp, new RegExp(`days \\(whole days, ${days.minValue} to ${days.maxValue}\\)`));
  assert.match(dataHelp, new RegExp(`estHours\\? \\(${hours.minValue} to ${hours.maxValue}\\)`));
  assert.match(dataHelp, new RegExp(`nights \\(${nights.minValue} to ${nights.maxValue}\\)`));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/capabilities-graph.test.mjs`
Expected: FAIL. The help text says "0 or more", has no hours range, and says "1 or more".

- [ ] **Step 3: Implement**

Replace `DATA_HELP` in `apps/api/src/lib/capabilities/graph.ts`:

```ts
const DATA_HELP =
  'Fields by kind. place: name, country (ISO 3166-1 alpha-2 such as JP), placeType ' +
  '(city|region|town|area|site), lat (-90 to 90), lng (-180 to 180), days (whole days, 0 to ' +
  '365), estDailyCost? {amount, currency}, why? (one short sentence). leg: mode ' +
  '(flight|train|bus|car|ferry|other), estHours? (0 to 200), estCost? {amount, currency}. ' +
  'stay: name, placeId (a place ref), nights (1 to 365), estNightly? {amount, currency}, url? ' +
  '(absolute URL). thing: fields [{label, value}].';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/capabilities-graph.test.mjs`
Expected: PASS, including the existing money-shape test.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/api/src/lib/capabilities/graph.ts tests/capabilities-graph.test.mjs
git commit -m "State the days, hours and nights limits in the model's data help

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Proposals carry hints and remember what was asked

**Files:**

- Modify: `packages/types/src/kinds/travel.ts` (`decisionDataSchema`, `optionDataSchema`)
- Modify: `apps/api/src/lib/capabilities/types.ts` (`CapabilityContext.request`)
- Modify: `apps/api/src/lib/capabilities/stage.ts` (`StagerOptions.request`, the context passed to `execute`)
- Modify: `apps/api/src/lib/runs/execute.ts` (pass `request: run.input.text`)
- Modify: `apps/api/src/lib/capabilities/decisions.ts` (`optionInput`, `propose`)
- Modify: `tests/capabilities-travel.test.mjs`

**Interfaces:**

- Produces:
  - `DecisionData.asked?: string` (at most 300 characters);
  - `OptionData.suggestedDays?: number` (a whole number from 1 to 365);
  - `OptionData.leg?: { mode; estHours?; estCost?; fromPlaceId: string }`;
  - `StagerOptions.request?: string`, and `CapabilityContext.request: string | null`;
  - the model input of `decision.propose`, where each option's `place.days` is optional (1–365) and `leg?: LegData` is new.

- [ ] **Step 1: Write the failing test**

Add to `tests/capabilities-travel.test.mjs`:

```js
test('an AI proposal remembers what was asked, and its options keep their hints', () => {
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot: shortened,
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
    clock,
    request: 'How should I use the 1 day I have free?',
  });

  s.call('decision.propose', {
    ...proposal,
    options: [
      {
        ...proposal.options[0],
        place: { ...nara, days: 2 },
        leg: { mode: 'train', estHours: 0.75 },
      },
      { ...proposal.options[1], leg: { mode: 'bus' } },
    ],
  });

  const [decision, , place, option1, , option2] = s.takeOps();

  assert.equal(decision.data.asked, 'How should I use the 1 day I have free?');
  assert.deepEqual(place.data, { ...nara, days: 0 });
  assert.equal(option1.data.suggestedDays, 2);
  assert.deepEqual(option1.data.leg, { mode: 'train', estHours: 0.75, fromPlaceId: KYOTO_ID });
  // A leg hint means nothing without a place to go to.
  assert.equal(option2.data.leg, undefined);
  assert.equal(option2.data.suggestedDays, undefined);
});

test('a suggested length is a whole number of days from 1 to 365', () => {
  const s = stager();

  assert.throws(
    () =>
      s.call('decision.propose', {
        ...proposal,
        options: [{ ...proposal.options[0], place: { ...nara, days: 0 } }, proposal.options[1]],
      }),
    refused(/days/),
  );
});
```

The existing `'decision.propose adds the question, its options and a pinned section'` test must still pass unchanged. Its stager has no `request`, so `decision.data` has no `asked`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/capabilities-travel.test.mjs`
Expected: FAIL. `leg` is an unrecognized key in the strict option input, and `asked` is undefined.

- [ ] **Step 3: Extend the kind schemas**

In `packages/types/src/kinds/travel.ts`, add to `decisionDataSchema` after `derivedKey`:

```ts
  /** What the user asked the run that proposed this, shown as "You asked …". */
  asked: z.string().max(300).optional(),
```

Add to `optionDataSchema` after `fit`:

```ts
  /** Days the proposer suggests for this option's place when the trip has none free. */
  suggestedDays: z.number().int().min(1).max(365).optional(),
  /** How to reach this option's place from `fromPlaceId`, the last stop when it was proposed. */
  leg: legDataSchema.extend({ fromPlaceId: idSchema }).optional(),
```

- [ ] **Step 4: Pass the request into the capability context**

In `apps/api/src/lib/capabilities/types.ts`, add to `CapabilityContext` after `runId`:

```ts
/** What the user asked the run, for a call the AI made; null for a button press. */
request: string | null;
```

In `apps/api/src/lib/capabilities/stage.ts`, add to `StagerOptions` after `runId`:

```ts
  /** The run's request, handed to capabilities (a proposal shows it as "You asked …"). */
  request?: string;
```

In `stage()`, add `request: options.request ?? null,` to the object passed to `capability.execute(parsed.data, { … })`, after `runId: options.runId,`.

In `apps/api/src/lib/runs/execute.ts`, add `request: run.input.text,` to the `createStager({ … })` call after `runId: run.id,`.

- [ ] **Step 5: Record hints and the request in `decision.propose`**

In `apps/api/src/lib/capabilities/decisions.ts`, add `legDataSchema` to the `@nexui/types` import and replace `optionInput`:

```ts
const optionInput = z.strictObject({
  label: z.string().min(1).max(100),
  summary: z.string().max(400),
  pros: z.array(z.string().max(120)).max(8).optional(),
  cons: z.array(z.string().max(120)).max(8).optional(),
  metrics: z
    .record(z.string().max(40), z.number())
    .optional()
    .describe('Up to 12 numbers to compare, such as {"hoursFromKyoto": 1}'),
  fit: z.string().max(120).optional().describe('One line on how it fits this trip'),
  place: placeDataSchema
    .extend({
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Days you'd suggest here if the trip has none free"),
    })
    .optional()
    .describe('The place this option would add to the route'),
  leg: legDataSchema.optional().describe('Getting to that place from the current last stop'),
});
```

Change `propose`'s description to:

```ts
  description:
    'Put a choice to the user: a question with 2 to 4 options, pinned at the top of the plan. ' +
    'Use it instead of choosing for them. An option that would add a place carries that place, ' +
    "the days you'd suggest there, and how to get there from the last stop.",
```

In `propose.execute`, after `const decision: DecisionData = …` and its `tradeoff` block, add:

```ts
if (ctx.actor === 'ai' && ctx.request) {
  decision.asked = ctx.request.slice(0, 300);
}

const last = tripPlaces(ctx).at(-1);
```

Replace the `if (option.place) { … }` block inside `input.options.forEach` with:

```ts
// A candidate place is not part of the trip until the user picks it.
if (option.place) {
  const { days: suggestedDays, ...place } = option.place;
  const placeId = ctx.newId();

  data.placeId = placeId;

  if (suggestedDays !== undefined) {
    data.suggestedDays = suggestedDays;
  }

  if (option.leg && last) {
    data.leg = { ...option.leg, fromPlaceId: last.id };
  }

  refs[`${optionRef}-place`] = placeId;
  ops.push(
    insertObject(ctx, {
      id: placeId,
      kind: 'place',
      title: place.name,
      data: { ...place, days: 0 },
      position: null,
    }),
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/capabilities-travel.test.mjs tests/cognition.test.mjs tests/run-executor.test.mjs`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS. Every `CapabilityContext` is built in `stage.ts`, so nothing else needs `request`.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add packages/types/src/kinds/travel.ts apps/api/src/lib/capabilities/types.ts apps/api/src/lib/capabilities/stage.ts apps/api/src/lib/runs/execute.ts apps/api/src/lib/capabilities/decisions.ts tests/capabilities-travel.test.mjs
git commit -m "Let proposals suggest days and a leg, and remember the request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Settling a decision: days, leg and candidate cleanup

**Files:**

- Modify: `apps/api/src/lib/capabilities/decisions.ts` (`addChosenPlace`, new helpers, `resolve`)
- Modify: `tests/capabilities-travel.test.mjs`

**Interfaces:**

- Consumes: `OptionData.suggestedDays` and `OptionData.leg` from Task 7.
- Produces: `decision.resolve`'s changeset, in this order:
  - the decision update;
  - the chosen place's update, `part_of` link and leg ops;
  - `delete_object` (plus `delete_relationship` for any links) for each unpicked candidate not on the route;
  - the workspace update.

- [ ] **Step 1: Write the failing tests**

In `tests/capabilities-travel.test.mjs` (`tripData`, `tokyoData`, `objectRow`, `kyotoRow`, `KYOTO_ID` and `TOKYO_ID` are already imported), add after the `proposal` constant:

```js
// Two options with places: Nara (suggests 2 days, with a train from Kyoto) and Koyasan.
const koyasan = { name: 'Koyasan', country: 'JP', placeType: 'town', lat: 34.21, lng: 135.59 };
const twoPlaces = {
  ref: 'spare',
  question: 'Where should the spare time go?',
  options: [
    {
      label: 'Nara',
      summary: 'Temples and deer.',
      place: { ...nara, days: 2 },
      leg: { mode: 'train', estHours: 0.75, estCost: { amount: 7, currency: 'USD' } },
    },
    { label: 'Koyasan', summary: 'A temple stay.', place: koyasan },
  ],
};

// The plan-1 trip (Tokyo 3 days, then Kyoto) with this many free days.
function proposedWithFree(unallocatedDays) {
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        objectRow(
          TRIP_ID,
          'trip',
          { ...tripData, derived: { ...tripData.derived, unallocatedDays } },
          { title: 'Plan Japan in December' },
        ),
        objectRow(TOKYO_ID, 'place', { ...tokyoData, days: 3 }, { title: 'Tokyo', position: 1 }),
        kyotoRow,
      ],
    }),
  );
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot,
    actor: 'user',
    runId: null,
    newId: idSequence(),
    clock,
  });

  s.call('decision.propose', twoPlaces);
  s.takeOps();

  return s;
}

const placeUpdate = (ops, id) => ops.find((op) => op.op === 'update_object' && op.id === id);
const newLeg = (ops) => ops.find((op) => op.op === 'insert_object' && op.kind === 'leg');
const deletedIds = (ops) => ops.filter((op) => op.op === 'delete_object').map((op) => op.id);
```

Then the tests:

```js
test('a pick takes the free days, and the leg hint while its stop is still last', () => {
  const s = proposedWithFree(3);

  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  const ops = s.takeOps();

  assert.equal(placeUpdate(ops, s.refs.byRef.get('spare-1-place')).patch.data.days, 3);
  assert.equal(newLeg(ops).title, 'Kyoto → Nara');
  assert.deepEqual(newLeg(ops).data, {
    mode: 'train',
    estHours: 0.75,
    estCost: { amount: 7, currency: 'USD' },
  });
});

test('with no free days a pick takes the suggested days, then 1', () => {
  const cases = [
    [null, 'spare-1', 2],
    [-2, 'spare-1', 2],
    [0, 'spare-2', 1],
    [null, 'spare-2', 1],
  ];

  for (const [free, optionId, days] of cases) {
    const s = proposedWithFree(free);

    s.call('decision.resolve', { decisionId: 'spare', optionId });

    const placeId = s.refs.byRef.get(`${optionId}-place`);

    assert.equal(
      placeUpdate(s.takeOps(), placeId).patch.data.days,
      days,
      `${free} free, ${optionId}`,
    );
  }
});

test('a leg hint from a stop that is no longer last is not used', () => {
  const s = proposedWithFree(1);

  s.call('trip.reorderPlaces', { placeIds: [KYOTO_ID, TOKYO_ID] });
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  const leg = newLeg(s.takeOps());

  assert.equal(leg.title, 'Tokyo → Nara');
  assert.deepEqual(leg.data, { mode: 'other' });
});

test('a pick deletes the candidates nobody chose and keeps the decision as a record', () => {
  const s = proposedWithFree(1);
  const naraId = s.refs.byRef.get('spare-1-place');
  const koyasanId = s.refs.byRef.get('spare-2-place');

  s.call('decision.resolve', { decisionId: 'spare', optionId: 'spare-1' });

  assert.deepEqual(deletedIds(s.takeOps()), [koyasanId]);
  assert.ok(s.graph().objects.some((object) => object.id === naraId));
  assert.equal(s.graph().objects.filter((object) => object.kind === 'option').length, 2);
  assert.equal(
    s
      .graph()
      .objects.find((object) => object.kind === 'decision' && object.title === twoPlaces.question)
      .data.status,
    'resolved',
  );
});

test('dismissing deletes every candidate except one the user put on the route', () => {
  const s = proposedWithFree(1);
  const naraId = s.refs.byRef.get('spare-1-place');
  const koyasanId = s.refs.byRef.get('spare-2-place');

  s.call('relationship.create', { from: 'spare-1-place', type: 'part_of', to: 'trip' });
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'spare' });

  assert.deepEqual(deletedIds(s.takeOps()), [koyasanId]);
  assert.ok(s.graph().objects.some((object) => object.id === naraId));
});
```

Update the existing `'dismissing a decision closes it and removes its section'` test. Its proposal's first option carries Nara, which is now deleted:

```js
test('dismissing a decision closes it, deletes its candidate and removes its section', () => {
  const s = stager();

  s.call('decision.propose', proposal);
  s.takeOps();
  s.call('decision.resolve', { decisionId: 'rural' });

  const [decision, deleted, workspace] = s.takeOps();

  assert.equal(decision.patch.data.status, 'dismissed');
  assert.deepEqual(deleted, {
    op: 'delete_object',
    id: s.refs.byRef.get('rural-1-place'),
    origin: 'direct',
  });
  assert.equal(workspace.doc.sections.length, 5);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/capabilities-travel.test.mjs`
Expected: FAIL. Days come out as `0` instead of the suggestion or 1, the leg is `{ mode: 'other' }` instead of the hint, and nothing is deleted.

- [ ] **Step 3: Implement days, leg and cleanup**

In `apps/api/src/lib/capabilities/decisions.ts`, add `unlinkOps` to the `./helpers.ts` import and `type LegData` to the `@nexui/types` import. Replace `addChosenPlace` with these three functions:

```ts
// The days a chosen place gets: the trip's free days, else what its option suggested, else 1.
function chosenDays(ctx: CapabilityContext, option: OptionData): number {
  const trip = ctx.graph.objects.find((object) => object.id === ctx.anchorId);
  const free = (trip?.data as TripData | undefined)?.derived?.unallocatedDays ?? null;

  if (free !== null && free > 0) {
    return free;
  }

  return option.suggestedDays ?? 1;
}

// The new leg's data: the option's hint while the stop it was measured from is still last.
function chosenLeg(option: OptionData, last: GraphObject): LegData {
  const hint = option.leg;

  if (!hint || hint.fromPlaceId !== last.id) {
    return { mode: 'other' };
  }

  const leg: LegData = { mode: hint.mode };

  if (hint.estHours !== undefined) {
    leg.estHours = hint.estHours;
  }

  if (hint.estCost) {
    leg.estCost = hint.estCost;
  }

  return leg;
}

// Puts the chosen option's place on the route: last, with `chosenDays`, and a leg from the stop
// before it. A place already on the route stays as it is.
function addChosenPlace(ctx: CapabilityContext, option: GraphObject): ChangesetOp[] {
  const data = option.data as OptionData;

  if (!data.placeId) {
    return [];
  }

  const place = ctx.graph.objects.find((object) => object.id === data.placeId);

  if (place?.kind !== 'place') {
    throw new CapabilityError('That option’s place no longer exists.');
  }

  const onRoute = ctx.graph.relationships.some(
    (edge) =>
      edge.type === 'part_of' && edge.sourceId === place.id && edge.targetId === ctx.anchorId,
  );

  if (onRoute) {
    return [];
  }

  const last = tripPlaces(ctx).at(-1);
  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: place.id,
      patch: {
        data: { ...place.data, days: chosenDays(ctx, data) },
        position: nextPosition(ctx),
      },
      origin: 'direct',
    },
    link(ctx, place.id, 'part_of', ctx.anchorId),
  ];

  if (last) {
    const legId = ctx.newId();

    ops.push(
      insertObject(ctx, {
        id: legId,
        kind: 'leg',
        title: `${nameOf(last)} → ${nameOf(place)}`,
        data: chosenLeg(data, last),
        position: null,
      }),
      link(ctx, legId, 'part_of', ctx.anchorId),
      link(ctx, legId, 'leg_from', last.id),
      link(ctx, legId, 'leg_to', place.id),
    );
  }

  return ops;
}

// Deletes the candidate places of a settled decision's options, except the chosen one's and any
// the user already put on the route. Undo of the changeset restores them.
function removeCandidates(
  ctx: CapabilityContext,
  decisionId: string,
  chosenOptionId: string | null,
): ChangesetOp[] {
  const onRoute = new Set(tripPlaces(ctx).map((place) => place.id));
  const gone = ctx.graph.relationships
    .filter((edge) => edge.type === 'option_of' && edge.targetId === decisionId)
    .filter((edge) => edge.sourceId !== chosenOptionId)
    .map((edge) => ctx.graph.objects.find((object) => object.id === edge.sourceId))
    .map((option) => (option?.data as Partial<OptionData> | undefined)?.placeId)
    .filter((placeId): placeId is string => typeof placeId === 'string')
    .filter(
      (placeId) =>
        !onRoute.has(placeId) &&
        ctx.graph.objects.some((object) => object.id === placeId && object.kind === 'place'),
    );

  return [
    ...gone.map((id): ChangesetOp => ({ op: 'delete_object', id, origin: 'direct' })),
    ...unlinkOps(ctx, gone),
  ];
}
```

In `resolve.execute`, after the `if (input.optionId) { … }` block, add the cleanup and include it in `ops`:

```ts
const chosenOptionId = next.status === 'resolved' ? (next.chosenOptionId ?? null) : null;
const ops: ChangesetOp[] = [
  { op: 'update_object', id: decision.id, patch: { data: next }, origin: 'direct' },
  ...placeOps,
  ...removeCandidates(ctx, decision.id, chosenOptionId),
];
```

This replaces the existing `const ops: ChangesetOp[] = [ … ];`. Update `resolve`'s description:

```ts
  description:
    'Settle an open decision with one of its options, or dismiss it by leaving optionId out. ' +
    'Choosing an option with a place adds that place to the end of the route with the free ' +
    'days (or its suggested days), and a leg to it. Candidates nobody chose are removed.',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/capabilities-travel.test.mjs tests/capabilities-route.test.mjs tests/mobile-workspace-actions.test.mjs`
Expected: PASS. In `'choosing an option puts its place on the route with the free days and a leg'`, the second option has no place, so it still yields exactly 8 ops.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/api/src/lib/capabilities/decisions.ts tests/capabilities-travel.test.mjs
git commit -m "Settle decisions with suggested days, leg hints and candidate cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: "You asked …" on the decision card

**Files:**

- Modify: `apps/mobile/src/components/sections/decision-section.tsx`

**Interfaces:**

- Consumes: `DecisionData.asked` from Task 7.

- [ ] **Step 1: Render the line**

In `decision-section.tsx`, between `{mark.highlight ? <NexuiTag label={proposedBy} /> : null}` and the `<AiText … />` question, add:

```tsx
{
  details.asked ? (
    <Text numberOfLines={2} style={styles.asked}>
      <Text style={styles.askedLabel}>You asked </Text>“{details.asked}”
    </Text>
  ) : null;
}
```

Add the styles to `useStyles`:

```ts
  asked: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  askedLabel: { fontFamily: fonts.bodyBold, color: colors.muted },
```

Add to the component's doc comment: "A proposal shows what the user asked above its question."

- [ ] **Step 2: Check it**

Run: `pnpm typecheck && pnpm lint && node --experimental-strip-types --test tests/theme-tokens.test.mjs tests/mobile-sections.test.mjs`
Expected: PASS. Task 16's Expo smoke test checks it visually in light and dark.

- [ ] **Step 3: Commit**

```bash
pnpm fix
git add apps/mobile/src/components/sections/decision-section.tsx
git commit -m "Show what the user asked on a proposed decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The + sheet after an in-plan ask

**Files:**

- Create: `apps/mobile/src/lib/run-outcome.ts`
- Create: `apps/mobile/src/stores/use-reveal-store.ts`
- Create: `tests/mobile-run-outcome.test.mjs`
- Modify: `apps/mobile/src/app/(app)/compose.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`
- Modify: `apps/mobile/src/components/run-card.tsx` (success footer)

**Interfaces:**

- Produces:
  - `afterAsk(run: Pick<RunRecord, 'status' | 'progress'> | undefined): 'choice' | 'plan' | null`;
  - `useRevealStore`, with state `{ intentId: string | null }`;
  - `revealOpenBand(intentId: string | null): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/mobile-run-outcome.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { afterAsk } from '../apps/mobile/src/lib/run-outcome.ts';

const entry = (capability, ok = true) => ({
  step: 0,
  capability,
  label: capability,
  ok,
  ms: 1,
  input: null,
});

test('a run that proposed a decision offers the choice', () => {
  assert.equal(afterAsk({ status: 'succeeded', progress: [entry('decision.propose')] }), 'choice');
});

test('any other run that succeeded goes back to the plan', () => {
  assert.equal(afterAsk({ status: 'succeeded', progress: [entry('trip.setPlaceDays')] }), 'plan');
  assert.equal(afterAsk({ status: 'succeeded', progress: [] }), 'plan');
  assert.equal(
    afterAsk({ status: 'succeeded', progress: [entry('decision.propose', false)] }),
    'plan',
  );
});

test('a working, failed or stopped run offers nothing; the run card has Retry', () => {
  for (const status of ['queued', 'running', 'stopping', 'failed', 'cancelled']) {
    assert.equal(afterAsk({ status, progress: [entry('decision.propose')] }), null, status);
  }

  assert.equal(afterAsk(undefined), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/mobile-run-outcome.test.mjs`
Expected: FAIL with ERR_MODULE_NOT_FOUND for `run-outcome.ts`.

- [ ] **Step 3: Write `afterAsk` and the reveal store**

Create `apps/mobile/src/lib/run-outcome.ts`:

```ts
import type { RunRecord } from '@nexui/types';

/** What the + sheet offers once an ask from inside a plan is done. */
export type AfterAsk = 'choice' | 'plan' | null;

/**
 * `choice` when the run put a question to the user, `plan` for any other run that succeeded,
 * and null while it works or after it failed or stopped (the run card offers Retry then).
 *
 * @example
 * afterAsk({ status: 'succeeded', progress: [{ capability: 'decision.propose', ok: true, … }] })
 * // 'choice'
 */
export function afterAsk(run: Pick<RunRecord, 'status' | 'progress'> | undefined): AfterAsk {
  if (run?.status !== 'succeeded') {
    return null;
  }

  return run.progress.some((entry) => entry.ok && entry.capability === 'decision.propose')
    ? 'choice'
    : 'plan';
}
```

Create `apps/mobile/src/stores/use-reveal-store.ts`:

```ts
import { create } from 'zustand';

interface RevealState {
  /** The plan whose Open band should scroll into view when its workspace shows next. */
  intentId: string | null;
}

/** Set by the + sheet's "See the choice"; the workspace scrolls to its Open band and clears it. */
export const useRevealStore = create<RevealState>(() => ({ intentId: null }));

export function revealOpenBand(intentId: string | null): void {
  useRevealStore.setState({ intentId });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/mobile-run-outcome.test.mjs`
Expected: PASS.

- [ ] **Step 5: Offer the next step in the sheet, with one Realtime channel**

In `apps/mobile/src/app/(app)/compose.tsx`:

Add imports:

```ts
import { afterAsk } from '@/lib/run-outcome';
import { revealOpenBand } from '@/stores/use-reveal-store';
```

Replace `useIntentLive(target);` with:

```ts
// A plan open underneath keeps its own Realtime channel, so the sheet only listens for a plan
// it started.
useIntentLive(params.intentId ? null : target);
```

After `const goal = context.data?.intent.goal;`, add:

```ts
const next = params.intentId ? afterAsk(run.data) : null;
```

After `seeChanges`, add:

```ts
const seeChoice = (): void => {
  if (target) {
    revealOpenBand(target);
  }

  router.dismiss();
};
```

After the `{sent?.runId ? ( <RunCard … /> ) : null}` block, add:

```tsx
{
  next === 'choice' ? (
    <Button label="See the choice" variant="primary" onPress={seeChoice} />
  ) : null;
}
{
  next === 'plan' ? (
    <Button label="Back to plan" variant="primary" onPress={() => router.dismiss()} />
  ) : null;
}
```

Add to the component's doc comment: "After an ask about the plan underneath, it offers See the choice (when Nexui proposed one) or Back to plan."

- [ ] **Step 6: Keep "See changes" as the secondary link on success**

In `apps/mobile/src/components/run-card.tsx`, replace the final `return ( <Text style={styles.note}>…</Text> );` of `renderFooter` with:

```tsx
return (
  <View style={styles.footer}>
    <Text style={styles.note}>
      {lines.length === 1 ? '1 change' : `${lines.length} changes`} saved to the plan.
    </Text>
    <Button label="See changes" variant="text" onPress={onSeeChanges} />
  </View>
);
```

- [ ] **Step 7: Scroll the workspace to its Open band**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

Add the import `import { revealOpenBand, useRevealStore } from '@/stores/use-reveal-store';`.

After `const wasDrafting = useRef(drafting);`, add:

```ts
const scroll = useRef<ScrollView>(null);
const pageY = useRef(0);
const [openY, setOpenY] = useState<number | null>(null);
const reveal = useRevealStore((state) => state.intentId === id);
```

After the `blocks` `useMemo`, add:

```ts
const hasOpenBand = blocks.some((block) => block.kind === 'open');
const bandY = hasOpenBand ? openY : null;

// "See the choice" in the + sheet: bring the Open band into view once it's laid out, or give
// up when the loaded plan has nothing open (it was settled meanwhile).
useEffect(() => {
  if (!reveal) {
    return;
  }

  if (bandY !== null) {
    scroll.current?.scrollTo({ y: Math.max(0, pageY.current + bandY - 8), animated: true });
    revealOpenBand(null);
  } else if (!hasOpenBand && intent.isSuccess && !intent.isFetching) {
    revealOpenBand(null);
  }
}, [reveal, bandY, hasOpenBand, intent.isSuccess, intent.isFetching]);
```

In `renderBody`, give the page view a layout handler: `<View style={styles.page} onLayout={(event) => { pageY.current = event.nativeEvent.layout.y; }}>`. Give the Open band view one too: `<View key="open" style={styles.open} onLayout={(event) => setOpenY(event.nativeEvent.layout.y)}>`. Give the screen's `ScrollView` the ref: `<ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.content}>`.

Add to the screen's doc comment: "The + sheet's See the choice scrolls the Open band into view."

- [ ] **Step 8: Check it**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Task 16's smoke test covers the flow on Expo web.

- [ ] **Step 9: Commit**

```bash
pnpm fix
git add apps/mobile/src/lib/run-outcome.ts apps/mobile/src/stores/use-reveal-store.ts tests/mobile-run-outcome.test.mjs "apps/mobile/src/app/(app)/compose.tsx" "apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx" apps/mobile/src/components/run-card.tsx
git commit -m "Offer See the choice or Back to plan after an ask in a plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: A shared QA helper for the scripts

**Files:**

- Create: `scripts/lib/qa-api.mjs`
- Modify: `scripts/try-run.mjs`, `scripts/smoke-intent-graph.mjs`

**Interfaces:**

- Consumes: `isActiveRunStatus` from Task 1.
- Produces, in `scripts/lib/qa-api.mjs`:
  - `readSession(path?: string): Session`;
  - `qaApi(session, api?): { call(method, path, body?): Promise<any>; waitForRun(runId, seconds = 300): Promise<RunRecord> }`;
  - `qaAdmin(): Promise<SupabaseClient>`, which uses the secret key and refuses unless `SUPABASE_URL` is the `QA_SUPABASE_REF` project;
  - `printRun(run): void`;
  - `printPlan(call, intentId): Promise<GraphSnapshot>`.

- [ ] **Step 1: Write the helper**

Create `scripts/lib/qa-api.mjs`:

```js
/**
 * Calls the API as the QA user, for the scripts in `scripts/`. Needs the API running and a QA
 * session from `node scripts/qa-session.mjs > .qa/session.json`. NEXUI_SESSION and NEXUI_API
 * override .qa/session.json and http://localhost:3000.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { isActiveRunStatus } from '../../packages/types/src/runs.ts';

/** The session `qa-session.mjs` saved. */
export function readSession(path = process.env.NEXUI_SESSION ?? '.qa/session.json') {
  return JSON.parse(readFileSync(path, 'utf8')).session;
}

/** `call` and `waitForRun` against `api`, with the session's token. */
export function qaApi(session, api = process.env.NEXUI_API ?? 'http://localhost:3000') {
  const headers = {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };

  async function call(method, path, body) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();

    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`);
    }

    return json;
  }

  // Polls until the run is no longer queued, running or stopping.
  async function waitForRun(runId, seconds = 300) {
    for (let attempt = 0; attempt < seconds; attempt += 1) {
      const run = await call('GET', `/api/runs/${runId}`);

      if (!isActiveRunStatus(run.status)) {
        return run;
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`run ${runId} did not finish in ${seconds} seconds`);
  }

  return { call, waitForRun };
}

/**
 * A Supabase client with the secret key, for the scripts' own bookkeeping (tagging and cleaning
 * up eval plans). Refuses unless apps/api/.env.local's SUPABASE_URL is the QA_SUPABASE_REF project.
 */
export async function qaAdmin() {
  process.loadEnvFile('apps/api/.env.local');

  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const ref = process.env.QA_SUPABASE_REF?.trim();

  if (!url || !secretKey || !ref) {
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_SECRET_KEY and QA_SUPABASE_REF in apps/api/.env.local.',
    );
  }

  if (new URL(url).hostname.split('.')[0] !== ref) {
    throw new Error('SUPABASE_URL is not the QA_SUPABASE_REF project. Refusing.');
  }

  const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
  const { createClient } = await import(apiRequire.resolve('@supabase/supabase-js'));

  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function printRun(run) {
  console.log(`run ${run.id}: ${run.status}${run.error ? ` (${run.error})` : ''}`);

  for (const entry of run.progress) {
    console.log(`  step ${entry.step} ${entry.ok ? 'ok ' : 'err'} ${entry.error ?? entry.label}`);
  }

  const usage = run.modelUsage;

  console.log(
    `  ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out (${usage.model ?? '-'})`,
  );
}

export async function printPlan(call, intentId) {
  const snapshot = await call('GET', `/api/intents/${intentId}`);
  const { line, badge } = snapshot.intent.summary;

  console.log(`intent ${intentId}: "${line}" ${badge?.text ?? ''}`);

  for (const object of snapshot.objects.filter((o) =>
    ['place', 'leg', 'decision'].includes(o.kind),
  )) {
    const detail =
      object.kind === 'place'
        ? ` ${object.data.days}d @ ${object.data.lat},${object.data.lng}`
        : '';

    console.log(`  ${object.kind} ${object.title}${detail}`);
  }

  return snapshot;
}
```

- [ ] **Step 2: Use it in `try-run.mjs`**

In `scripts/try-run.mjs`:

- Delete `api`, the session read, `headers`, `call`, `waitForRun`, `printRun` and `printPlan`, plus the `readFileSync` import.
- Add after the `assert` import:

```js
import { printPlan, printRun, qaApi, readSession } from './lib/qa-api.mjs';
```

- After `const [command, ...args] = process.argv.slice(2);`, add `const { call, waitForRun } = qaApi(readSession());`.
- Replace each `printPlan(x)` call with `printPlan(call, x)`. There are three: in `freeDay`, in `goal` and in `ask`.

- [ ] **Step 3: Use it in `smoke-intent-graph.mjs`**

In `scripts/smoke-intent-graph.mjs`:

- Delete the session read, `headers`, `call` and `waitForRun`, plus the `readFileSync` import.
- Add `import { qaApi, readSession } from './lib/qa-api.mjs';`.
- After the `process.argv` line, add:

```js
const { call, waitForRun } = qaApi(readSession(sessionPath), api);
```

The smoke script used to wait 60 seconds. `waitForRun` now defaults to 300, which is fine.

- [ ] **Step 4: Check the scripts load**

Run: `node --check scripts/lib/qa-api.mjs && node --check scripts/try-run.mjs && node --check scripts/smoke-intent-graph.mjs && node scripts/try-run.mjs 2>&1 | tail -1`
Expected: no syntax errors. The last command prints the usage line, or fails reading `.qa/session.json` if no session exists, which is fine at this point. Task 13 runs the smoke script end to end.

Run: `pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add scripts/lib/qa-api.mjs scripts/try-run.mjs scripts/smoke-intent-graph.mjs
git commit -m "Share the QA API helper between the scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Push the migration and record the free-days fixture (live)

**Files:**

- Create (recorded): `apps/api/src/lib/ai/fixtures/japan-ask-free-days.ts`
- Delete: `apps/api/src/lib/ai/fixtures/japan-ask-rural.ts`
- Modify: `apps/api/src/lib/ai/fixtures/index.ts`, `docs/architecture/intent-graph.md` (line ~207, the `japan-ask-rural` sentence)

**Interfaces:**

- Produces: the exported constant `japanAskFreeDays: RunFixture`, with `name: 'japan-ask-free-days'`, `kind: 'ask'` and `match: ['i have free']`. Its one step calls `decision.propose`, and its options carry places, ideally with `days` and `leg`.

This task needs the linked dev Supabase project and live AI credentials in `apps/api/.env.local`. **Ask the user before Step 1 (`pnpm db:push`) and before Step 3 (live model calls).** If either is unavailable, stop and report.

- [ ] **Step 1: Push the migration (after asking)**

Run: `pnpm db:push`
Expected: `20261003000000_run_stopping.sql` applies with no error.

- [ ] **Step 2: Start the API live and sign in the QA user**

```bash
pnpm dev:api   # in its own terminal, with the live AI provider (no AI_PROVIDER=mock)
node scripts/qa-session.mjs > .qa/session.json
curl -s http://localhost:3000/api/health   # → {"status":"ok"}
```

- [ ] **Step 3: Make a Japan plan with a free day and ask the insight's question (after asking)**

```bash
node scripts/try-run.mjs goal "Japan in December for 9 days: Tokyo, Kyoto and Osaka"
node scripts/try-run.mjs free-day <intentId from the line above>
node scripts/try-run.mjs ask <intentId> "How should I use the 1 day I have free?"
```

Expected:

- the ask is "routed to reasoning";
- the run succeeds with an `ok` `decision.propose` entry;
- the printed plan lists a `decision`.

If the model answered without proposing, run the ask again on a fresh free-day plan.

- [ ] **Step 4: Record it and swap the fixture**

```bash
node scripts/record-fixture.mjs <runId from "run <id>:"> japan-ask-free-days "i have free"
git rm apps/api/src/lib/ai/fixtures/japan-ask-rural.ts
```

Edit `apps/api/src/lib/ai/fixtures/index.ts` to:

```ts
import { chicagoWeekend } from './chicago-weekend.ts';
import { japanAskFreeDays } from './japan-ask-free-days.ts';
import { japanDecember } from './japan-december.ts';
import type { RunFixture } from './types.ts';

/**
 * Recorded runs for `AI_PROVIDER=mock`; the first match wins. `japan-ask-free-days` answers the
 * unallocated insight's own question ("How should I use the N days I have free?"). Its proposal
 * names no existing objects, so it replays on any trip with a free day.
 */
export const FIXTURES: readonly RunFixture[] = [japanDecember, chicagoWeekend, japanAskFreeDays];
```

Open the recorded file. Check that its `decision.propose` input has at least two options with `place`, and note whether the model filled in `place.days` and `leg`, because the PR description should say. If the recording contains refused entries (`ok: false` in the run), re-record from a clean run, so mock replay isn't marked invalid.

In `docs/architecture/intent-graph.md`, replace the sentence about `japan-ask-rural` with one about `japan-ask-free-days`: it matches "i have free", answers the insight's prompt, and replays on any trip with a free day.

- [ ] **Step 5: Check it**

Run: `pnpm fix && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/ai/fixtures/ docs/architecture/intent-graph.md
git commit -m "Record the free-days ask fixture and retire japan-ask-rural

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The smoke script exercises propose, resolve and undo

**Files:**

- Modify: `scripts/smoke-intent-graph.mjs`

**Interfaces:**

- Consumes:
  - `qaApi` from Task 11;
  - the `japan-ask-free-days` fixture from Task 12;
  - `DecisionData.asked` from Task 7;
  - the candidate cleanup from Task 8;
  - the pushed migration from Task 12.

- [ ] **Step 1: Add the decision pass**

In `scripts/smoke-intent-graph.mjs`, update the header comment: "…undo, redo, read Changes, then ask the insight's own question (replaying `japan-ask-free-days`), pick an option and undo the pick." Insert this block before `const cancelled = await call('POST', `/api/runs/${asked.runId}/cancel`);`:

```js
// The insight's own question replays japan-ask-free-days: a decision whose options carry places.
const beforeAsk = await call('GET', `/api/intents/${intentId}`);
const prompt = beforeAsk.objects
  .find((o) => o.kind === 'insight')
  ?.data.actions.find((action) => action.type === 'ask')?.prompt;

assert.ok(prompt, 'the unallocated insight offers an ask');

const proposed = await call('POST', `/api/intents/${intentId}/ask`, { text: prompt });
const proposeRun = await waitForRun(proposed.runId);

assert.equal(proposeRun.status, 'succeeded', `the propose run ${proposeRun.status}`);

const withDecision = await call('GET', `/api/intents/${intentId}`);
const decision = withDecision.objects.find(
  (o) => o.kind === 'decision' && o.data.status === 'open' && o.source?.runId === proposed.runId,
);

assert.ok(decision, 'the ask proposed a decision');
assert.equal(decision.data.asked, prompt);

const options = withDecision.relationships
  .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
  .map((edge) => withDecision.objects.find((o) => o.id === edge.sourceId));
const candidates = options.map((option) => option.data.placeId).filter(Boolean);
const chosen = options.find((option) => option.data.placeId);

assert.ok(candidates.length >= 2, 'at least two options carry a place');
console.log(`proposed: "${decision.data.question}" with ${options.length} options`);

const picked = await call('POST', `/api/intents/${intentId}/capabilities`, {
  name: 'decision.resolve',
  input: { decisionId: decision.id, optionId: chosen.id },
});
const pickedTrip = picked.snapshot.objects.find((o) => o.id === tripId);
const pickedPlace = picked.snapshot.objects.find((o) => o.id === chosen.data.placeId);

assert.equal(pickedTrip.data.derived.unallocatedDays, 0, 'the free day is used');
assert.equal(pickedPlace.data.days, 1);
assert.ok(
  picked.snapshot.relationships.some(
    (edge) => edge.type === 'leg_to' && edge.targetId === pickedPlace.id,
  ),
  'a leg reaches the chosen place',
);

for (const id of candidates.filter((id) => id !== chosen.data.placeId)) {
  assert.ok(!picked.snapshot.objects.some((o) => o.id === id), 'unpicked candidates are deleted');
}

console.log(`picked: ${chosen.title}, candidates cleaned up`);

const unpicked = await call('POST', `/api/events/${picked.event.id}/undo`);

for (const id of candidates) {
  assert.ok(
    unpicked.snapshot.objects.some((o) => o.id === id),
    'undo restores every candidate',
  );
}

assert.equal(
  unpicked.snapshot.objects.find((o) => o.id === decision.id).data.status,
  'open',
  'undo reopens the decision',
);
console.log('undone: decision open again, candidates back');
```

- [ ] **Step 2: Run the smoke test in mock mode**

```bash
AI_PROVIDER=mock pnpm dev:api   # in its own terminal
node scripts/qa-session.mjs > .qa/session.json
node scripts/smoke-intent-graph.mjs
```

Expected: the existing lines, then "proposed: … with 3 options" (or however many the recording has), "picked: …, candidates cleaned up", "undone: decision open again, candidates back", and "smoke test passed".

- [ ] **Step 3: Commit**

```bash
pnpm fix
git add scripts/smoke-intent-graph.mjs
git commit -m "Smoke-test propose, pick and undo against the real database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The eval's checks

**Files:**

- Create: `scripts/lib/eval-checks.mjs`
- Create: `scripts/eval-travel-cases.mjs`
- Create: `tests/eval-checks.test.mjs`

**Interfaces:**

- Produces, in `scripts/lib/eval-checks.mjs`:
  - `regionProblem(place, testCase): string | null`;
  - `goalChecks(snapshot, run, testCase): Check[]`;
  - `askPromptOf(snapshot): string | null`;
  - `askChecks(snapshot, run, testCase): Check[]`;
  - `describePlan(snapshot): string[]`.

  A `Check` is `{ label: string, ok: boolean, detail?: string }`.

- Produces, in `scripts/eval-travel-cases.mjs`: `CASES`, where each `TestCase` is `{ name, goal, minStops, countries?, box?: [south, west, north, east], oneCountry?, maxAbsLat?, days?: [min, max], expectLengthQuestion? }`.

- [ ] **Step 1: Write the cases**

Create `scripts/eval-travel-cases.mjs`:

```js
/**
 * The travel eval's cases: spec section H's eight prompts, each with where its places should be.
 * `box` is [south, west, north, east] in degrees, loose enough for islands and border towns.
 * `days` is the length the prompt states, ±1 for how a model counts dates; `expectLengthQuestion`
 * means the prompt gives no length, so "How long is the trip?" should stay open. A case with
 * neither passes either way.
 */
export const CASES = [
  {
    name: 'japan-december',
    goal: 'Two weeks in Japan in December',
    countries: ['JP'],
    box: [24, 122, 46, 146],
    days: [13, 15],
    minStops: 2,
  },
  {
    name: 'chicago-weekend',
    goal: 'A weekend in Chicago',
    countries: ['US'],
    box: [41, -89, 43.2, -86],
    days: [2, 3],
    minStops: 1,
  },
  {
    name: 'portugal-road',
    goal: 'A 10-day road trip around Portugal',
    countries: ['PT'],
    box: [36.5, -10, 42.5, -6],
    days: [9, 11],
    minStops: 2,
  },
  {
    name: 'sea-backpacker',
    goal: 'Three weeks in Southeast Asia on a backpacker budget',
    countries: ['TH', 'VN', 'KH', 'LA', 'MY', 'SG', 'ID', 'PH', 'MM'],
    box: [-11, 92, 29, 141],
    days: [20, 22],
    minStops: 2,
  },
  {
    name: 'beach-warm',
    goal: 'A beach week somewhere warm',
    oneCountry: true,
    maxAbsLat: 35,
    days: [6, 8],
    minStops: 2,
  },
  {
    name: 'berlin-business',
    goal: 'A business trip to Berlin plus two free days',
    countries: ['DE', 'PL', 'CZ', 'AT', 'DK', 'NL'],
    box: [45, 2, 56, 20],
    minStops: 2,
  },
  {
    name: 'disney-family',
    goal: 'A family Disney trip',
    countries: ['US', 'FR', 'JP', 'CN', 'HK'],
    oneCountry: true,
    expectLengthQuestion: true,
    minStops: 1,
  },
  {
    name: 'iceland-ring',
    goal: "Driving Iceland's ring road in 10 days",
    countries: ['IS'],
    box: [63, -25, 67, -13],
    days: [9, 11],
    minStops: 2,
  },
];
```

- [ ] **Step 2: Write the failing tests**

Create `tests/eval-checks.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITIES } from '../apps/api/src/lib/capabilities/registry.ts';
import { createStager } from '../apps/api/src/lib/capabilities/stage.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  askChecks,
  askPromptOf,
  describePlan,
  goalChecks,
  regionProblem,
} from '../scripts/lib/eval-checks.mjs';
import { CASES } from '../scripts/eval-travel-cases.mjs';
import {
  idSequence,
  KYOTO_ID,
  objectRow,
  relationshipRow,
  RUN_ID,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const LEG_ID = 'e0000000-0000-4000-8000-000000000001';
const INSIGHT_ID = 'e0000000-0000-4000-8000-000000000002';
const japan = {
  name: 'japan',
  countries: ['JP'],
  box: [24, 122, 46, 146],
  days: [8, 8],
  minStops: 2,
};
const succeeded = { id: RUN_ID, status: 'succeeded', error: null, progress: [] };

// The plan-1 trip (Tokyo then Kyoto, 8 days), optionally with a train between them and extras.
function trip({ leg = false, objects = [], relationships = [] } = {}) {
  const base = snapshotRow(travelWorkspace(TRIP_ID));

  return mapSnapshotRow({
    ...base,
    objects: [
      ...base.objects,
      ...(leg
        ? [objectRow(LEG_ID, 'leg', { mode: 'train', estHours: 2.5 }, { title: 'Tokyo → Kyoto' })]
        : []),
      ...objects,
    ],
    relationships: [
      ...base.relationships,
      ...(leg
        ? [
            relationshipRow('e0000000-0000-4000-8000-000000000011', LEG_ID, TRIP_ID),
            relationshipRow('e0000000-0000-4000-8000-000000000012', LEG_ID, TOKYO_ID, 'leg_from'),
            relationshipRow('e0000000-0000-4000-8000-000000000013', LEG_ID, KYOTO_ID, 'leg_to'),
          ]
        : []),
      ...relationships,
    ],
  });
}

const failed = (checks) => checks.filter((check) => !check.ok).map((check) => check.label);

test('there are eight uniquely named cases, each with a goal and a place check', () => {
  assert.equal(CASES.length, 8);
  assert.equal(new Set(CASES.map((testCase) => testCase.name)).size, 8);

  for (const testCase of CASES) {
    assert.ok(testCase.goal.length >= 3, testCase.name);
    assert.ok(testCase.countries || testCase.maxAbsLat, testCase.name);
  }
});

test('a place outside the case’s countries, box or latitude is named', () => {
  const tokyo = trip().objects.find((object) => object.id === TOKYO_ID);

  assert.equal(regionProblem(tokyo, japan), null);
  assert.equal(regionProblem(tokyo, { countries: ['PT'] }), 'Tokyo is in JP');
  assert.match(
    regionProblem(tokyo, { box: [36.5, -10, 42.5, -6] }),
    /^Tokyo \(35\.68, 139\.69\) is outside/,
  );
  assert.equal(regionProblem(tokyo, { maxAbsLat: 30 }), 'Tokyo is at latitude 35.68');
});

test('a complete trip passes every goal check', () => {
  assert.deepEqual(failed(goalChecks(trip({ leg: true }), succeeded, japan)), []);
});

test('a missing leg, a failed run and the wrong length are each reported', () => {
  const checks = goalChecks(
    trip(),
    { ...succeeded, status: 'failed', error: 'Boom' },
    {
      ...japan,
      days: [13, 15],
    },
  );

  assert.deepEqual(failed(checks), [
    'the run succeeded',
    'a leg joins each pair of stops',
    'the trip is 13 to 15 days and fits its stops',
  ]);
  assert.match(
    checks.find((check) => check.label === 'a leg joins each pair of stops').detail,
    /Tokyo → Kyoto/,
  );
});

test('a prompt with no length expects the length question to be open', () => {
  const checks = goalChecks(trip({ leg: true }), succeeded, {
    ...japan,
    days: undefined,
    expectLengthQuestion: true,
  });

  assert.deepEqual(failed(checks), ['"How long is the trip?" is open']);
});

test('the ask prompt comes from the unallocated insight', () => {
  assert.equal(askPromptOf(trip()), null);

  const withInsight = trip({
    objects: [
      objectRow(INSIGHT_ID, 'insight', {
        text: 'You have 1 day unallocated',
        severity: 'attention',
        derivedKey: 'trip.unallocatedDays',
        actions: [
          {
            type: 'ask',
            label: 'Ask Nexui for ideas',
            prompt: 'How should I use the 1 day I have free?',
          },
        ],
      }),
    ],
    relationships: [relationshipRow('e0000000-0000-4000-8000-000000000021', INSIGHT_ID, TRIP_ID)],
  });

  assert.equal(askPromptOf(withInsight), 'How should I use the 1 day I have free?');
});

test('an ask that proposed one pinned decision with places in the region passes', () => {
  const s = createStager({
    capabilities: CAPABILITIES,
    snapshot: trip({ leg: true }),
    actor: 'ai',
    runId: RUN_ID,
    newId: idSequence(),
  });
  const place = (name, lat, lng) => ({ name, country: 'JP', placeType: 'town', lat, lng });

  s.call('decision.propose', {
    ref: 'spare',
    question: 'Where should the spare day go?',
    options: [
      { label: 'Nara', summary: 'Deer.', place: place('Nara', 34.68, 135.8) },
      { label: 'Koyasan', summary: 'Temples.', place: place('Koyasan', 34.21, 135.59) },
    ],
  });

  assert.deepEqual(failed(askChecks(s.graph(), succeeded, japan)), []);
  assert.deepEqual(failed(askChecks(s.graph(), { ...succeeded, id: 'other' }, japan)), [
    'the ask proposed one open decision',
  ]);
  assert.deepEqual(failed(askChecks(s.graph(), succeeded, { ...japan, countries: ['PT'] })), [
    'every candidate place is in the expected region',
  ]);
});

test('the plan reads as stops, legs and open questions', () => {
  assert.deepEqual(describePlan(trip({ leg: true })), [
    'stops: Tokyo 4d → Kyoto 4d',
    'legs: Tokyo → Kyoto train 2.5h',
    'open: none',
  ]);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/eval-checks.test.mjs`
Expected: FAIL with ERR_MODULE_NOT_FOUND for `scripts/lib/eval-checks.mjs`.

- [ ] **Step 4: Write the checks**

Create `scripts/lib/eval-checks.mjs`:

```js
/**
 * The travel eval's automatic checks (spec addendum 2026-10-03, section 4). Pure functions over
 * a contract-shaped snapshot and run, so `tests/eval-checks.test.mjs` can pin them. A person
 * still judges the plans; these only catch what is plainly wrong.
 */
import { LENGTH_KEY, UNALLOCATED_KEY } from '../../apps/api/src/lib/kinds/trip.ts';
import { parseKindData, tripFigures, tripParts } from '../../packages/types/src/index.ts';

const check = (label, ok, detail) => (ok ? { label, ok } : { label, ok, detail });

const tripIdOf = (snapshot) => snapshot.workspace?.doc.anchorId ?? null;

const linked = (snapshot, sourceId, type, targetId) =>
  snapshot.relationships.some(
    (edge) => edge.type === type && edge.sourceId === sourceId && edge.targetId === targetId,
  );

const runDetail = (run) => `${run.status}${run.error ? `: ${run.error}` : ''}`;

/**
 * Why a place is outside the case's region, or null when it's inside.
 *
 * @example
 * regionProblem(tokyo, { countries: ['PT'] }) // 'Tokyo is in JP'
 */
export function regionProblem(place, testCase) {
  const { name, country, lat, lng } = place.data;

  if (testCase.countries && !testCase.countries.includes(country)) {
    return `${name} is in ${country}`;
  }

  if (testCase.box) {
    const [south, west, north, east] = testCase.box;

    if (lat < south || lat > north || lng < west || lng > east) {
      return `${name} (${lat}, ${lng}) is outside the expected area`;
    }
  }

  if (testCase.maxAbsLat !== undefined && Math.abs(lat) > testCase.maxAbsLat) {
    return `${name} is at latitude ${lat}`;
  }

  return null;
}

function daysCheck(figures, lengthOpen, testCase) {
  const { totalDays, unallocatedDays } = figures;
  const detail = `total ${totalDays ?? 'unknown'}, unallocated ${unallocatedDays ?? 'unknown'}`;
  const settled = totalDays !== null && unallocatedDays !== null && unallocatedDays >= 0;

  if (testCase.days) {
    const [min, max] = testCase.days;
    const span = min === max ? `${min}` : `${min} to ${max}`;

    return check(
      `the trip is ${span} days and fits its stops`,
      settled && totalDays >= min && totalDays <= max,
      detail,
    );
  }

  if (testCase.expectLengthQuestion) {
    return check('"How long is the trip?" is open', lengthOpen, detail);
  }

  return check('the days add up, or the length question is open', settled || lengthOpen, detail);
}

/** The checks on a plan its goal run made. */
export function goalChecks(snapshot, run, testCase) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return [check('the plan is a trip', false, 'it has no workspace')];
  }

  const { places, legs, decisions } = tripParts(snapshot, tripId);
  const invalid = snapshot.objects
    .map((object) => parseKindData(object.kind, object.data, object.kindVersion))
    .filter((parsed) => !parsed.ok)
    .map((parsed) => parsed.message);
  const missingLegs = places
    .slice(1)
    .map((to, index) => [places[index], to])
    .filter(
      ([from, to]) =>
        !legs.some(
          (leg) =>
            linked(snapshot, leg.id, 'leg_from', from.id) &&
            linked(snapshot, leg.id, 'leg_to', to.id),
        ),
    )
    .map(([from, to]) => `${from.title} → ${to.title}`);
  const outside = places.map((place) => regionProblem(place, testCase)).filter(Boolean);
  const countries = [...new Set(places.map((place) => place.data.country))];
  const lengthOpen = decisions.some(
    (decision) => decision.data.derivedKey === LENGTH_KEY && decision.data.status === 'open',
  );
  const stops = testCase.minStops === 1 ? '1 stop' : `${testCase.minStops} stops`;
  const checks = [
    check('the run succeeded', run.status === 'succeeded', runDetail(run)),
    check('every object passes its kind schema', invalid.length === 0, invalid.join('; ')),
    check(`at least ${stops}`, places.length >= testCase.minStops, `${places.length} stops`),
    check(
      'a leg joins each pair of stops',
      missingLegs.length === 0,
      `missing ${missingLegs.join(', ')}`,
    ),
    check('every stop is in the expected region', outside.length === 0, outside.join('; ')),
  ];

  if (testCase.oneCountry) {
    checks.push(check('every stop is in one country', countries.length <= 1, countries.join(', ')));
  }

  checks.push(daysCheck(tripFigures(snapshot, tripId), lengthOpen, testCase));

  return checks;
}

/** The unallocated insight's own ask, or null when no days are free. */
export function askPromptOf(snapshot) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return null;
  }

  const insight = tripParts(snapshot, tripId).insights.find(
    (candidate) => candidate.data.derivedKey === UNALLOCATED_KEY,
  );

  return insight?.data.actions.find((action) => action.type === 'ask')?.prompt ?? null;
}

/** The checks on what the insight's ask (`run`) added to the plan. */
export function askChecks(snapshot, run, testCase) {
  const tripId = tripIdOf(snapshot);
  const { places, decisions } = tripParts(snapshot, tripId);
  const proposed = decisions.filter(
    (decision) =>
      decision.data.status === 'open' &&
      decision.source?.type === 'ai' &&
      decision.source.runId === run.id,
  );
  const checks = [
    check('the ask run succeeded', run.status === 'succeeded', runDetail(run)),
    check(
      'the ask proposed one open decision',
      proposed.length === 1,
      `${proposed.length} proposed`,
    ),
  ];
  const decision = proposed[0];

  if (!decision) {
    return checks;
  }

  const options = snapshot.relationships
    .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
    .map((edge) => snapshot.objects.find((object) => object.id === edge.sourceId))
    .filter(Boolean);
  const candidates = options
    .map((option) => snapshot.objects.find((object) => object.id === option.data.placeId))
    .filter(Boolean);
  const country = places[0]?.data.country;
  const outside = candidates
    .map((place) => {
      const problem = regionProblem(place, testCase);

      if (problem) {
        return problem;
      }

      return testCase.oneCountry && country && place.data.country !== country
        ? `${place.data.name} is in ${place.data.country}`
        : null;
    })
    .filter(Boolean);
  const sections = snapshot.workspace?.doc.sections ?? [];

  checks.push(
    check(
      'it has 2 to 4 options',
      options.length >= 2 && options.length <= 4,
      `${options.length} options`,
    ),
    check(
      'every candidate place is in the expected region',
      outside.length === 0,
      outside.join('; '),
    ),
    check(
      'the decision is pinned in the workspace',
      sections.some((section) => section.type === 'decision' && section.decisionId === decision.id),
      'no section for it',
    ),
  );

  return checks;
}

/** The plan in three lines: stops with days, legs, and open questions with their options. */
export function describePlan(snapshot) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return [];
  }

  const { places, legs, decisions } = tripParts(snapshot, tripId);
  const titleOf = (id) => snapshot.objects.find((object) => object.id === id)?.title ?? '?';
  const endOf = (leg, type) =>
    snapshot.relationships.find((edge) => edge.type === type && edge.sourceId === leg.id)?.targetId;
  const stops = places.map((place) => `${place.title} ${place.data.days}d`).join(' → ');
  const legLines = legs.map((leg) => {
    const hours = leg.data.estHours === undefined ? '' : ` ${leg.data.estHours}h`;

    return `${titleOf(endOf(leg, 'leg_from'))} → ${titleOf(endOf(leg, 'leg_to'))} ${leg.data.mode}${hours}`;
  });
  const open = decisions
    .filter((decision) => decision.data.status === 'open')
    .map((decision) => {
      const labels = snapshot.relationships
        .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
        .map((edge) => titleOf(edge.sourceId));

      return labels.length > 0
        ? `${decision.data.question} [${labels.join(' · ')}]`
        : decision.data.question;
    });

  return [
    `stops: ${stops || 'none'}`,
    `legs: ${legLines.join('; ') || 'none'}`,
    `open: ${open.join(' | ') || 'none'}`,
  ];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/eval-checks.test.mjs`
Expected: PASS. The plan-1 snapshot holds only the trip, Tokyo and Kyoto, so `open: none` holds.

Run: `pnpm test && pnpm format:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add scripts/lib/eval-checks.mjs scripts/eval-travel-cases.mjs tests/eval-checks.test.mjs
git commit -m "Add the travel eval's cases and automatic checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `pnpm eval:travel`

**Files:**

- Create: `scripts/eval-travel.mjs`
- Modify: `package.json` (`scripts`)

**Interfaces:**

- Consumes: `CASES` and the checks from Task 14; `readSession`, `qaApi` and `qaAdmin` from Task 11.

- [ ] **Step 1: Write the runner**

Create `scripts/eval-travel.mjs`:

```js
#!/usr/bin/env node
/**
 * The travel eval (spec addendum 2026-10-03, section 4): runs spec section H's eight trip prompts
 * against the running API as the QA user, checks each plan, and leaves the plans in the QA account
 * to judge in Expo. A manual gate, run live; it is not part of `pnpm test`.
 *
 * pnpm eval:travel                 run all eight cases
 * pnpm eval:travel --case <name>   run one case
 * pnpm eval:travel --clean         delete every plan an eval left in the QA account
 *
 * Needs the API running (live AI for a real eval; with AI_PROVIDER=mock, japan-december and
 * chicago-weekend replay their fixtures), a QA session in .qa/session.json, and SUPABASE_URL,
 * SUPABASE_SECRET_KEY and QA_SUPABASE_REF in apps/api/.env.local to tag and clean up plans.
 */
import { parseArgs } from 'node:util';

import { CASES } from './eval-travel-cases.mjs';
import { askChecks, askPromptOf, describePlan, goalChecks } from './lib/eval-checks.mjs';
import { qaAdmin, qaApi, readSession } from './lib/qa-api.mjs';

const { values } = parseArgs({
  options: { case: { type: 'string' }, clean: { type: 'boolean', default: false } },
});
const session = readSession();
const userId = session.user.id;
const { call, waitForRun } = qaApi(session);
const admin = await qaAdmin();

const tokens = (run) =>
  `${run.modelUsage.inputTokens ?? 0} in / ${run.modelUsage.outputTokens ?? 0} out`;
const refusedCount = (run) => run.progress.filter((entry) => !entry.ok).length;

async function clean() {
  const { data, error } = await admin
    .from('intents')
    .delete()
    .eq('user_id', userId)
    .not('context->eval', 'is', null)
    .select('id');

  if (error) {
    throw new Error(`Could not delete the eval plans (${error.code}).`);
  }

  console.log(`Deleted ${data.length} eval plan${data.length === 1 ? '' : 's'}.`);
}

// Tagged at once, so a crash mid-run still leaves the plan for --clean.
async function tag(intentId, name) {
  const { error } = await admin
    .from('intents')
    .update({ context: { eval: { suite: 'travel', case: name, at: new Date().toISOString() } } })
    .eq('id', intentId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Could not tag ${intentId} (${error.code}).`);
  }
}

async function runCase(testCase) {
  const started = await call('POST', '/api/intents', { goal: testCase.goal });
  const intentId = started.snapshot.intent.id;

  await tag(intentId, testCase.name);

  if (!started.runId) {
    return {
      intentId,
      checks: [{ label: 'Jev saw a trip', ok: false, detail: 'no run started' }],
      notes: [],
      plan: [],
    };
  }

  const goalRun = await waitForRun(started.runId);
  let snapshot = await call('GET', `/api/intents/${intentId}`);
  const checks = goalChecks(snapshot, goalRun, testCase);
  const notes = [
    `goal run ${goalRun.status}, ${refusedCount(goalRun)} refused calls, ${tokens(goalRun)}`,
  ];
  const prompt = askPromptOf(snapshot);

  if (prompt) {
    const asked = await call('POST', `/api/intents/${intentId}/ask`, { text: prompt });
    const askRun = await waitForRun(asked.runId);

    snapshot = await call('GET', `/api/intents/${intentId}`);
    checks.push(...askChecks(snapshot, askRun, testCase));
    notes.push(
      `ask "${prompt}" → ${asked.route}, run ${askRun.status}, ${refusedCount(askRun)} refused calls, ${tokens(askRun)}`,
    );
  } else {
    notes.push('ask skipped: no free days');
  }

  return { intentId, checks, notes, plan: describePlan(snapshot) };
}

function printCase(testCase, result) {
  console.log(`\n━━ ${testCase.name}  ${result.intentId ?? ''}`);
  console.log(`   "${testCase.goal}"`);

  for (const item of result.checks) {
    console.log(`   ${item.ok ? '✓' : '✗'} ${item.label}${item.ok ? '' : `: ${item.detail}`}`);
  }

  for (const line of [...result.notes, ...result.plan]) {
    console.log(`   ${line}`);
  }
}

if (values.clean) {
  await clean();
} else {
  const selected = values.case ? CASES.filter((testCase) => testCase.name === values.case) : CASES;

  if (selected.length === 0) {
    console.error(`No case "${values.case}". Cases: ${CASES.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  let passed = 0;

  for (const testCase of selected) {
    let result;

    try {
      result = await runCase(testCase);
    } catch (error) {
      result = {
        intentId: null,
        checks: [{ label: 'the case ran', ok: false, detail: error.message }],
        notes: [],
        plan: [],
      };
    }

    printCase(testCase, result);

    if (result.checks.every((item) => item.ok)) {
      passed += 1;
    }
  }

  console.log(
    `\n${passed}/${selected.length} passed automatic checks — open them in Expo (QA account).`,
  );
  process.exitCode = passed === selected.length ? 0 : 1;
}
```

- [ ] **Step 2: Add the root script**

In `package.json`, add after `"test"`:

```json
    "eval:travel": "node --experimental-strip-types scripts/eval-travel.mjs",
```

- [ ] **Step 3: Run it in mock mode against the two fixtures**

With `AI_PROVIDER=mock pnpm dev:api` running and a fresh `.qa/session.json`:

Run: `pnpm eval:travel --case japan-december`
Expected: one case block with an intent id, ✓ or ✗ lines, the goal-run note, and the stops, legs and open lines. The last line is `N/1 passed automatic checks — open them in Expo (QA account).` Failing checks are fine here, since the mock fixture isn't a two-week trip; the point is that the script runs end to end.

Run: `pnpm eval:travel --case nowhere`
Expected: `No case "nowhere". Cases: japan-december, …`, with exit 1.

Run: `pnpm eval:travel --clean`
Expected: `Deleted 1 eval plan.` A second `--clean` prints `Deleted 0 eval plans.`

- [ ] **Step 4: Commit**

```bash
pnpm fix
git add scripts/eval-travel.mjs package.json
git commit -m "Add pnpm eval:travel, the manual live gate for slice 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Reviews, docs, smoke tests and handoff

**Files:**

- Modify (by the docs keeper): `AGENTS.md`, `docs/architecture/intent-graph.md`, `docs/architecture/mobile.md`, and whatever else it finds

- [ ] **Step 1: Run the full checks**

Run: `pnpm fix && git diff --stat && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build`
Expected: all PASS. The diff stat shows only this plan's files.

- [ ] **Step 2: Run the reviewers and fix what they confirm**

Dispatch the `api-reviewer` (apps/api and packages/types), the `mobile-reviewer` (apps/mobile) and the `security-reviewer` (the migration's SQL functions, the eval's secret-key client and its `.env.local` use, and run input stored as `asked`). For each confirmed finding, fix it, re-run the tests and commit (`Fix <thing> from review`).

- [ ] **Step 3: Update the docs**

Dispatch the `docs-keeper` with this summary:

- the `stopping` run status and how Stop now works;
- refused calls in progress;
- a forced step that fails then answers in text is `invalid`;
- `discard_intent`;
- `decision.propose` hints (`suggestedDays`, `leg`) and `asked`;
- resolve's days fallback, leg hint and candidate cleanup;
- the sheet's "See the choice" and "Back to plan" and the Open band reveal;
- the sheet subscribes only for plans it starts;
- the `japan-ask-free-days` fixture;
- `pnpm eval:travel` (add it to AGENTS.md's command list), `scripts/lib/qa-api.mjs`, and the smoke script's new pass.

Commit its edits (`Document the ask flow, stopping runs and the travel eval`).

- [ ] **Step 4: Smoke-test in Expo web, mock and then live**

With the API running (`AI_PROVIDER=mock` first), `pnpm dev:web`, and a QA session put in Expo web per `AGENTS.md` and `docs/architecture/authentication.md`:

1. Open a trip with one free day: make it with `try-run.mjs goal …` plus `free-day`, or in the app.
2. Tap the insight's "Ask Nexui for ideas". The + sheet opens with "How should I use the 1 day I have free?" prefilled. Send it.
3. Watch the RunCard update, then reach Done. Check that "See the choice" is the primary button and "See changes" is a link.
4. Tap "See the choice". The sheet closes and the workspace scrolls so the Open band and its decision are in view.
5. Check that the decision card shows _You asked "How should I use the 1 day I have free?"_, the question, the tradeoff and the comparison.
6. Choose an option. The route gains the place with its days and a leg, the day bar and map update, and the unallocated insight disappears.
7. Tap Undo. The decision is back with all its options, and the route and day bar return to where they were.
8. Ask "Make the first stop one day longer" from the plan's +. When it succeeds, the sheet offers "Back to plan", which closes the sheet.
9. Start an ask, tap Stop mid-run, and see "Stopping…" with no Stop button, then "Stopped". Send another ask right away: it's refused, or it starts once the stopped run finishes, with no overlap in Changes.
10. Repeat steps 1–7 with the live provider (ask the user first, because it costs money).
11. Check steps 3–6 in light and in dark.

Save screenshots in `.qa/`. Finish with `node scripts/qa-session.mjs --revoke .qa/session.json`.

- [ ] **Step 5: Hand the live eval to the user**

The user runs the eval themselves (spec decision). Tell them:

```bash
pnpm dev:api                      # live provider
node scripts/qa-session.mjs > .qa/session.json
pnpm eval:travel                  # eight cases; judge the plans in Expo as the QA user
pnpm eval:travel --clean          # when done
```

- [ ] **Step 6: Push and open a draft PR (after asking)**

Push the branch and open a draft PR. Its description should cover:

- the change, by spec section;
- the validation results: tests, lint, typecheck, build, the smoke script, and the Expo smoke test with screenshots;
- whether the recorded fixture uses `place.days` and `leg`;
- the flagged plan decisions above;
- that the live eval and the preview-build device checks are still the user's to run.

End the description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
