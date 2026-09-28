# Nexui intent graph: product reset design

**Status:** approved in conversation on 2026-09-27; awaiting review of this written spec.
**Replaces:** everything in `docs/specs/` and the 2026-09-24 intent-actions and persistence
designs. These are deleted in slice 1, step 1.

> **The intent is the application.** Nexui turns what someone is trying to accomplish into a
> persistent object graph, and renders that graph as a workspace made only of registered
> primitives. The graph is the product. Conversation is one way to change it.

## 0. Decisions made while brainstorming

| Topic            | Decision                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick capture    | **Deleted.** No tasks, events, notes, command classifier or Tasks/Calendar/Notes tabs. A loose capture may come back later as an input that Jev routes to an intent. |
| Shell            | **Tabs: Home · (+) · Changes.** A workspace pushes over Home. + opened inside a workspace acts on that workspace; opened anywhere else, it starts a new intent. |
| Object model     | **Generic graph plus a kind registry in code** (Zod), with a `thing` fallback kind. No table per kind, and no kinds invented by the AI at runtime.             |
| Workspace        | A versioned JSON doc per intent, created from a template. Sections bind to **graph queries**, not fixed IDs.                                                   |
| Mutations        | Every write is a **changeset** in `events`, with before and after values. Changes inside Nexui apply at once with Undo; anything that leaves Nexui needs approval. |
| Long AI work     | A `runs` row. Objects are written as they're produced and streamed to the client through **Supabase Realtime**.                                                |
| First slice      | **Travel anywhere in the world**, not Japan specifically. It includes a `map` primitive.                                                                      |
| Second slice     | Job search. It gets its own spec and plan and must reuse the architecture without new tables or screens.                                                      |
| Old data         | Prototype with no users: delete the old migrations and reset the dev database (ask before running the reset).                                                 |

## A. Current architecture assessment

```
Mobile (Expo)                       API (Next.js)                         Supabase
Tabs: Home·Tasks·(+)·Calendar·Notes
+ sheet → Magic Bar ── POST /api/intent ──► decision-engine
                                            ├ chrono date/time candidates
                                            ├ Jev /v1/evaluate: "which of 8 commands?"
                                            └ action-builder → typed draft
  DraftSheet / ChangeSheet
  instant save + Undo ─ POST /api/intent-events ─► insert/patch ──────►  tasks │ events │ notes
                        POST …/undo                                       intent_events (log)
Tasks/Calendar/Notes ◄─ /api/tasks, /timeline, /search, /items/:kind/:id
```

Assumptions centred on tasks, and where they live:

- "Intent" means a command label (`CREATE_TASK`, `RESCHEDULE` …) in `@nexui/types`, the decision
  engine, the evals and the `add-intent` skill. Under the new thesis, "intent" means a goal.
- Only three item kinds exist, each with its own table, mapper, patch schema, form fields and
  preview. Adding a kind means touching around 18 files (see the `add-intent` skill).
- The UI is built around lists: a tab per item kind, a timeline and task groups.
- The AI outputs one draft action per sentence. Nothing persists at the level of a goal.

Parts that don't depend on that model: auth, the HTTP helpers, the Supabase clients, health
and connectivity, the query provider, the theme, the config, the hooks, QA sessions, the test
setup, and the Jev transport (Gateway `/v1/evaluate` with abort, timeout and schema-checked
answers). The transport already does what this design calls perception.

## B. Proposed architecture

```
┌──────────────── apps/mobile (Expo) ────────────────┐
│ Shell: Home · (+) · Changes      intent/[id]       │
│ Renderer: section.type → registered primitive      │
│ TanStack Query cache = graph snapshot per intent   │
│ Optimistic changesets · Realtime subscriber        │
└───────┬───────────────────────────────▲────────────┘
        │ HTTPS (bearer JWT)             │ Realtime (RLS-scoped)
┌───────▼──────────── apps/api (Next.js) ───────────────────────────┐
│ app/api/**         thin: verify → parse (Zod) → call core → respond│
│ lib/graph          applyChangeset · invert · snapshot              │
│ lib/kinds          server derivations per kind (derive.trip)       │
│ lib/capabilities   registry, policy, model-tool adapter            │
│ lib/perception     Jev (/v1/evaluate): bounded questions           │
│ lib/cognition      AI SDK via Gateway; tiers fast | reasoning      │
│ lib/orchestrator   input → perceive → route → reason → tools →     │
│                    changesets → workspace ops                      │
│ lib/runs           long work, written as it goes (after())         │
│ lib/templates      travel (slice 1), job_search (slice 2)          │
└───────┬───────────────────────────────────────────────────────────┘
        │ user-scoped client (RLS) + apply_changeset() RPC
┌───────▼──────────── Supabase ────────────┐
│ intents · objects · relationships ·      │
│ events · workspaces · runs               │
└──────────────────────────────────────────┘
packages/types: kind registry, changeset ops, GraphQuery + evaluateQuery,
WorkspaceDoc, Run and Event shapes. Shared by API and mobile. No server code.
```

Boundaries:

- **Mobile** never calls models and never interprets meaning. It renders primitives, applies
  optimistic changesets and computes values for display only (for instant feedback).
- **The API is the only writer.** Every write, whether from a user edit, a derivation or an AI
  tool call, goes through `applyChangeset()`.
- **Deterministic derivations** run in the same changeset as the edit that caused them. An edit
  never needs a model call.
- **Jev** answers bounded questions: which template, which route tier, whether a change is
  material, whether to surface it. It is not a small generalist model.
- **Generative models** only produce capability calls. Their prose is limited to object fields
  such as `why` and `rationale`, and none of it becomes UI directly.
- **Model tiers:** `NEXUI_MODEL_FAST` and `NEXUI_MODEL_REASONING` hold Gateway model strings (for
  example `anthropic/claude-haiku-4-5` and `anthropic/claude-sonnet-5`) with Gateway fallbacks.
  `AI_PROVIDER=mock|live` switches both perception and cognition. Mock replays recorded fixtures
  deterministically and costs nothing.
- **Cross-intent support:** relationships carry `user_id` and typed endpoints, and have no FK
  that confines them to one intent. The schema allows cross-intent edges; no code builds them yet.

## C. Database schema

The old migrations are deleted and replaced by a single fresh `intent_graph` migration.

```sql
intents (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal text not null check (char_length(goal) between 1 and 500),
  template text,                                  -- 'travel' | 'job_search' | null
  status text not null default 'exploring'
    check (status in ('exploring','active','blocked','completed','archived')),
  context jsonb not null default '{}',            -- validated per template in code
  summary jsonb not null default '{}',            -- derived lines for Home, e.g. "3 unallocated days"
  created_at, updated_at, last_activity_at timestamptz not null default now()
)
index (user_id, status, last_activity_at desc)

objects (
  id uuid pk, user_id uuid not null default auth.uid(),
  intent_id uuid not null references intents on delete cascade,
  kind text not null, kind_version int not null default 1,
  title text, status text,
  data jsonb not null,                            -- validated against KIND_REGISTRY[kind]
  source jsonb,                                   -- {type:'user'|'ai'|'derived'|'external', runId?, url?}
  position double precision,                      -- stable user ordering (route order)
  deleted_at timestamptz,                         -- soft delete: Undo and audit
  created_at, updated_at
)
index (intent_id, kind) where deleted_at is null

relationships (
  id uuid pk, user_id uuid not null default auth.uid(),
  source_type text check (source_type in ('object','intent')), source_id uuid not null,
  target_type text check (target_type in ('object','intent')), target_id uuid not null,
  type text not null,                             -- part_of, option_of, leg_from, leg_to …
  metadata jsonb, deleted_at timestamptz, created_at
)
index (source_id, type), (target_id, type)
unique (source_id, target_id, type) where deleted_at is null

events (                                          -- append-only: audit log and Undo source
  id uuid pk, user_id uuid not null default auth.uid(),
  intent_id uuid references intents on delete cascade,
  seq bigint generated always as identity,
  type text not null,                             -- changeset | run_started | run_finished | …
  actor text not null check (actor in ('user','derived','ai','system')),
  run_id uuid, reverts_event_id uuid references events,
  ops jsonb,                                      -- [{op, table, id, before, after}] for changesets
  payload jsonb not null default '{}',
  created_at
)
index (user_id, created_at desc), (intent_id, seq)

workspaces (
  intent_id uuid pk references intents on delete cascade,
  user_id uuid not null default auth.uid(),
  version int not null default 1,
  doc jsonb not null,                             -- WorkspaceDoc (section D)
  updated_at
)

runs (
  id uuid pk, user_id uuid not null default auth.uid(),
  intent_id uuid references intents on delete cascade,
  kind text not null check (kind in ('create_intent','ask')),
  status text not null default 'queued'
    check (status in ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  input jsonb not null, progress jsonb not null default '[]',
  error text, model_usage jsonb not null default '{}',
  started_at, finished_at
)
```

**JSONB versus columns.** A field is a column when Postgres has to filter, sort, join or
constrain on it: owner, intent, kind, status, position, relationship endpoints and timestamps.
Domain fields live in `data`, and the Zod schema for that kind validates them in the API before
the RPC runs. `kind_version` plus per-kind `upgrade` functions in `@nexui/types` let a kind
change shape without a migration. Objects are upgraded as they're read and written back on
their next save.

**RLS.** Every table is owner-only (`user_id = (select auth.uid())`). Inserts on objects,
relationships, workspaces and runs also check that the referenced intent or object belongs to
the caller. FK checks ignore RLS, which is the same problem `intent_events` solved. Clients can
select from `events` but not write to it; the RPC writes it with `security invoker`, so RLS
still applies. `objects`, `relationships`, `workspaces` and `runs` are published to Realtime,
which is scoped by RLS.

**Atomicity.** `apply_changeset(p_intent_id, p_actor, p_run_id, p_ops jsonb) returns events`
applies inserts, updates, soft deletes, relationship ops and workspace doc replacements. Updates
check `expected_updated_at` for optimistic concurrency. The function records `before` and
`after` for each op and inserts one `events` row, all in a single transaction. Undo is
`apply_changeset(inverse(ops))` with `reverts_event_id` set. It refuses to run if a later event
has changed the same rows since (409 with a readable message).

## D. Workspace contract

Everything below lives in `@nexui/types` and is the only language intelligence can use to shape
the UI.

```ts
type Ref = 'intent' | { objectId: string };

type GraphQuery =
  | { from: 'intent' }
  | {
      from: 'objects';
      kind?: KindName | KindName[];
      related?: { type: RelType; to: Ref; direction: 'out' | 'in' };
      where?: FieldFilter[];
      sort?: { field: string; dir: 'asc' | 'desc' } | 'position';
      limit?: number;
    }
  | { from: 'object'; id: string };

type FieldFilter = {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: Json;
};

interface WorkspaceDoc {
  version: number;
  sections: Section[]; // ordered; changed only by explicit workspace ops
}

type Section = { id: string; title?: string; collapsed?: boolean } & (
  | { type: 'map'; places: GraphQuery; legs?: GraphQuery }
  | { type: 'route'; query: GraphQuery; editable: ('days' | 'order')[] }
  | { type: 'metric'; metrics: MetricSpec[] }
  | { type: 'objectList'; query: GraphQuery; card: 'compact' | 'rich'; empty?: string }
  | { type: 'comparison'; query: GraphQuery; fields: FieldSpec[]; decisionId?: string }
  | { type: 'decision'; decisionId: string }
  | { type: 'insight'; query: GraphQuery }
);

type MetricSpec = {
  label: string;
  derived: DerivedKey; // e.g. 'trip.totalDays', 'trip.unallocatedDays', 'trip.estCost'
  format: 'days' | 'currency' | 'count';
};
type FieldSpec = { field: string; label: string; format?: 'currency' | 'days' | 'hours' | 'text' };
```

Slice 2 adds `pipeline` (`stageField`, `stages`) and `timeline` (`dateField`). `Chart`,
`RelationshipGraph` and `Scenario` from the product brief are deferred until a slice needs them.

**Rendering.** `SECTION_REGISTRY` is an exhaustive `Record<Section['type'], Component>`, so a
section type without a primitive fails typecheck. Each primitive receives
`{ section, rows, status }` and must provide loading, empty, error and accessible states. It
reports typed user actions upward, such as
`{ type: 'updateObject', objectId, patch }` or `{ type: 'resolveDecision', decisionId, optionId }`.
The workspace screen turns those into changesets. Primitives never call the API.

**Queries run on the client.** `GET /api/intents/:id` returns the intent, its workspace doc and
every live object and relationship (small at prototype scale). Realtime deltas merge into that
cache. The server runs the same `evaluateQuery()` from `@nexui/types` when it composes and
derives.

**Object cards.** `KIND_REGISTRY[kind]` declares the schema, `upgrade`, and a `card` spec
(which fields make up the title, subtitle, badges and editable fields). The same registry drives
both validation and rendering. `thing` has `data: { fields: {label, value}[] }` and renders as a
generic list of labeled fields.

**Who changes the doc.** Templates create it. The `workspace.addSection`,
`workspace.removeSection` and `workspace.moveSection` capabilities change it as ops inside a
changeset (versioned and undoable). The shell is not in the doc and cannot change.

### Slice-1 travel kinds

| Kind       | `data` (all validated)                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trip`     | `destinations: string[]`, `startDate?`, `endDate?`, `totalDays?`, `travelers?`, `budget?: {amount, currency}`, `pace?: 'slow'\|'balanced'\|'fast'`, `currency` |
| `place`    | `name`, `country` (ISO 3166-1 alpha-2), `placeType: 'city'\|'region'\|'town'\|'area'\|'site'`, `lat`, `lng`, `days`, `estDailyCost?: {amount, currency}`, `why?` |
| `leg`      | `mode: 'flight'\|'train'\|'bus'\|'car'\|'ferry'\|'other'`, `estHours?`, `estCost?: {amount, currency}` (endpoints are `leg_from` and `leg_to` relationships) |
| `stay`     | `name`, `placeId`, `nights`, `estNightly?: {amount, currency}`, `url?`                                                                                    |
| `decision` | `question`, `status: 'open'\|'resolved'`, `chosenOptionId?`, `tradeoff?`                                                                                   |
| `option`   | `label`, `placeId?`, `summary`, `pros: string[]`, `cons: string[]`, `metrics: Record<string, number>`                                                     |
| `insight`  | `text`, `severity: 'info'\|'attention'`, `derivedKey?`                                                                                                    |
| `thing`    | `fields: {label, value}[]`                                                                                                                                |

Relationships: `part_of` (place, stay or decision to the trip), `option_of` (option to decision),
`leg_from` / `leg_to` (leg to place).

**Derivations (`derive.trip`, code only):**

- `totalDays` comes from the dates, or is kept as the user set it.
- `unallocatedDays = totalDays − Σ place.days` for places that are `part_of` the trip.
- `estCost = Σ days·estDailyCost + Σ leg.estCost + Σ stay costs`, converted to `trip.currency`
  with a fixed rate table and labelled "approximate".
- If `unallocatedDays > 0`, one insight with `derivedKey: 'trip.unallocatedDays'` is upserted.
  At 0 or below it is soft-deleted. If `totalDays` is unknown, an open decision "How long is the
  trip?" is created instead.
- `intent.summary` is refreshed so Home shows lines like "5 stops · 3 unallocated days".

The travel template's default sections are `map`, `route` (editable: days, order), `metric`
(total days, unallocated, estimated cost), `insight`, and `decision` for each open decision.

## E. Capability interface

```ts
interface Capability<I, O> {
  name: `${string}.${string}`;
  description: string; // the tool description shown to models
  input: ZodType<I>;
  output: ZodType<O>;
  policy: 'internal' | 'approval'; // 'approval' = leaves Nexui; none in slice 1
  exposeToModel: boolean; // derive.* and other code-only capabilities stay hidden
  execute(input: I, ctx: CapabilityContext): Promise<{ output: O; ops: ChangesetOp[] }>;
}

interface CapabilityContext {
  userId: string;
  intentId: string;
  actor: 'user' | 'ai' | 'derived';
  runId?: string;
  graph: GraphSnapshot; // read view, updated as ops are staged
  db: UserScopedClient; // RLS always applies
  log: RunLogger;
}
```

- **Registration:** a static `CAPABILITIES` array. `toModelTools(capabilities, ctx)` turns the
  ones with `exposeToModel` into AI SDK tools.
- **Authorization:** the user-scoped client plus an intent ownership check. Models never see a
  service key.
- **Validation:** input schema → each emitted op's `data` against the kind registry → Postgres
  constraints in the RPC.
- **Observation:** each call is appended to `runs.progress` as `{capability, ms, ok}`, and token
  usage accumulates in `runs.model_usage`.
- **Commit rule:** capabilities return ops. The orchestrator commits the ops for each model step
  as **one changeset**, so undoing a step undoes all of it, and a run that fails partway keeps
  its committed steps. Undo on a run reverts its changesets newest first.

**Slice-1 capabilities:** `object.create`, `object.update`, `object.delete`,
`relationship.create`, `relationship.delete`, `trip.setPlaceDays`, `trip.reorderPlaces`,
`decision.propose` (creates decision, options and a comparison section), `decision.resolve`
(links the chosen place `part_of` the trip, gives it the available days and adds legs),
`workspace.addSection`, `workspace.removeSection`, `workspace.moveSection`, `derive.trip`
(code only). Slice 2 adds `web.search`, `jobs.*` and an `external_change` input.

## F. AI orchestration

A single `orchestrate(input, ctx)` function handles four kinds of input:

```
UserEdit(ops) ─► applyChangeset ─► derive.* (same transaction) ─► done
                 (no model on this path; Jev runs only when a derivation flags a threshold)

CreateIntent(text) ─► Jev: template ∈ {travel, none} (+ confidence)
                     ─► template seeds anchor object and workspace doc (code, instant)
                     ─► run(reasoning): extract trip facts, propose places and legs via tools
                     ─► each step commits a changeset ─► Realtime ─► map and route fill in

UserAsk(text, intentId) ─► Jev: route ∈ {edit, fast, reasoning}
   edit       ─► fast tier with structured output → one capability call ("make Kyoto 3 days")
   fast       ─► fast tier, one tool step ("hide places over $200/day" → section filter)
   reasoning  ─► run(reasoning, tools = graph capabilities, maxSteps ≈ 8)
                 ("could we use the extra time somewhere rural?" → decision.propose)

ExternalEvent (slice 2) ─► Jev: material? affects which intent? surface? ─► same routing
```

- **Where runs execute:** `after()` in the route handler (Fluid Compute, 300s default). The
  route returns `{ runId }` immediately. If runs need retries or more time, the executor moves
  to Vercel Workflow without changing its interface.
- **Surfacing thresholds (ambient, mostly slice 2):** ≥ 0.85 applies automatically where the
  policy is `internal`; 0.6–0.85 creates an insight suggesting it; below that, nothing happens.
- **Audit and reversal:** every AI changeset appears in Changes with its actor and run, and can
  be undone there.
- **Approval:** a capability with `policy: 'approval'` sets the run to `awaiting_approval` with
  a readable preview. None exist in slice 1.
- **Failure:** a failed run records its `error` and keeps the steps it committed. The client
  shows "Stopped partway — Undo or retry". Model output that fails validation is discarded, and
  the model is asked once to correct it before the step fails.
- **Prompt injection:** user text and intent goals go to models as data inside delimited fields,
  never as instructions. Tools can reach only the caller's intent.

## G. Migration plan

| Keep as is                                                                                                                                                                                                  | Refactor                                                                                                                                                                                                                                                                                                                                       | Replace                                                                                                                                                                                                           | Remove                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (sign-in, verify, session lifecycle, secure storage, `api/account`), `lib/http`, `lib/supabase`, `api/health` + `connection-banner` + `use-health`, `query-provider`, fonts and theme tokens, `packages/config`, format hook, `scripts/qa-session.mjs`, test setup, reviewer agents, `docs-keeper` | Jev client → `lib/perception`. `getDecisionEngine` → provider factory for perception + cognition. `tab-bar-items`, `tab-header`, `list-states`, `undo-toast`, `use-undo-store` → new shell. `scripts/eval-intent.mjs` → `eval-travel.mjs`. `intent-evaluator` agent → the travel evals. `docs/architecture/{persistence,instant-actions}.md` → rewritten | `@nexui/types` domain contracts, the migrations, the routes (`/api/intents`, `/api/intents/[id]`, `/api/intents/[id]/changesets`, `/api/intents/[id]/ask`, `/api/runs/[id]`, `/api/events/[id]/undo`, `/api/changes`), the tab layout and screens | `lib/decision-engine/*` except the Jev transport, `lib/records/*`, `chrono-node`, the `intent`, `intent-events`, `tasks`, `timeline`, `search` and `items` routes, the compose, draft, change, edit and item-form sheets, `intent-previews`, `magic-bar`, `item-fields`, `form-values`, `task-groups`, `timeline-*`, `highlight-segments`, `intent-display`, `intent-confidence`, `commit-label`, `compose-context`, `change-actions`, `submit-decision`, `use-intent-prediction`, `use-demo-store`, the `add-intent` skill, `evals/*.json`, their tests, all of `docs/specs/`, the 2026-09-24 superpowers specs and plans |

## H. Prototype plan

### Slice 1: travel anywhere

Build order (each step keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` passing):

1. **Clean slate.** Delete the Remove column. Rewire the shell to Home · (+) · Changes with
   placeholder screens.
2. **Contracts.** Kind registry, changeset ops, `GraphQuery` + `evaluateQuery`, `WorkspaceDoc`,
   Run, Event, plus unit tests.
3. **Database.** The `intent_graph` migration, `apply_changeset`, inverse, and RLS smoke tests.
   Ask before `supabase db reset --linked`.
4. **Core API.** `applyChangeset`, undo, `derive.trip`, and the create, get, changeset, undo and
   changes routes. A test shows that setting a place from 4 days to 3 gives `unallocatedDays` 1
   and an insight, with no model call.
5. **Intelligence.** Jev template routing and ask routing, AI SDK cognition through the Gateway
   (tiers from env), the capability registry and model-tool adapter, runs with `after()`, and
   mock fixtures recorded from live runs.
6. **Mobile.** Home (intent cards from `summary`), Changes (the event feed with Undo),
   `intent/[id]` workspace, the seven primitives (`map` through react-native-maps with a list
   fallback on web), optimistic changesets, and Realtime on the open intent's objects,
   relationships, workspace and runs.
7. **Ask flow.** "Could we use the extra time somewhere rural?" → reasoning run →
   `decision.propose` → a comparison appears → the user picks → `decision.resolve` → the route
   and map update and unallocated days drop to 0.
8. **Evals and smoke test.** `pnpm eval:travel` runs 8 varied prompts: Japan in December, a
   weekend in Chicago, a Portugal road trip, Southeast Asia on a backpacker budget, "a beach
   week somewhere warm", a business trip to Berlin plus two free days, a family Disney trip,
   and Iceland's ring road. Each must produce a valid graph: kinds pass their schemas, places
   have plausible coordinates, and days add up or an open "how long" decision exists. Then
   smoke-test in Expo with a QA session, first on mock and then live.

**Done when:** this flow works for any of the eval prompts, not only Japan. The user creates a
trip intent, and it is saved. Objects and relationships appear, the workspace is composed and
rendered from primitives, and the map shows the route. The user shortens a stop, and code
recalculates the days and shows the unallocated time. The user asks to use that time
differently, a reasoning run proposes candidate places as objects, and a comparison appears.
The user picks one, and the trip graph, route and map update. No task or checkbox appears anywhere. Editing a place's days makes zero model calls
(confirmed in logs). Every AI change can be undone from Changes.

### Slice 2: job search (separate spec and plan)

New kinds (`company`, `opportunity`, `person`, `interview`, `document`), the `pipeline` and
`timeline` primitives, `web.search`, and the `ExternalEvent` input with Jev deciding whether to
surface it. **Test of the abstraction:** slice 2 adds kinds, primitives, a template and
capabilities, but **no new tables and no new screens**. If it needs either, revisit this design.

## Answers to the brief's technical questions (§23)

1. **Task-centrism:** nearly total. See A.
2. **Goal model → Intent:** no existing goal model to evolve (today's "intent" is a command
   label). New model.
3. **Reusable UI:** the tab bar pieces, the header, list states, the undo toast and the theme.
   The item cards and sheets are too tied to items to reuse.
4–5. **Schema and JSONB:** section C.
6. **Object validation:** Zod schemas per kind in `@nexui/types`, checked in the API before the RPC.
7. **Evolving kinds:** `kind_version` plus `upgrade` functions, and `thing` as the fallback.
8. **Persisting layouts:** a versioned `workspaces.doc`, changed through changeset ops.
9. **Config → components:** the exhaustive `SECTION_REGISTRY` plus `KIND_REGISTRY` card specs.
10. **Optimistic updates:** the client applies ops to its cached snapshot, the server echoes the
    committed changeset (including derived ops), and on error the client rolls back to the
    pre-change snapshot.
11. **Realtime:** only where the server writes without the client asking: run output (the
    environment filling in) and, in slice 2, external changes. Direct edits use the response
    instead.
12. **Safe AI mutation:** only through capabilities → validated ops → the RPC under RLS.
13. **Audit and reversal:** `events.ops` before and after values, and Undo via inverse
    changesets.
14. **Approval:** anything that leaves Nexui (`policy: 'approval'`).
15. **Jev in the pipeline:** perception step F routes templates, asks and material changes.
16. **Gateway routing:** two env-mapped tiers with Gateway fallbacks; the mock provider for
    development and tests.
17. **Long operations:** `runs` rows with progress, streamed by Realtime.
18. **Partial rollback:** each committed step stays; Undo on a run reverts all of its steps.
19. **Cross-intent:** typed relationship endpoints with no FK tying them to one intent.
20. **Smallest proof:** slice 1 as specified. Six tables, one RPC, seven primitives, about 13
    capabilities.
