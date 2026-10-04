# Intent graph

Nexui turns what someone is trying to accomplish into a persistent object graph, and renders
that graph as a workspace. The full design, including the parts not built yet (capabilities,
AI orchestration, Realtime), is in
[`docs/superpowers/specs/2026-09-27-intent-graph-design.md`](../superpowers/specs/2026-09-27-intent-graph-design.md).
This doc covers what exists today: the database, the graph API, kinds, and theming.

## What an intent is

An **intent** is a goal (`"a weekend in Chicago"`) plus everything built to pursue it: a graph
of typed **objects** (a trip, its places, legs, decisions…), **relationships** between them, and
a **workspace doc** that lays the graph out as sections. Every write to any of that is a
**changeset**, logged as an **event** so it can be undone. See spec sections B–D for the full
model; this doc cites the code that implements it.

## Tables and writers

Six tables, defined in `supabase/migrations/20260927000000_intent_graph.sql` (the run functions are
in `20260929000000_runs.sql`, redefined by `20260930000000_run_cutoff.sql` and
`20261003000000_run_stopping.sql`): `intents`, `objects`, `relationships`, `events` (append-only),
`workspaces`, and `runs` (one per AI request; see "AI runs"). Every table is owner-scoped by RLS.
Clients get no direct `insert`/`update`/`delete` — the migration `revoke`s those and only `grant`s
`select` to `authenticated`. All writes go through `security definer` functions:

- `create_intent(id, goal, template, ops)`: inserts the intent, then applies its seed changeset
  as actor `system`.
- `apply_changeset(intent_id, actor, run_id, ops, expected_activity_at default null)`: locks the
  intent, checks ownership, refuses with `NXU08` when `expected_activity_at` is given and no
  longer matches the intent's `last_activity_at` (every changeset and Undo bumps it), refuses a
  `run_id` that isn't one of the caller's `runs` (`NXU22`), then calls the shared
  `private.apply_ops` to apply the ops and log one `events` row.
- `revert_event(event_id)`: Undo. Writes each op's `before` back, newest first, as a new
  changeset with `reverts_event_id` set. **Redo is `revert_event` on the Undo event itself** —
  one route serves both.
- `get_intent_snapshot(id)` / `changes_page(limit, before_seq, intent_id)`: read helpers used by
  the API's list/query code.
- `discard_intent(id)` (`20261003000000_run_stopping.sql`): deletes one of the caller's intents
  that no run was ever created on, with its graph (the rows cascade). Anything else, including
  another user's intent or one with a run, is `NXU04`. `startIntent` uses it so a trip whose
  first run can't be created doesn't stay on Home with nothing to fill it in (see "AI runs").
- `delete_intent(id)` (`20261004000000_delete_intent.sql`): deletes one of the caller's intents
  with everything under it (objects, relationships, events, workspace and runs cascade). It
  refuses with `NXU12` while a run on the intent is queued, running or stopping and younger than
  6 minutes, the same rule as `create_run`, and with `NXU04` when the intent is missing or not
  the caller's. `DELETE /api/intents/[id]` (`deleteIntent` in `apps/api/src/lib/graph/commit.ts`)
  calls it and answers 204. A bad id or `NXU04` is a 404, `NXU12` a 409 "Nexui is still working
  on this plan.", and anything else a logged, safe 500 "Could not delete that plan. Try again.".

`private.apply_ops` is the one place rows actually change. It rejects an op whose `origin` isn't
`direct` or `derived`, a `source.type` outside `user`/`ai`/`derived`/`external`, more than one op
touching the same row, and a relationship endpoint that isn't one of the caller's own live
objects or intents (`private.check_endpoint`). A clash with an existing row (a reused id, a
second live copy of a link) becomes `NXU11`, and a missing or out-of-range column `NXU22`, so no
constraint detail reaches the client. The `private` functions aren't executable by `public`,
`anon` or `authenticated`; only the definer functions call them. `revert_event` additionally refuses to undo the
create-intent (`system`) event, compares `updated_at` as `timestamptz` to detect a row that
changed underneath it, and raises if undoing would leave a live relationship pointing at an
object it just removed, or would revive a relationship whose endpoint is gone (also on a
duplicate live relationship). Read the migration for the exact checks.

The functions are still callable with the caller's own token, so a client that skips the API can
write unvalidated `data` or mislabel the actor of its own changes — accepted for slice 1 (spec
section C), because AI runs write with the user's token too.

**Error codes and HTTP mapping** (`apps/api/src/lib/graph/errors.ts#mapRpcError`, used by
`apps/api/src/lib/graph/respond.ts#graphErrorResponse`):

| Code          | Meaning                                                                   | HTTP                                        |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| `NXU04`       | Not found, or not the caller's                                            | 404                                         |
| `NXU08`       | `expectedUpdatedAt` or the intent's expected activity time didn't match   | 409 (after one re-derived retry)            |
| `NXU09`       | A row changed since, or Undo/Redo would leave a link dangling             | 409                                         |
| `NXU10`       | Already undone (including two Undos racing on the unique index)           | 409                                         |
| `NXU11`       | Already exists: a reused id or a second live copy of a link               | 409 "That already exists."                  |
| `NXU22`       | Malformed changeset (bad op/origin/source/run, missing or invalid column) | 400                                         |
| anything else | Unknown                                                                   | 500, logged as `[tag] <fallback> (<code>).` |

## Kinds

`packages/types/src/kinds/registry.ts` exports `KIND_REGISTRY`: for each kind, a Zod schema, a
`version`, and an `upgrade(data, fromVersion)` function. `parseKindData(kind, data, version?)`
upgrades old data first, then validates it, and is what `apps/api/src/lib/graph/prepare.ts` calls
before any object write reaches the database. Slice 1 registers `trip`, `place`, `leg`, `stay`,
`decision`, `option`, `insight`, and the fallback `thing` (schemas in
`packages/types/src/kinds/travel.ts`).

To add a kind: add its Zod schema and a registry entry with `version: 1` and `upgrade: (data) =>
data`. No migration — `data` is JSONB and the schema is the only place shape is enforced. To
change an existing kind's shape, bump `version` and write a real `upgrade` that maps old data to
the new shape; `parseKindData` runs it automatically whenever a stored object's `kind_version` is
behind the registry's.

## A changeset's path

A user edit reaches the database as:

```
route.ts → fromUserOps → prepareChangeset → apply_changeset (RPC) → { event, snapshot }
```

- **`fromUserOps`** (`packages/types/src/ops.ts`) turns a client's minimal `UserOp` (an
  `insert_object` without `source` or `kindVersion`, say) into a full `ChangesetOp` — filling in
  `source: { type: 'user' }`, the kind's current `kindVersion`, and `origin: 'direct'`.
- **`prepareChangeset`** (`apps/api/src/lib/graph/prepare.ts`) is pure, so tests can assert
  exactly what would reach the database:
  1. `markReviewed` clears the AI highlighter on any object a user edit just touched (spec
     section D): if the object's `source.type === 'ai'` and it has no `reviewedAt`, the patch
     gains `source.reviewedAt = now`.
  2. `validateOps` walks the ops against the snapshot as it would be after each previous one,
     validating `insert_object`/`update_object` data against the kind registry and relationship
     endpoints against the snapshot, via `applyOps` (`packages/types/src/apply-ops.ts`). It
     refuses a second live copy of an existing link ("That link already exists."), and when the
     ops include `set_workspace` or `delete_object` it checks the workspace doc still names only
     live objects, so deleting the trip (the anchor) or a decision the doc shows is a 400.
  3. The validated ops are staged in memory (`applyOps`), and `deriveForTemplate`
     (`apps/api/src/lib/templates/derive.ts`) runs the intent's template derivation — `derive.trip`
     for `template: 'travel'` — over the staged result, producing more ops with `origin:
'derived'`.
  4. `coalesceOps` merges the direct and derived ops down to one op per row (a row can only
     appear once in `apply_changeset`'s input), then the whole set is validated again.
- **`commitChangeset`** (`apps/api/src/lib/graph/commit.ts`) loads the current snapshot, runs
  `prepareChangeset`, and calls the `apply_changeset` RPC with the snapshot's `lastActivityAt`.
  If another change landed in between (`NXU08`), the derived values would be stale, so it
  reloads, re-prepares and retries once; a second `NXU08` is the 409. The route
  (`apps/api/src/app/api/intents/[id]/changesets/route.ts`) returns its `{ event, snapshot }`
  unchanged.
- **Size caps**: `POST /api/intents` and `POST /api/intents/:id/changesets` read the body with
  `readJsonBody` (`apps/api/src/lib/http/json-body.ts`) and refuse more than 65 536 characters
  with 413 "That change is too large.". In the contracts, link `metadata` and a capability
  action's `input` serialize to at most 2 000 characters, and an option has at most 12 `metrics`.

**Example** (`tests/derive-trip.test.mjs`): shortening Tokyo from 4 days to 3 stages an
`update_object` on Tokyo, then `derive.trip` sees the trip now has 1 unallocated day and adds:
an `update_object` on the trip storing the recalculated `data.derived` figures, an
`insert_object`/`insert_relationship` pair for a new "You have 1 day unallocated" insight (with
an `ask` action and a `capability` action offering to give the day back to Tokyo), and an
`update_intent` refreshing `summary` (`line: 'Dec 12 – 20, 8 days, 2 stops'`, an attention badge,
and the stop strip). All of it commits as one changeset, so undoing the user's edit undoes the
derived state with it.

## Undo and Redo

`POST /api/events/:id/undo` calls `revertEvent` → the `revert_event` RPC for both directions.
Conflict rules, enforced in Postgres because the client's view can be stale:

- **Changed since**: if any row the original event touched no longer matches its recorded
  `after` value, the whole Undo is refused (`NXU09`) rather than partially applied.
- **Already undone**: a unique index on `reverts_event_id` means only one Undo can exist per
  event; a second attempt gets `NXU10`, and so does the loser of two Undos racing (its insert
  hits the index and is re-raised as `NXU10`).
- **Can't undo the create**: the `system`-actor event that creates the intent is refused
  (`NXU22`) — there's nothing to undo back to.
- **Derived ops ride along**: they were part of the original changeset's `ops`, so reverting the
  edit reverts them too; they can't be undone independently.

Redo is not a separate function — it's `revert_event` called on the Undo event's own id, which
restores the `after` values that Undo just replaced. `apps/api/src/lib/graph/commit.ts#revertEvent`
is the one function both directions call.

## Workspace docs

A `WorkspaceDoc` (`packages/types/src/workspace.ts`) has an `anchorId` (the template's primary
object — the trip, for travel) and an ordered list of `sections`. A section doesn't hold object
ids directly; it holds a `GraphQuery` (`from`, optional `kind`/`related`/`where`/`sort`/`limit`),
so the same section keeps showing the right objects as the graph changes. `evaluateQuery`
(`packages/types/src/query.ts`) runs that query against a `GraphSnapshot` — filtering by kind,
by a relationship (`related: { type, to, direction }`), by field filters, then sorting and
limiting. It has no side effects and no server/client split: the API uses it when deriving, and
the mobile renderer uses the same function to read a section's rows (see
[`docs/architecture/mobile.md`](./mobile.md)).

A section can carry `pin: 'open'`, which lifts it into the workspace's "Open band" while it has
something unresolved — a `decision` with `status: 'open'`, or an `insight` whose query still
returns rows. `apps/api/src/lib/templates/travel.ts#travelWorkspace` builds the travel template's
starting doc (`map`, `metric`, `allocation`, a pinned `insight`, then `route`), and
`deriveTrip`'s `lengthDecisionOps` adds and removes a pinned `decision` section as the trip's
length becomes known or unknown.

## AI runs

`POST /api/intents` and `POST /api/intents/[id]/ask` perceive, then start a run
(`src/lib/orchestrator/orchestrate.ts`). The route answers at once; `after()` executes the run
with the user's token, so RLS applies to everything it writes.

- **Perception** (`src/lib/perception`): Jev (`NEXUI_MODEL_PERCEPTION`, `typesafe-ai/jev`)
  answers one choice question within 5 seconds. A goal is `travel` or `none`; an ask is `edit`,
  `fast` or `reasoning`. If Jev fails, the goal is a trip and the ask gets `reasoning`. A
  `none` goal gets an intent with no template, no workspace and no run.
- **Starting a trip** (`startIntent`): if `create_run` fails after the intent was seeded, the
  intent is deleted with `discard_intent` before the error is rethrown. A failed discard is
  logged under `[intents]` with only its error code, and the original error is still the one
  rethrown.
- **Runs** (`src/lib/runs`, `20260929000000_runs.sql`, `20260930000000_run_cutoff.sql`,
  `20261003000000_run_stopping.sql`): a run is `queued`, `running`, `stopping`,
  `awaiting_approval` (unused in slice 1), `succeeded`, `failed` or `cancelled`.
  `ACTIVE_RUN_STATUSES` / `isActiveRunStatus` (`packages/types/src/runs.ts`) are the first three.
  - `create_run` refuses while another run on the intent is queued, running or stopping (NXU12,
    409), so a stopped run's last commit can never land under a newer run.
  - `record_run_step` appends each step's calls to `runs.progress`
    (`{ step, capability, label, ok, ms, input, error? }`): a step whose entries would take
    `progress` past 100 is not recorded, so it holds at most 100 entries. It also appends the
    step's tokens to `runs.model_usage`, and returns the status. A stopping run keeps that last
    step's entries and usage and stays `stopping`; the executor treats any status but `running`
    as a stop.
  - **Stop** (`cancel_run`) lets a running run finish the step it is taking: the run moves to
    `stopping`, the executor commits and records that step, then finishes the run `cancelled`.
    A queued or awaiting-approval run is cancelled at once. A run that already finished, or is
    already stopping, comes back unchanged.
  - `finish_run` turns a stopping run into `cancelled`, or `failed` with the error if its last
    step failed, and never changes a finished run.
  - A run still queued, running or stopping 6 minutes after it was created (a function instance
    stops after 300 s) reads as failed ("This run stopped unexpectedly."), and stops blocking
    `create_run`.
  - Home shows "Drafting" on intents with a working run.
- **Cognition** (`src/lib/cognition`): `generateText` with the capabilities as tools (`.` becomes
  `_` in tool names). `edit` and `fast` use `NEXUI_MODEL_FAST` for one forced tool step plus one
  correction; `reasoning` and the create run use `NEXUI_MODEL_REASONING` for up to 8 steps.
  Each step's ops commit as one changeset with actor `ai` and the run id, so a step can be
  undone from Changes. Two failing steps in a row fail the run; committed steps stay.
  - **Refused calls show in progress.** A call whose input breaks the tool's schema never reaches
    the stager: the AI SDK refuses it as a `tool-error`. `runModel` collects those into
    `StepReport.refused`, and `commitStep` records each with `recordRefused` as an `ok: false`
    entry whose `error` is the schema's first issue (`days: Too small …`), after the step's own
    calls. The model still gets the error and can correct itself.
  - **A forced step that fails, then answers in text, is `invalid`.** For `edit` and `fast`, a
    text answer after a step with errors means the model gave up on the change, so the run fails
    with "Nexui couldn't make a valid change.". A first forced step that answers in text still
    finishes: the model found nothing to change.
- **Capabilities** (`src/lib/capabilities`): named, Zod-typed functions that turn input into ops
  against a staged copy of the intent; the stager validates each call's ops before keeping
  them. Models name objects by ref (`trip`, `o1` … oldest first, or the ref they gave a new
  object), never by id. `trip.setPlaceDays`, `trip.reorderPlaces` and `decision.resolve` are
  also the app's buttons, through `POST /api/intents/[id]/capabilities` (actor `user`). The data
  help the model reads (`DATA_HELP` in `graph.ts`) states the schema's limits, such as place
  `days` "whole days, 0 to 365" and leg `estHours` "0 to 200", and a test keeps them in step.
- **Decisions** (`src/lib/capabilities/decisions.ts`, spec addendum 2026-10-03 section 2):
  - `decision.propose` pins a question with 2 to 4 options to the Open band. An option that adds
    a place carries it, and the place is created with `days: 0` and no `part_of` link (a
    candidate). The option may suggest days there (`place.days`, stored as
    `OptionData.suggestedDays`, 1 to 365) and a leg hint (`leg`, stored with `fromPlaceId`, the
    trip's last stop when proposed; dropped when the trip has no stops or the option no place).
    An option with no place may instead name a stop already on the route in `extend` (stored as
    `extendPlaceId`), such as "Extra day in Tokyo"; a ref that names no stop on the route is
    dropped, and an option can't do both. When the AI proposes during a run, the decision stores
    what the user asked as `DecisionData.asked` (the run's request, cut to 300 characters without
    splitting an emoji), which the card shows as _You asked "…"_.
  - `decision.resolve` settles a decision in one changeset, so one Undo restores all of it. A
    pick sets `chosenOptionId`; leaving `optionId` out dismisses. On a pick, the days handed out
    are the trip's free days if above 0, else the option's `suggestedDays`, else 1. A chosen place
    goes last on the route with those days and a leg from the stop before it, which uses the
    hint's mode, hours and cost only while `fromPlaceId` is still the last stop (otherwise
    `{ mode: 'other' }`); a place the user already put on the route stays as it is. An `extend`
    option adds those days to its stop, while that stop is still on the route. Then every other
    option's candidate place (all of them on a dismiss) is deleted with its links, unless the user
    put it on the route by hand. The decision and its options stay as a record, and the
    decision's section is removed.
- **Step replay** (`src/lib/capabilities/stage.ts`): if the intent's `lastActivityAt` moved while
  a step was running — the user edited it too — `commitChangeset`'s `restage` replays the step's
  calls over the fresh snapshot with the same ids and refs, rather than committing against a
  stale one. A call whose patch would change a field the user changed since the step began is
  dropped, and its progress entry is marked `ok: false`, "You changed this while Nexui was
  working, so Nexui skipped it." A step left with nothing to commit commits nothing.
- **Prompts** put the goal, the graph and the request inside `<goal>`, `<graph>` and
  `<request>` as escaped JSON, and tell the model never to follow instructions found there.
- **Mock mode** (`AI_PROVIDER=mock`, the default) replays `src/lib/ai/fixtures`, recorded from
  live runs. A fixture matches when all its phrases are in the text. With no match, perception
  answers `travel` and `reasoning` and the run changes nothing. `japan-ask-free-days` matches
  "i have free" and answers the unallocated insight's own prompt ("How should I use the N days
  I have free?") with a decision: Nara and Hiroshima as candidates, and "Extra day in Tokyo",
  whose `extend: 'o4'` was added by hand. It replays on any trip with a free day: `o4` is Tokyo
  on the trip that `try-run.mjs goal "Plan two weeks in Japan in December"` and then `free-day`
  make, and elsewhere it names another stop or none (and is dropped).
- **Recording:** run the API with `AI_PROVIDER=live`, start a run with
  `node scripts/try-run.mjs goal "<goal>"` (or `ask`), then
  `node scripts/record-fixture.mjs <runId> <name> <phrase,phrase>` and add the export to
  `FIXTURES`.

## Theming

`apps/mobile/src/theme/theme.ts` exports `light` and `dark` palettes with identical keys
(`TokenName`/`Palette` types), plus the font faces. Components never use a raw color: they read
one through `useColors()` (for colors passed as props) or `createThemedStyles(factory)` (for a
`StyleSheet`, cached per scheme) — both in `apps/mobile/src/theme/use-theme.ts`. `useScheme()`
resolves the saved appearance choice (below) against the phone's `useColorScheme()`, treating
anything but `'dark'` as light; the status bar follows it too. `tests/theme-tokens.test.mjs`
is the guard: it asserts both palettes declare the same keys, scans `apps/mobile/src` for hex/
`rgb(`/`rgba(` literals outside `theme.ts`, and checks AA contrast (≥ 4.5:1) for the token pairs
text is actually drawn with.

The Account screen's Appearance card picks Light or Dark with a day-and-night sky switch (the
`sky*` tokens), or "Match my phone" (the default) to follow the phone. The choice is saved on the
device only, not the account: SecureStore on iOS/Android (`device-appearance.ts`), localStorage
key `nexui.appearance` in the web preview (`device-appearance.web.ts`). `use-appearance-store.ts`
holds it and `appearance.ts` has the pure resolution logic. On native, the store also calls
`Appearance.setColorScheme` at launch and on every change, so keyboards, sheets and alerts match.
In the web preview a live browser color-scheme change only applies after a reload.

## Checking it

- `supabase/tests/intent-graph-smoke.sql`: paste into the Supabase SQL editor (or run with
  `psql`) against a scratch database. Creates two throwaway users, exercises create, change,
  undo, redo and cross-user isolation through the RPCs, and rolls everything back in one
  transaction — nothing it does persists.
- `supabase/tests/runs-smoke.sql`: the run functions, `discard_intent` and `delete_intent`, as two
  throwaway users, rolled back: Stop on a running run (stopping, its last step kept, `NXU12`
  meanwhile, then cancelled, or failed with its error), a queued run cancelled at once,
  `discard_intent` refusing an intent with a run or another user's, and `delete_intent` refusing a
  plan with an active run (`NXU12`) or another user's (`NXU04`), then removing a plan with its
  graph, runs and events. With the project linked, it also runs as
  `pnpm exec supabase db query --linked -f supabase/tests/runs-smoke.sql`.
- `scripts/smoke-intent-graph.mjs [.qa/session.json] [apiUrl]`: a live end-to-end check against
  a running API. Needs a QA session (`node scripts/qa-session.mjs > .qa/session.json`) and the
  API running (`pnpm dev:api`). It needs AI_PROVIDER=mock and waits for each run. After an ask
  and its run, it asks the unallocated insight's own question (replaying
  `japan-ask-free-days`), picks a place (the free day is used, a leg reaches it, the other
  candidates are deleted), undoes the pick (every candidate is back and the decision open), and
  ends with a cancel of a finished run.
- `pnpm eval:travel` (`scripts/eval-travel.mjs`, cases in `scripts/eval-travel-cases.mjs`, pure
  checks in `scripts/lib/eval-checks.mjs`): the manual live gate for spec section H's eight trip
  prompts. Each case creates a plan, tags it in `intents.context.eval`, checks it (valid kind
  data, stops and legs, each place in the case's countries and box, the trip's length), asks the
  unallocated insight's question if days are free, and checks the proposal. It prints ✓/✗ per
  check and exits 1 on any ✗; a person judges the plans in Expo as the QA user.
  `--case <name>` runs one case and `--clean` deletes every tagged plan. Needs the API (live for
  a real eval), `.qa/session.json`, and `SUPABASE_SECRET_KEY` with `QA_SUPABASE_REF` in
  `apps/api/.env.local`.
- `scripts/lib/qa-api.mjs` is what the scripts share: `readSession`, `qaApi` (`call`,
  `waitForRun`), `qaAdmin` (the secret-key client, refused for any project but
  `QA_SUPABASE_REF`), `printRun` and `printPlan`. `NEXUI_SESSION` and `NEXUI_API` override
  `.qa/session.json` and `http://localhost:3000`.
