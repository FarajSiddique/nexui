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

Six tables, defined in `supabase/migrations/20260927000000_intent_graph.sql`: `intents`,
`objects`, `relationships`, `events` (append-only), `workspaces`, and `runs` (created now for
the intelligence plan; unused today). Every table is owner-scoped by RLS. Clients get no
direct `insert`/`update`/`delete` — the migration `revoke`s those and only `grant`s `select` to
`authenticated`. All writes go through `security definer` functions:

- `create_intent(id, goal, template, ops)`: inserts the intent, then applies its seed changeset
  as actor `system`.
- `apply_changeset(intent_id, actor, run_id, ops)`: locks the intent, checks ownership, and
  calls the shared `private.apply_ops` to apply the ops and log one `events` row.
- `revert_event(event_id)`: Undo. Writes each op's `before` back, newest first, as a new
  changeset with `reverts_event_id` set. **Redo is `revert_event` on the Undo event itself** —
  one route serves both.
- `get_intent_snapshot(id)` / `changes_page(limit, before_seq, intent_id)`: read helpers used by
  the API's list/query code.

`private.apply_ops` is the one place rows actually change. It rejects an op whose `origin` isn't
`direct` or `derived`, a `source.type` outside `user`/`ai`/`derived`/`external`, more than one op
touching the same row, and a relationship endpoint that isn't one of the caller's own live
objects or intents (`private.check_endpoint`). `revert_event` additionally refuses to undo the
create-intent (`system`) event, compares `updated_at` as `timestamptz` to detect a row that
changed underneath it, and raises if undoing would leave a live relationship pointing at an
object it just removed, or would revive a relationship whose endpoint is gone (also on a
duplicate live relationship). Read the migration for the exact checks.

The functions are still callable with the caller's own token, so a client that skips the API can
write unvalidated `data` or mislabel the actor of its own changes — accepted for slice 1 (spec
section C), because AI runs write with the user's token too.

**Error codes and HTTP mapping** (`apps/api/src/lib/graph/errors.ts#mapRpcError`, used by
`apps/api/src/lib/graph/respond.ts#graphErrorResponse`):

| Code              | Meaning                                    | HTTP                                     |
| ----------------- | ------------------------------------------ | ---------------------------------------- |
| `NXU04`           | Not found, or not the caller's             | 404                                      |
| `NXU08`           | `expectedUpdatedAt` didn't match           | 409                                      |
| `NXU09`           | Undo/Redo would leave a link dangling      | 409                                      |
| `NXU10` / `23505` | Already undone                             | 409                                      |
| `NXU22`           | Malformed changeset (bad op/origin/source) | 400                                      |
| anything else     | Unknown                                    | 500, logged, generic message to the user |

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
     endpoints against the snapshot, via `applyOps` (`packages/types/src/apply-ops.ts`).
  3. The validated ops are staged in memory (`applyOps`), and `deriveForTemplate`
     (`apps/api/src/lib/templates/index.ts`) runs the intent's template derivation — `derive.trip`
     for `template: 'travel'` — over the staged result, producing more ops with `origin:
'derived'`.
  4. `coalesceOps` merges the direct and derived ops down to one op per row (a row can only
     appear once in `apply_changeset`'s input), then the whole set is validated again.
- **`commitChangeset`** (`apps/api/src/lib/graph/commit.ts`) loads the current snapshot, runs
  `prepareChangeset`, and calls the `apply_changeset` RPC. The route
  (`apps/api/src/app/api/intents/[id]/changesets/route.ts`) returns its `{ event, snapshot }`
  unchanged.

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
  event; a second attempt gets `NXU10`.
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
the mobile renderer will use the same function to read a section's rows.

A section can carry `pin: 'open'`, which lifts it into the workspace's "Open band" while it has
something unresolved — a `decision` with `status: 'open'`, or an `insight` whose query still
returns rows. `apps/api/src/lib/templates/travel.ts#travelWorkspace` builds the travel template's
starting doc (`map`, `metric`, `allocation`, a pinned `insight`, then `route`), and
`deriveTrip`'s `lengthDecisionOps` adds and removes a pinned `decision` section as the trip's
length becomes known or unknown.

## Theming

`apps/mobile/src/lib/theme.ts` exports `light` and `dark` palettes with identical keys
(`TokenName`/`Palette` types), plus the font faces. Components never use a raw color: they read
one through `useColors()` (for colors passed as props) or `createThemedStyles(factory)` (for a
`StyleSheet`, cached per scheme) — both in `apps/mobile/src/lib/use-theme.ts`. `useScheme()`
reads `useColorScheme()` and treats anything but `'dark'` as light. `tests/theme-tokens.test.mjs`
is the guard: it asserts both palettes declare the same keys, scans `apps/mobile/src` for hex/
`rgb(`/`rgba(` literals outside `theme.ts`, and checks AA contrast (≥ 4.5:1) for the token pairs
text is actually drawn with.

## Checking it

- `supabase/tests/intent-graph-smoke.sql`: paste into the Supabase SQL editor (or run with
  `psql`) against a scratch database. Creates two throwaway users, exercises create, change,
  undo, redo and cross-user isolation through the RPCs, and rolls everything back in one
  transaction — nothing it does persists.
- `scripts/smoke-intent-graph.mjs [.qa/session.json] [apiUrl]`: a live end-to-end check against
  a running API. Needs a QA session (`node scripts/qa-session.mjs > .qa/session.json`) and the
  API running (`pnpm dev:api`). It creates a trip, plans two stops, shortens one, checks the
  resulting insight, undoes, redoes, and confirms Changes shows all five events with the redo as
  the second event's `revertedByEventId`.
