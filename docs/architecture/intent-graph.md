# Intent graph

Nexui turns what someone is trying to accomplish into a persistent object graph, and renders
that graph as a workspace. The full design, including the parts not built yet (capabilities,
AI orchestration, Realtime), is in
[`docs/superpowers/specs/2026-09-27-intent-graph-design.md`](../superpowers/specs/2026-09-27-intent-graph-design.md).
This doc covers what exists today: the database, the graph API, kinds, templates, and theming.

## What an intent is

An **intent** is a goal (`"a weekend in Chicago"`) plus everything built to pursue it: a graph
of typed **objects** (a trip, its places, legs, decisions…), **relationships** between them, and
a **workspace doc** that lays the graph out as sections. Every write to any of that is a
**changeset**, logged as an **event** so it can be undone. See spec sections B–D for the full
model; this doc cites the code that implements it.

## Tables and writers

Six tables (the shared `place_media` cache of Wikipedia and Commons lookups, and its `place-photos` bucket, are outside the graph; see
[`place-media.md`](./place-media.md)), defined in `supabase/migrations/20260927000000_intent_graph.sql` (the run functions are
in `20260929000000_runs.sql`, redefined by `20260930000000_run_cutoff.sql`,
`20261003000000_run_stopping.sql` and `20261004130000_run_queue.sql`): `intents`, `objects`, `relationships`, `events` (append-only),
`workspaces`, and `runs` (one per AI request; see "AI runs"). Every table is owner-scoped by RLS.
Clients get no direct `insert`/`update`/`delete` — the migration `revoke`s those and only `grant`s
`select` to `authenticated`. All writes go through `security definer` functions:

- `create_intent(id, goal, template, ops)`: inserts the intent, then applies its seed changeset
  as actor `system`.
- `apply_changeset(intent_id, actor, run_id, ops, expected_activity_at, payload)`: locks the
  intent, checks ownership, refuses with `NXU08` when `expected_activity_at` is given and no
  longer matches the intent's `last_activity_at` (every changeset and Undo bumps it), refuses a
  `run_id` that isn't one of the caller's `runs` (`NXU22`), then calls the shared
  `private.apply_ops` to apply the ops and log one `events` row, and `private.set_event_payload`
  to store the payload on it. The last two arguments default to null and `{}`;
  `20261005000000_changeset_payload.sql` adds the payload to this function and to
  `run_apply_changeset` (see "A changeset's path").
- `revert_event(event_id)`: Undo. Writes each op's `before` back, newest first, as a new
  changeset with `reverts_event_id` set. **Redo is `revert_event` on the Undo event itself** —
  one route serves both.
- `get_intent_snapshot(id)` / `changes_page(limit, before_seq, intent_id)`: read helpers used by
  the API's list/query code.
- `GET /api/intents` also fills each card's `photos` (`intentListItemSchema`, at most three 500px
  bucket URLs) with `withHomePhotos`, which reads the `place_media` cache with the secret-key client;
  see [`place-media.md`](./place-media.md).
- `discard_intent(id)` (`20261003000000_run_stopping.sql`): deletes one of the caller's intents
  that no run was ever created on, with its graph (the rows cascade). Anything else, including
  another user's intent or one with a run, is `NXU04`. `startIntent` uses it so a trip whose
  first run can't be created doesn't stay on Home with nothing to fill it in (see "AI runs").
- `delete_intent(id)` (`20261004000000_delete_intent.sql`): deletes one of the caller's intents
  with everything under it (objects, relationships, events, workspace and runs cascade). It
  refuses with `NXU12` while a run on the intent is queued, running or stopping and younger than
  15 minutes, the same rule as `create_run`, and with `NXU04` when the intent is missing or not
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
write unvalidated `data` or `payload`, or mislabel the actor of its own changes — accepted for
slice 1 (spec section C). AI runs don't use the caller's token: the worker functions below are executable by
`service_role` only, and each takes the user and intent from the run row.

**Live updates.** `20261004120000_intent_broadcast.sql` adds triggers that send a Realtime
Broadcast message on the private topic `intent:<id>` (`realtime.send`, event `changed`, payload
`{ table }`): one per `events` insert, so one per changeset or Undo however many rows it touched,
and one per `runs` insert or update. A select policy on `realtime.messages` lets only the intent's
owner join the topic, and no insert policy lets a client send on it. The five graph tables are not
in the `supabase_realtime` publication. A failed send is a warning and never rolls back a write.
The mobile side is in [`mobile.md`](./mobile.md).

**Error codes and HTTP mapping** (`apps/api/src/lib/graph/errors.ts#mapRpcError`, used by
`apps/api/src/lib/graph/respond.ts#graphErrorResponse`):

| Code          | Meaning                                                                           | HTTP                                        |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `NXU04`       | Not found, or not the caller's                                                    | 404                                         |
| `NXU08`       | `expectedUpdatedAt` or the intent's expected activity time didn't match           | 409 (after one re-derived retry)            |
| `NXU09`       | A row changed since, or Undo/Redo would leave a link dangling                     | 409                                         |
| `NXU10`       | Already undone (including two Undos racing on the unique index)                   | 409                                         |
| `NXU11`       | Already exists: a reused id or a second live copy of a link                       | 409 "That already exists."                  |
| `NXU13`       | A run's lease moved on (reaped or claimed again)                                  | `RunLeaseLostError`; the worker stops       |
| `NXU14`       | The user already has 3 runs working                                               | 409                                         |
| `NXU22`       | Malformed changeset (bad op/origin/source/run/payload, missing or invalid column) | 400                                         |
| anything else | Unknown                                                                           | 500, logged as `[tag] <fallback> (<code>).` |

## Kinds

`packages/types/src/kinds/registry.ts` exports `KIND_REGISTRY`: for each kind, a Zod schema, a
`version`, and an `upgrade(data, fromVersion)` function. `parseKindData(kind, data, version?)`
upgrades old data first, then validates it, and is what `apps/api/src/lib/graph/prepare.ts` calls
before any object write reaches the database. It registers `trip`, `place`, `leg`, `stay`,
`decision`, `option`, `insight`, and the fallback `thing`. Their schemas are grouped by who uses
them: `kinds/money.ts` (money and currency conversion), `kinds/common.ts` (`decision`, `option`,
`insight` and `thing`, which every template uses) and `kinds/travel/` (`schemas.ts` for `trip`,
`place`, `leg` and `stay`; `figures.ts` for a trip's figures).

To add a kind: add its Zod schema (in its template's `kinds/<template>/` folder, or `common.ts`
when every template uses it) and a registry entry with `version: 1` and `upgrade: (data) =>
data`. No migration — `data` is JSONB and the schema is the only place shape is enforced. To
change an existing kind's shape, bump `version` and write a real `upgrade` that maps old data to
the new shape; `parseKindData` runs it automatically whenever a stored object's `kind_version` is
behind the registry's.

Two more tables are keyed by kind, typed `Record<KindName, …>` so a kind missing from either
fails typecheck:

- `KIND_CARDS` (`packages/types/src/kinds/cards.ts`): the fields a card shows for each kind.
- `KIND_BEHAVIOUR` (`apps/api/src/lib/kinds/behaviour.ts`): how the generic `object.*`,
  `relationship.create` and `workspace.addSection` capabilities treat each kind. `creatable` lets
  `object.create` make one and `object.delete` remove one; `editable` lets `object.update`
  change one (an anchor is editable, never creatable); `positioned` puts a new one at the end of
  its ordered list (a place joins the route); `links` are the relationships `object.create` makes
  from its inputs (a leg's `from` and `to` places, with `title` naming it from them);
  `dependents` is what `object.delete` takes with it (a place's legs and stays). `plural`,
  `modelHelp`, `createNote`, `deleteNote` and `linkNote` are the words capability descriptions
  and the data help use. A template's capability scope lists its kinds and the capabilities
  read the rest here, so a new kind needs no capability code. `lib/kinds` imports no other domain.

`KIND_FIGURES` (`packages/types/src/kinds/figures.ts`) is keyed by anchor kind instead
(`ANCHOR_KINDS`: the kinds that anchor a workspace, `trip` so far). Each entry recomputes that
anchor's figures from a snapshot with no model involved; the trip's are `totalDays`,
`allocatedDays`, `unallocatedDays` and `estCost`. The workspace's metric, allocation and route
sections read figures this way, not from `data.derived`, so an optimistic edit moves them at
once; the Changes feed still reads `data.derived` from an event's ops. The template's
derivation writes the same numbers to the anchor's `data.derived` on the server.
`anchorFigures(snapshot)` gets the workspace anchor's figures, and `figureValue(figures, key)`
reads one by derived key.

## Templates

A template is one use case, declared in one object so no other code has to name it.
`TemplateDefinition` (`apps/api/src/lib/templates/types.ts`) has these fields, and these
readers:

| Field          | Holds                                                                                            | Read by                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | Its `templateSchema` value                                                                       | `TEMPLATES` is keyed by it; Jev's answer and `startIntent` use it                                                                  |
| `anchorKind`   | The kind of the workspace anchor (`trip`)                                                        | No runtime reader (the capabilities read `TRAVEL_SCOPE.anchorKind`); a test checks it is one of `kinds`, editable, never creatable |
| `anchorRef`    | What models call the anchor (`trip`)                                                             | `createStager` builds the ref table with it; `instructionsFor` names it in the prompt                                              |
| `kinds`        | Every kind its plans hold, the anchor's included                                                 | No runtime reader: a copy of `TRAVEL_SCOPE.kinds`, which the capabilities read; a test checks they create only these kinds         |
| `perception`   | The sentence Jev reads when it picks a template for a goal                                       | `chooseTemplate` (`perception/perceive.ts`), as this template's criterion                                                          |
| `context`      | Its own keys in `intents.context`, as Zod schemas                                                | `contextSchemaFor`, which `validateOps` applies to an `update_intent` that sets `context`                                          |
| `figures`      | The anchor's `data.derived` keys the event payload reports when a change moves them, with labels | `figureChanges` (`graph/payload.ts`)                                                                                               |
| `seed`         | The ops that start a plan from its goal: the anchor and the workspace                            | `createIntent` (`graph/commit.ts`)                                                                                                 |
| `derive`       | Ops derived from a staged changeset (a `DeriveInput`), committed with it                         | `deriveForTemplate`, from `prepareChangeset`                                                                                       |
| `capabilities` | What runs and the app's buttons may call, in the order models see them                           | `executeRun` (the run's tools) and `invokeCapability`                                                                              |
| `prompt`       | The role, the anchor's description, the rules, the create task and each ask task                 | `instructionsFor` (`cognition/prompts.ts`)                                                                                         |
| `routes`       | Model budgets that replace the default for some routes (optional)                                | `routeBudget` (`runs/execute.ts`)                                                                                                  |

`TEMPLATES` (`apps/api/src/lib/templates/registry.ts`) is a `Record<Template, TemplateDefinition>`,
so a name `templateSchema` (`packages/types/src/graph.ts`) lists without a definition fails
typecheck. `templateFor(name)` returns the definition, or null for an intent with no template (a
saved goal Nexui can't plan yet): it derives nothing, no run or capability applies to it, and its
context may hold only the eval tag. `contextSchemaFor` adds that tag (`context.eval`, written by
`scripts/eval-travel.mjs`) to every template's keys, so a template can't forget it. The
database's check still allows `job_search`, which `templateSchema` lists once a definition exists.
Code reads a template through `TEMPLATES` or `templateFor` and does not compare names.
`UNSUPPORTED_GOAL` ("Nexui can't plan this yet.", same file) is a saved goal's summary line and
the refusal to ask about it or stage a change on it.

The `lib/travel` domain (`apps/api/src/lib/travel/`) holds everything only the travel template
knows: `template.ts` builds `TRAVEL_TEMPLATE`; `seed.ts` has `seedTravelOps` and
`travelWorkspace`; `derive.ts` has `deriveTrip`; `capabilities.ts` has `TRAVEL_SCOPE` and
`TRAVEL_CAPABILITIES` (`trip.setPlaceDays`, `trip.reorderPlaces` and the generic ones built for
trips); `decisions.ts` has `TRAVEL_DECISIONS`; `prompt.ts` has `TRAVEL_PROMPT`. A template is
its own domain rather than a folder under `lib/templates`, because the lint bans `../` imports
and a file in a subfolder couldn't import `TemplateDefinition` from beside it. `lib/templates`
keeps the interface, the map and the code that dispatches on it.

**Load order.** `TRAVEL_CAPABILITIES` and `TEMPLATES` are built at module load from other
domains' exports, so the domains load along one acyclic chain. Its import rules are about
runtime imports (`import type` doesn't count, and `travel/template.ts` and `travel/prompt.ts`
use it for `TemplateDefinition` and `TemplatePrompt`): `lib/kinds` imports no other domain,
`lib/capabilities` only `lib/kinds`, `lib/travel` only `lib/capabilities`, and `lib/templates`
only the domains below it (`lib/kinds`, `lib/capabilities` and `lib/travel`). That is why the
stager and `invokeCapability` are in `lib/staging`, which imports `lib/graph`, and not beside
the capability definitions. `tests/api-load-order.test.mjs` enforces the chain (see "Checking
it").

**Adding a template** touches a folder or a registry line in each place, and nothing in
`graph/`, `runs/`, `cognition/` or `orchestrator/` branches on it:

- `packages/types`: `kinds/<template>/` (schemas and figures); a `KIND_REGISTRY` and a
  `KIND_CARDS` entry for each new kind; `ANCHOR_KINDS` and `KIND_FIGURES` for its anchor kind;
  `templateSchema`; the exports in `index.ts`.
- `apps/api`: a domain `src/lib/<template>/` with its `TemplateDefinition` (seed, derivation,
  capabilities built from the generic builders for a `CapabilityScope` that lists its kinds,
  decision options, prompt), one line in `TEMPLATES`, and a `KIND_BEHAVIOUR` entry for each new
  kind. Its mock fixtures sit beside
  travel's in `lib/ai/fixtures/`, one flat folder (`RunFixture.perception.template` is typed from
  `Template`).
- `tests/`: its derive, capability and template tests, and a line for its domain in
  `tests/api-load-order.test.mjs`'s import checks (that test loads every domain without a change).
- `apps/mobile`: the mobile app still reads trip kinds outside the section primitives (the
  Changes feed, stop details, workspace actions), so a template's mobile side is not yet a
  registry line. Section 5 of
  [`docs/superpowers/specs/2026-10-04-architecture-readiness.md`](../superpowers/specs/2026-10-04-architecture-readiness.md)
  lists the target once those registries exist.

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
     live objects, so deleting the trip (the anchor) or a decision the doc shows is a 400. An
     `update_intent` that sets `context` is checked against `contextSchemaFor(template)`: the
     template's own keys and the eval tag, nothing else, so a bad write can't poison what reads
     the context (a 400 "Invalid context: …").
  3. The validated ops are staged in memory (`applyOps`), and `deriveForTemplate`
     (`apps/api/src/lib/templates/derive.ts`) hands the intent's template a `DeriveInput` (the
     plan before, the staged plan, the validated ops, the anchor id, `now` and `newId`) and runs
     its `derive` — `deriveTrip` (`apps/api/src/lib/travel/derive.ts`) for `template: 'travel'` —
     producing more ops with `origin: 'derived'`. An intent with no template, or no workspace,
     derives nothing.
  4. `coalesceOps` merges the direct and derived ops down to one op per row (a row can only
     appear once in `apply_changeset`'s input), then the whole set is validated again.
- **`commitChangeset`** (`apps/api/src/lib/graph/commit.ts`) loads the current snapshot, runs
  `prepareChangeset`, and calls the `apply_changeset` RPC with the snapshot's `lastActivityAt`.
  If another change landed in between (`NXU08`), the derived values would be stale, so it
  reloads, re-prepares and retries once; a second `NXU08` is the 409. The route
  (`apps/api/src/app/api/intents/[id]/changesets/route.ts`) returns its `{ event, snapshot }`
  unchanged.
- **The event's payload** (`apps/api/src/lib/graph/payload.ts`; `changesetPayloadSchema` in
  `packages/types/src/graph.ts`): `commitChangeset` also sends `{ label?, figures? }` as the
  RPC's last argument, and `private.set_event_payload` stores it on the event
  `private.apply_ops` just logged, in the same transaction, so `apply_ops` is unchanged.
  - `label` is the change's sentence, for the Changes feed to show ("Set Kyoto to 3 days"). A button
    press (`invokeCapability`) uses its capability's label, a raw changeset (the changesets
    route) "Edited the plan", and a run's step its first call's label, or "<first label> and N
    more" for several (`changesetLabel`), counting only the calls that still applied after a
    replay. The label is read after `restage`.
  - `figures` is `[{ label, before, after }]` for the anchor figures the changeset moved:
    `figureChanges` compares the `data.derived` keys the template lists in `figures`, before and
    after the prepared ops, and shows each as text. A plan's first derivation, an intent with no
    template and a change that moves nothing have none.
  - `set_event_payload` takes a JSON object of at most 4 000 characters, and anything else is
    `NXU22`, which rolls the changeset back. An empty payload changes nothing.
  - `payload` is not only API-written. `apply_changeset` is callable by signed-in clients, so a
    client can store any JSON object up to 4 000 characters on its own events. A reader, such as
    the Changes feed once it shows labels and figures, parses it with `changesetPayloadSchema`
    and treats it as untrusted. Seed (`create_intent`) and Undo/Redo (`revert_event`) events
    carry no payload, and events from before the payload have `{}`.
- **Size caps**: `POST /api/intents` and `POST /api/intents/:id/changesets` read the body with
  `readJsonBody` (`apps/api/src/lib/http/json-body.ts`) and refuse more than 65 536 characters
  with 413 "That change is too large.". In the contracts, link `metadata` and a capability
  action's `input` serialize to at most 2 000 characters, and an option has at most 12 `metrics`.

**Example** (`tests/derive-trip.test.mjs`, and `tests/changeset-payload.test.mjs` for the
payload): shortening Tokyo from 4 days to 3 stages an `update_object` on Tokyo, then
`deriveTrip` sees the trip now has 1 unallocated day and adds: an `update_object` on the trip storing the recalculated `data.derived` figures, an
`insert_object`/`insert_relationship` pair for a new "You have 1 day unallocated" insight (with
an `ask` action and a `capability` action offering to give the day back to Tokyo), and an
`update_intent` refreshing `summary` (`line: 'Dec 12 – 20, 8 days, 2 stops'`, an attention badge,
and the stop strip, each stop carrying its place key for Home's photos). All of it commits as one changeset, so undoing the user's edit undoes the
derived state with it. The event's payload reports the moved figure:
`{ label: 'unallocated days', before: '0', after: '1' }`.

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

A `metric` or `allocation` section names a figure by derived key, `<anchor kind>.<figure>`, such
as `trip.totalDays`. `derivedKeySchema` accepts that pattern, not a list; `figureValue` reads the
figure from the anchor's `KIND_FIGURES` entry, and a key for another anchor kind shows nothing.
`upgradeWorkspace` (`packages/types/src/workspace.ts`) brings a stored doc up to
`WORKSPACE_DOC_VERSION` before it is parsed, as a kind's `upgrade` does for object data;
`mapSnapshotRow` calls it on each snapshot's workspace doc. Format 1 is the only one, so it
returns the doc as it was, and the first change to a section's shape adds its step there.

A section can carry `pin: 'open'`, which lifts it into the workspace's "Open band" while it has
something unresolved — a `decision` with `status: 'open'`, or an `insight` whose query still
returns rows. `apps/api/src/lib/travel/seed.ts#travelWorkspace` builds the travel template's
starting doc (`map`, `metric`, `allocation`, a pinned `insight`, then `route`), and
`deriveTrip`'s `lengthDecisionOps` (`apps/api/src/lib/travel/derive.ts`) adds and removes a
pinned `decision` section as the trip's length becomes known or unknown.

## AI runs

`POST /api/intents` and `POST /api/intents/[id]/ask` perceive, then start a run
(`src/lib/orchestrator/orchestrate.ts`). The route answers at once; `after()` executes the run
as a worker with the service-role client (see "Run queue" below).

- **Perception** (`src/lib/perception`): Jev (`NEXUI_MODEL_PERCEPTION`, `typesafe-ai/jev`)
  answers one choice question within 5 seconds. A goal is a template's name (`travel`) or
  `unsupported`, a sentence that names no template; each template's `perception` sentence is its
  criterion, so a new template teaches routing by existing. If Jev fails, times out or picks a
  choice it wasn't offered (the AI SDK refuses that answer), `chooseTemplate` throws
  `PerceptionFailedError` and `POST /api/intents` answers 503 "Nexui couldn't read that goal. Try
  again." without writing anything. An ask is `edit`, `fast` or `reasoning`; if Jev fails, it gets
  `reasoning`.
- **Saved goals** (`startIntent`): `POST /api/intents` answers an `outcome`
  (`createIntentResponseSchema`, a union in `packages/types/src/api.ts`), and each outcome names
  its status in `CREATE_STATUS`: `started` (201, the snapshot and the run's id) and
  `unsupported` (201, nothing else). A saved goal is an intent with `template` null: one summary
  op (`UNSUPPORTED_GOAL`), no workspace and no run. `listIntents` leaves it off Home; Changes
  still shows its "started" row. Account deletion removes it through the `intents.user_id`
  cascade. To rank which use cases to build next, list the saved goals across users in the
  project's SQL editor:

  ```sql
  select i.created_at, i.goal
  from public.intents i
  where i.template is null
  order by i.created_at desc;
  ```

  Job-hunting goals saved before job search's template shipped appear there too.

- **Starting a trip** (`startIntent`): if `create_run` fails after the intent was seeded, the
  intent is deleted with `discard_intent` before the error is rethrown. A failed discard is
  logged under `[intents]` with only its error code, and the original error is still the one
  rethrown.
- **Runs** (`src/lib/runs`, `20260929000000_runs.sql`, `20260930000000_run_cutoff.sql`,
  `20261003000000_run_stopping.sql`, `20261004130000_run_queue.sql`): a run is `queued`, `running`, `stopping`,
  `awaiting_approval` (unused in slice 1), `succeeded`, `failed` or `cancelled`.
  `ACTIVE_RUN_STATUSES` / `isActiveRunStatus` (`packages/types/src/runs.ts`) are the first three.
  - `create_run(user_id, intent_id, kind, input)` is executable by `service_role` only: the API
    queues each run with the admin client, for the user `verifyRequest` returned, so a client
    can't queue a run that skips the API's validation and perception. It checks the input too
    (`route` is `edit`, `fast` or `reasoning`; `text` is 1 to 1000 characters; otherwise
    `NXU22`). It refuses while another run on the intent is queued, running or stopping (NXU12,
    409), so a stopped run's last commit can never land under a newer run, and while the user
    has 3 runs working across their plans (NXU14, 409 "Nexui is already working on a few of your
    plans. Try again in a minute."), so one account can't fill `RUN_MAX_ACTIVE`.
  - `run_record_step` appends each step's calls to `runs.progress`
    (`{ step, capability, label, ok, ms, input, error? }`): a step whose entries would take
    `progress` past 100 is not recorded, so it holds at most 100 entries. It also appends the
    step's tokens to `runs.model_usage`, and returns the status. A stopping run keeps that last
    step's entries and usage and stays `stopping`; the executor treats any status but `running`
    as a stop.
  - **Stop** (`cancel_run`) lets a running run finish the step it is taking: the run moves to
    `stopping`, the executor commits and records that step, then finishes the run `cancelled`.
    A queued or awaiting-approval run is cancelled at once. A run that already finished, or is
    already stopping, comes back unchanged.
  - `run_finish` turns a stopping run into `cancelled`, or `failed` with the error if its last
    step failed, and never changes a finished run. A queued run whose lease hasn't started a step
    is cancelled at once by `cancel_run`.
  - A run still queued, running or stopping 15 minutes after it was created reads as failed
    ("This run stopped unexpectedly."), and stops blocking `create_run`. The reaper settles it
    sooner; the read-time cutoff (`RUN_STALE_MS`) is the backstop if the cron is down.
  - **Run queue** (`20261004130000_run_queue.sql`, `src/lib/runs/worker.ts`): the `runs` table is
    the queue. `runs.attempts`, `lease_id` and `lease_expires_at` record a claim. The worker
    functions are `security definer` and executable by `service_role` only; every write names the
    run and its lease, and a lease that is null, lapsed or not the run's raises `NXU13`.
    - `claim_runs(run_id, limit, lease_seconds, max_active)` leases `queued` runs with
      `for update skip locked`, skipping runs past the deadline and claiming nothing once
      `max_active` runs hold a live lease. With a run id it claims that run (the fast path);
      without one it takes the oldest unclaimed runs created over 10 seconds ago.
    - `run_record_step`, `run_finish` and `run_apply_changeset` do the run's writes;
      `run_apply_changeset` takes `(run_id, lease_id, ops, expected_activity_at, payload)`. It has
      no intent or actor parameter: it applies the ops as actor `ai` for the run's own user and
      intent, and sets the event's payload as `apply_changeset` does. `record_run_step` and
      `finish_run` no longer exist.
    - `reap_runs()` handles each active run whose lease lapsed or that is past the deadline: a
      `stopping` run becomes `cancelled`; a run with a committed changeset, a run past the
      deadline or one with 2 attempts becomes `failed`; anything else goes back to `queued`
      with its progress cleared (`model_usage` is kept). So a run that committed nothing is
      retried once, and one that committed keeps its steps and fails.
    - The route queues the run with `create_run`, then `after()` calls `workRun`, which
      claims it, opens an AI session from the run's kind and input, and runs `executeRun` with the
      admin client and the lease. `RUN_LEASE_SECONDS` is 330. On `NXU13` the executor stops
      without finishing the run. A claimed row that doesn't parse is finished `failed` on its
      own, so it can't hold back the rest of a batch.
    - `GET /api/cron/runs` (`apps/api/vercel.json`, every minute) checks
      `Authorization: Bearer <CRON_SECRET>` (`verify-cron.ts`: 401 on a mismatch, 503 and a
      `[cron]` log when unset or under 32 characters), then `sweepRuns` reaps, claims up to `RUN_SWEEP_LIMIT` (10) runs
      and executes them in `after()`. `RUN_MAX_ACTIVE` (default 100) caps live leases.
  - Home shows "Drafting" on intents with a working run.
- **The run's template** (`executeRun`, `src/lib/runs/execute.ts`): the run reads its intent's
  template with `templateOf` (`src/lib/staging`), which refuses an intent with no template or no
  workspace (`UNSUPPORTED_GOAL`), and takes from it the capabilities that
  become the model's tools, the instructions (`instructionsFor(template, kind, route)`) and the
  route's budget (`routeBudget`: the template's `routes` entry, else the default below).
- **Cognition** (`src/lib/cognition`): `generateText` with the capabilities as tools (`.` becomes
  `_` in tool names). `edit` and `fast` use `NEXUI_MODEL_FAST` for one forced tool step plus one
  correction; `reasoning` and the create run use `NEXUI_MODEL_REASONING` for up to 8 steps (the
  default budgets, `ROUTES` in `runs/execute.ts`). Each step's ops commit as one changeset with
  actor `ai` and the run id, so a step can be undone from Changes. Two failing steps in a row
  fail the run; committed steps stay.
  - **Refused calls show in progress.** A call whose input breaks the tool's schema never reaches
    the stager: the AI SDK refuses it as a `tool-error`. `runModel` collects those into
    `StepReport.refused`, and `commitStep` records each with `recordRefused` as an `ok: false`
    entry whose `error` is the schema's first issue (`days: Too small …`), after the step's own
    calls. The model still gets the error and can correct itself.
  - **A forced step that fails, then answers in text, is `invalid`.** For `edit` and `fast`, a
    text answer after a step with errors means the model gave up on the change, so the run fails
    with "Nexui couldn't make a valid change.". A first forced step that answers in text still
    finishes: the model found nothing to change. A safety refusal, which Claude Haiku 5.5 (the
    default fast model) can return, takes the same paths.
- **Capabilities** (`src/lib/capabilities`): named, Zod-typed functions that turn input into ops
  against a staged copy of the intent. The generic ones (`object.*`, `relationship.*`,
  `workspace.*`, `decision.*`) are built for each template from a `CapabilityScope` (its kinds,
  its anchor kind and the examples its tool descriptions use) and `KIND_BEHAVIOUR`; the template
  adds its own, and lists them all in `capabilities` (`TRAVEL_CAPABILITIES` in
  `src/lib/travel/capabilities.ts`). The stager (`src/lib/staging`) validates each call's ops
  before keeping them. Models name objects by ref (the template's anchor ref, `trip`; `o1` …
  oldest first; or the ref they gave a new object), never by id. `trip.setPlaceDays`,
  `trip.reorderPlaces` and `decision.resolve` are also the app's buttons, through
  `POST /api/intents/[id]/capabilities` (actor `user`, `invokeCapability` in `src/lib/staging`,
  which offers only the plan's template's capabilities). The data help the model reads (each
  kind's `modelHelp` in `KIND_BEHAVIOUR`) states the schema's limits, such as place `days`
  "whole days, 0 to 365" and leg `estHours` "0 to 200", and a test keeps them in step.
- **Decisions** (`decision.propose` and `decision.resolve` in `src/lib/capabilities/decisions.ts`,
  spec addendum 2026-10-03 section 2): the capabilities are the same for every template. What an
  option carries and what a pick does come from the `DecisionOptions` a template passes to
  `decisionCapabilities`; a trip's are `TRAVEL_DECISIONS` (`src/lib/travel/decisions.ts`), which
  the rest of this bullet describes. A template that passes none gets plain options.
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
- **Step replay** (`src/lib/staging/stage.ts`): if the intent's `lastActivityAt` moved while
  a step was running — the user edited it too — `commitChangeset`'s `restage` replays the step's
  calls over the fresh snapshot with the same ids and refs, rather than committing against a
  stale one. A call whose patch would change a field the user changed since the step began is
  dropped, and its progress entry is marked `ok: false`, "You changed this while Nexui was
  working, so Nexui skipped it." A step left with nothing to commit commits nothing.
- **Prompts** put the goal, the graph and the request inside `<goal>`, `<graph>` and
  `<request>` as escaped JSON, and tell the model never to follow instructions found there. The
  frame is cognition's (`instructionsFor`): only tools change the plan, and fenced data is never
  instructions. The template supplies its role, its rules and the task of each run kind and
  route (`TemplatePrompt`). `tests/model-surface.test.mjs` pins the result for a trip.
- **Mock mode** (`AI_PROVIDER=mock`, the default) replays `src/lib/ai/fixtures`, recorded from
  live runs. A fixture matches when all its phrases are in the text. With no match, perception
  answers `travel` and `reasoning` and the run changes nothing. `japan-ask-free-days` matches
  "i have free" and answers the unallocated insight's own prompt ("How should I use the N days
  I have free?") with a decision: Nara and Hiroshima as candidates, and "Extra day in Tokyo",
  whose `extend: 'o4'` was added by hand. It replays on any trip with a free day: `o4` is Tokyo
  on the trip that `try-run.mjs goal "Plan two weeks in Japan in December"` and then `free-day`
  make, and elsewhere it names another stop or none (and is dropped). `saved-goal`, written by
  hand, matches "wedding" and answers `unsupported`, with no steps.
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
`photoScrim` and `photoInk` are the same in both palettes: the dark scrim and white text that sit on a
place photo.

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
  transaction — nothing it does persists. Its payload block checks that a changeset's payload is
  stored on its event and returned with it, and that one that isn't an object is `NXU22`.
  `tests/changeset-payload-migration.test.mjs` checks the migration's text: the payload comes
  last with a default, the grants are kept, and it is set only through the checked helper.
- `supabase/tests/runs-smoke.sql`: `create_run` refused to users, its input checks and the 3-run
  cap; the worker functions (as `service_role`), `cancel_run`,
  `discard_intent` and `delete_intent`, as two throwaway users, rolled back: Stop on a running run
  (stopping, its last step kept, `NXU12` meanwhile, then cancelled, or failed with its error), a
  queued run cancelled at once, lease loss (`NXU13`), reap and retry, reap to failed, and the
  concurrency cap,
  `discard_intent` refusing an intent with a run or another user's, and `delete_intent` refusing a
  plan with an active run (`NXU12`) or another user's (`NXU04`), then removing a plan with its
  graph, runs and events. With the project linked, it also runs as
  `pnpm exec supabase db query --linked -f supabase/tests/runs-smoke.sql`.
- `supabase/tests/broadcast-smoke.sql`: a changeset and each run write send one message on the
  intent's topic, the owner can join it and another user can't. Rolled back.
  Both SQL smoke tests run against a local `supabase start` with
  `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f <file>`.
- `scripts/smoke-intent-graph.mjs [.qa/session.json] [apiUrl]`: a live end-to-end check against
  a running API. Needs a QA session (`node scripts/qa-session.mjs > .qa/session.json`) and the
  API running (`pnpm dev:api`). It needs AI_PROVIDER=mock and waits for each run. After an ask
  and its run, it asks the unallocated insight's own question (replaying
  `japan-ask-free-days`), picks a place (the free day is used, a leg reaches it, the other
  candidates are deleted), undoes the pick (every candidate is back and the decision open), and
  saves a goal ("plan my wedding next June", replaying `saved-goal`) and checks Home leaves it
  out, and ends with a cancel of a finished run.
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
- `tests/model-surface.test.mjs`: pins what models see for a trip: each tool's name,
  description, flags and input schema, the instructions for every run kind and route, and Jev's
  template question, against `tests/support/travel-model-surface.json`. A change to a prompt, a
  tool description or a tool schema fails it. To change one on purpose, run
  `node --experimental-strip-types tests/support/model-surface.mjs`, then
  `pnpm exec prettier --write tests/support/travel-model-surface.json`, and review the diff.
- `tests/api-load-order.test.mjs`: loads each `apps/api/src/lib/` domain first in a fresh Node
  process, so no import order hides a cycle that uses another domain's export at module top
  level, and pins the import chain behind the registries (see "Templates").
