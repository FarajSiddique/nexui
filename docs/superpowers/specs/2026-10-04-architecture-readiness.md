# Architecture readiness for use case #2 and beyond

**Status:** a review of `main` at `e628121` on 2026-10-04, written to feed the job search plan.
The PR 1 items (3.1, 3.2, 3.3 types, 3.4 API, 3.7, 3.8, 3.11 and 3.12 types) are built by
[the template registries plan](../plans/2026-10-04-template-registries.md), with these
differences: a template is a domain, `lib/travel/`, not `lib/templates/travel/` (Decision 2);
the stager and `invokeCapability` live in `lib/staging` (3); the generic capabilities keep
travel's examples through `CapabilityScope.examples` (5); decision options are a
`DecisionOptions` argument to `decisionCapabilities`, not `TemplateDefinition.decisions` (6); a
template declares `context` keys, not a `contextSchema` (7); `emptySummary` and `lookups` wait
until something uses them (8); figures come from `TemplateDefinition.figures`, not from
`derive`'s return value (9); and fixtures stay in one flat folder (12).
**Companion to:** `2026-10-04-job-search-design.md`. Its section 10 says which of the five build
PRs picks up each item here; this doc holds the reasoning and the file-level detail, so the plan
can cite it without repeating it.
**Scope:** the API, the shared contracts and the mobile app, judged by one question: what does it
take to add a third use case (say home buying) after job search?

## 1. Verdict

The core model is use-case-agnostic and holds up. One graph (objects, relationships, append-only
events, workspace docs) with no per-kind tables; a Zod kind registry; declarative workspace docs
drawn through a typed section registry; capabilities as pure `input → ops` functions; derived ops
riding in the changeset that caused them, so Undo reverts both; a leased run queue. No table, RLS
rule or database function changes for a new use case. That is the hard part, and it is done.

The debt is one level up. **"Travel is the only template" is hard-coded at thirteen seams in the
API that should dispatch on the template**, and the mobile app reads trip kinds in about ten
places outside the section primitives. Job search can ship by adding
`if (template === 'job_search')` beside each `=== 'travel'`. If it does, use case #3 is a slog
and #4 is a rewrite.

So the rule for the build: **trip-only seams are replaced by registries, never branched.** The
measure is section 5: adding use case #3 touches one folder in each workspace and one registry
line each.

## 2. What holds up (keep as is)

- `objects.kind` is pattern-checked in the database and validated in code by `KIND_REGISTRY`
  (`packages/types/src/kinds/registry.ts`), with a version and an `upgrade` hook per kind.
- `KIND_CARDS` and `SECTION_REGISTRY` are typed `Record<KindName, …>` and
  `{ [T in Section['type']]: … }`: a new kind or section type that forgets an entry fails
  typecheck. Every new per-kind table below copies that trick.
- `prepareChangeset` (`apps/api/src/lib/graph/prepare.ts`): validate, stage, derive, coalesce,
  validate again. Pure, so tests see exactly what reaches the database.
- Capabilities are pure and the stager replays them over a newer snapshot (`stage.ts`
  `restage`), which is why lookups must stay out of capabilities (job search spec, section 5.5).
- Runs commit one changeset per model step, so Undo reverts a step; the lease, the cutoff and
  the cron sweep are template-free.
- Mobile: server state in TanStack Query, UI state in Zustand, one Broadcast channel per intent,
  optimistic edits confined to `useWorkspaceEdit`.

## 3. Findings and dispositions

Each item: where the coupling is, what to do, and which job search PR takes it (section 10 of
that spec: (1) routing and saved requests, (2) job search core API, (3) mobile, (4) background
work, legwork and eval, (5) forwarding). "Later" means after the beta.

### 3.1 No template registry (PR 1)

Travel is literal at these seams:

| Where                                                      | Today                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/api/src/lib/templates/derive.ts`                     | `if (template !== 'travel') return []`                                             |
| `apps/api/src/lib/graph/commit.ts` `createIntent`          | typed `'travel' \| null`, seed picked by a ternary, `NOT_A_TRIP_SUMMARY`           |
| `apps/api/src/lib/orchestrator/orchestrate.ts`             | `'travel'` twice in `startIntent`                                                  |
| `apps/api/src/lib/perception/perceive.ts`                  | `TemplateChoice`, the criteria prose, and the `'travel'` fallback                  |
| `apps/api/src/lib/runs/execute.ts`                         | every run gets all of `CAPABILITIES`; `ROUTES` budgets are per route, not template |
| `apps/api/src/lib/capabilities/registry.ts`                | one flat list                                                                      |
| `apps/api/src/lib/capabilities/refs.ts`                    | the anchor ref is `'trip'`                                                         |
| `apps/api/src/lib/cognition/prompts.ts`                    | `BASE` is "Nexui's trip planner"; `renderGraph` looks up `'trip'`                  |
| `apps/api/src/lib/capabilities/stage.ts` `requireAnchor`   | "Nexui can only change trips so far."                                              |
| `apps/api/src/lib/capabilities/types.ts`                   | `anchorId` is documented as "the trip"                                             |
| `packages/types/src/runs.ts` vs `graph.ts`                 | `RunInput.template` is `['travel','none']` while `templateSchema` has `job_search` |
| `apps/api/src/lib/ai/fixtures/`, `scripts/eval-travel.mjs` | travel-named, not per template                                                     |
| `apps/api/src/lib/templates/index.ts`                      | exports `seedTravelOps` by name                                                    |

**Do:** one interface and one map in `apps/api/src/lib/templates/`, which the job search spec
(section 5.5) already asks for. Spell out every field so nothing stays hard-coded:

```ts
interface TemplateDefinition {
  name: Template;
  anchorKind: KindName; // 'trip' | 'search'
  anchorRef: string; // what the model calls the anchor: 'trip' | 'search'
  perception: string; // the criteria sentence Jev sees in chooseTemplate
  emptySummary: string; // the summary line before the build run writes one
  contextSchema: z.ZodType; // validates update_intent.patch.context (3.7)
  seed(goal: string, newId: () => string): ChangesetOp[];
  derive(before, staged, ops, newId, now): ChangesetOp[];
  capabilities: readonly Capability[]; // generic + this template's
  lookups?: readonly LookupTool[]; // job search spec, section 5.5
  prompt: { base: string; tasks: Record<RunKind | RunRoute, string> };
  routes?: Partial<Record<RunRoute, { tier: ModelTier; mode: ModelMode; maxSteps: number }>>;
}

export const TEMPLATES: Record<Template, TemplateDefinition>;
```

`derive.ts`, `commit.ts`, `orchestrate.ts`, `execute.ts`, `prompts.ts`, `refs.ts` and
`perceive.ts` read from it. `chooseTemplate`'s criteria are assembled from
`TEMPLATES[*].perception` plus the `unsupported` line, so a new template teaches routing by
existing. `RunInput.template` becomes `templateSchema`. Fixtures move to
`lib/ai/fixtures/<template>/`.

### 3.2 The generic `object.*` capabilities are travel capabilities (PR 1)

`apps/api/src/lib/capabilities/graph.ts` hard-codes `CREATABLE = ['place','leg','stay','thing']`,
`isEditable = kind === 'trip' || …`, `LINK_TYPES`, a six-line `DATA_HELP` describing place, leg
and stay fields, the `leg` from/to rule, route positions for `place`, and `dependents()` (a
place's legs and stays go with it). `helpers.ts` is `tripPlaces`, `requirePlace` and
`nextPosition`. `workspace.ts` enumerates the same kinds.

The job search spec's "whitelists become per template" moves the ladder; it doesn't remove it.

**Do:** put the behaviour on the kind, next to its schema, and let `object.*` read it:

```ts
// apps/api/src/lib/kinds/behaviour.ts
export const KIND_BEHAVIOUR: Record<
  KindName,
  {
    creatable: boolean; // object.create may make one
    editable: boolean; // object.update may change one
    positioned: boolean; // joins an ordered list (route, pipeline stage order)
    links: { type: string; to: KindName; required?: boolean }[]; // leg_from, leg_to, at, for
    dependents?(graph: GraphSnapshot, object: GraphObject): GraphObject[]; // cascade on delete
    modelHelp: string; // this kind's line of DATA_HELP
  }
>;
```

`object.create`'s description, `DATA_HELP` and `relationship.create`'s link enum are assembled
from the template's kinds. `thing` stays the only escape hatch. Job search then declares
`company`/`opportunity`/`document` behaviour and writes no graph code.

### 3.3 Derived keys and figures are a trip enum in shared types (PR 1 types, PR 3 mobile)

`packages/types/src/workspace.ts` has `derivedKeySchema = z.enum(['trip.totalDays', …])`.
Mobile `features/workspace/workspace-layout.ts` calls `tripFigures` unconditionally and
`derivedValue` is a `switch` on those three keys. Every template would add to a central enum, a
mobile switch and a server derive.

**Do:** the key is a pattern, `/^[a-z]+\.[a-zA-Z]+$/`, read as `anchor.data.derived[key after
the dot]`. Client-side recomputation stays (it is what makes the day stepper instant), through a
registry keyed by anchor kind in `packages/types/src/kinds/`:

```ts
export const KIND_FIGURES: Record<AnchorKind, (snapshot, anchorId) => Record<string, Figure>>;
```

`tripFigures` becomes `KIND_FIGURES.trip`; `metric` and `allocation` read figures by key.

### 3.4 Change labels are rebuilt on the client from kind knowledge (PR 1 API, PR 3 mobile)

Every capability already returns a `label` ("Set Kyoto to 3 days", "Asked …") and runs keep it
in progress, but changesets drop it. `features/changes/change-feed.ts` then reverse-engineers the
sentence from raw ops: it knows `place`, `days`, `trip`, "reordered the route", and its `FIGURES`
table is the trip's derived keys.

**Do:** `commitChangeset` writes the label into `events.payload.label` (user changesets from
`capabilities/route.ts` and runs both have one; `changesets/route.ts` gets a generic one), and
`derive` returns the figure diffs it made as `payload.figures: { label, before, after }[]`. The
feed shows them and stops reading kinds. This one change removes the largest block of trip
knowledge on mobile.

### 3.5 Mobile reads trip kinds outside the primitives (PR 3)

- `app/(app)/(tabs)/(home)/intent/[id].tsx` `anchorMeta`: `kind === 'trip' ? tripMeta(…)`.
- `features/workspace/workspace-actions.ts`: `WorkspaceAction` is `setDays` and `move` (trip
  actions) beside the generic ones; `capabilityFor` names `trip.*`.
- `lib/format.ts`: `tripMeta`, `placeName` (`allocation-section` falls back to it).
- `features/workspace/sections/decision-section.tsx` reads `PlaceData.estDailyCost` from an
  option's place.
- `features/workspace/stop-details.ts`, `features/place/`, `app/(app)/place.tsx`,
  `data/place-media.ts`, `features/home/photo-band.ts`: stops.

The job search spec already turns `/place` into `/object` with a `DETAIL_REGISTRY` (section 6)
and adds `searchMeta` beside `tripMeta` and `stripStyle` on the summary. Finish the pattern:

1. **Capability-shaped actions.** `WorkspaceAction` becomes `ask`, `open` and
   `{ type: 'capability', request, optimistic: ChangesetOp[] }`. The primitive that knows it
   calls `trip.setPlaceDays` builds the request and its optimistic ops; `workspace-actions.ts`
   never changes for a new template. `pipeline`'s card actions are the same shape.
2. **Per-anchor-kind registries,** typed `Record<AnchorKind, …>` like `SECTION_REGISTRY`:
   `KIND_META` (the line under the title, replacing the `tripMeta`/`searchMeta` branch),
   `KIND_FIGURES` (3.3) and the spec's `DETAIL_REGISTRY`.
3. **Folders.** `features/workspace/` keeps the layout engine and the generic primitives
   (`metric`, `objectList`, `comparison`, `decision`, `insight`). `features/travel/` gets `map`,
   `route`, `allocation`, stop details, the place body, `tripMeta` and `placeName`.
   `features/jobs/` gets `pipeline`, `timeline` and the role, draft and search bodies. The
   import-direction lint adds: `features/workspace` never imports `features/travel` or
   `features/jobs`; only the registries do.
4. `data/place-media.ts` and `photo-band.ts` key on the summary strip's `key`, which the derive
   sets, not on `kind === 'place'`.

### 3.6 Prompt and snapshot size (PR 2, before the first kind with a text body)

A trip is about thirty small objects, which hides three costs:

- `cognition/prompts.ts` `renderGraph` puts every object's full `data` into every step's prompt.
  A job search carries `document.body` up to 20 000 characters (the resume, cover letters,
  briefs) and the search's `passReasons`; a reasoning run could send 100k+ characters of resume
  and draft text eight times.
- `loadSnapshot` returns the whole graph on every commit, every step, every Realtime nudge and
  every mobile refetch.
- `evaluateQuery` and `tripParts` scan linearly, and `deriveTrip` calls `tripParts` several
  times per changeset.

**Do:** each kind declares `promptFields` (what the model sees; a body renders as
`"<4 200 chars, read with document.read o12>"` with a read-only lookup) and `heavyFields`, which
`get_intent_snapshot` can omit for the workspace (`?fields=light`) and includes for the details
sheet. Build one index per changeset (`byId`, `byKind`, `edgesBySource`) and hand it to derive
and figures. The resume lands in PR 2, so the prompt part is PR 2; the light snapshot can wait
for the first plan that feels slow.

### 3.7 `intents.context` is unvalidated (PR 1)

`update_intent.patch.context` is any record (`packages/types/src/ops.ts`). The job search spec
keeps `nextCheckAt`, `scan` and `seen[300]` there. **Do:** `TemplateDefinition.contextSchema`,
checked in `validateOps` the way `parseKindData` checks object data, so a bad scan write can't
poison scheduling.

### 3.8 Workspace docs have no upgrade path (PR 1)

Kinds have `version` and `upgrade()`; `workspaceDocSchema.version` is `z.literal(1)` with
nothing to run on an older doc. New section types are additive, so `pipeline` and `timeline`
are safe. The first change to a section's shape would invalidate every stored doc at read time.
**Do:** `upgradeWorkspace(doc)` beside the kinds' upgrade, a no-op today, called where the
snapshot is parsed.

### 3.9 Run queue ceiling (PR 4 notes it; the worker is later)

`runs/worker.ts`: the creating request executes its own run in `after()`; the cron sweep is the
safety net at `RUN_SWEEP_LIMIT = 10` a minute, `RUN_MAX_ACTIVE = 100`, one 300-second function.
Daily scans and check-ins make the sweep the primary path: 600 runs an hour at most. Every route
that queues a run must also export `maxDuration = 300` (`intents/route.ts`), which the new
`start` and `resume` routes can forget. **Do in PR 4:** `enqueue_job_checks` spreads due times
across the hour, the readiness of the cap is written down in `docs/architecture/`, and the
route helper (3.10) sets `maxDuration` for run-queuing routes. **Later:** a worker that isn't the
API function (pg_cron and pg_net, Vercel Queues, or a long-running worker) once scans exist at
scale.

### 3.10 Route boilerplate (PR 2, opportunistic)

Eleven `route.ts` files repeat the same twenty-five lines: `corsHeaders`, `OPTIONS`,
`verifyRequest`, `readJsonBody`, `safeParse` → `jsonError`, `try`/`graphErrorResponse`. Job
search adds five. **Do:** `withUser(headers, handler)` and `parseBody(schema, message)` in
`lib/http`, thin enough that the `try` and the error mapping stay visible in each handler, which
`apps/api/AGENTS.md`'s handler order still requires.

### 3.11 Decisions carry travel (PR 1, small)

`capabilities/decisions.ts` is listed as generic, but `decision.propose` accepts a `place` and
a `leg` per option and `decision.resolve` runs `addChosenPlace` and reads
`derived.unallocatedDays`. Job search's decisions (remote or hybrid, a salary floor) have no
object per option, so this is harmless until a template wants options that carry something else.
**Do:** an option's payload moves behind `TemplateDefinition.decisions?: { optionInput,
onResolve }`, and the travel template owns the place, the leg and `addChosenPlace`.

### 3.12 Smaller items

- `packages/types/src/index.ts` exports `kinds/travel.ts` and `trip-figures.ts` (with
  `USD_PER_UNIT`) at the top level. Group per template: `kinds/travel/`, `kinds/jobs/`, and
  `kinds/registry.ts` composes. Keep the barrel. (PR 1)
- `apps/mobile/src/lib/format.ts` mixes money, day and date formatters with `tripMeta`,
  `placeName` and `cardText`. Split generic from kind formatters in the `features/travel/` move.
  (PR 3)
- `templateSchema` lists `job_search` while `createIntent` is typed `'travel' | null` and the
  database's `p_template text` is unchecked. The enum lives in `@nexui/types`; the API derives
  from it; the database stays loose. (PR 1)
- `scripts/eval-travel.mjs` and `pnpm eval:jobs` share a runner with per-template cases. (PR 4)

## 4. What not to do

- Don't add `if (template === 'job_search')` anywhere a `=== 'travel'` exists today. Replace the
  seam with a registry lookup, then add the job search entry.
- Don't give job search its own copies of `change-feed`, `stop-details` or `workspace-actions`.
- Don't build the queue worker, the light snapshot or a doc migration now. Note the ceiling, add
  the hook, move on.

## 5. The measure: adding use case #3

After PRs 1 to 3, adding home buying touches:

| Workspace        | Files                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/types` | `kinds/home/` (schemas, figures, cards, meta), one line each in `kinds/registry.ts`, `KIND_CARDS`, `KIND_FIGURES`, `KIND_META`, `templateSchema` |
| `apps/api`       | `lib/templates/home/` (seed, derive, capabilities, prompt, perception line), one line in `TEMPLATES`, `lib/kinds/behaviour.ts` entries           |
| `apps/mobile`    | `features/home-buying/` (its primitives and detail bodies), one line each in `SECTION_REGISTRY`, `DETAIL_REGISTRY`                               |
| `tests/`         | its derive, capabilities and template tests; `eval:<name>` cases                                                                                 |

Nothing in `graph/`, `runs/`, `cognition/`, `orchestrator/`, `features/workspace/`,
`features/changes/` or `data/` changes. If it does, the registry is missing a field.

## 6. Tests

- `TEMPLATES` has an entry for every `Template`, and each entry's `capabilities` only names
  kinds in `KIND_BEHAVIOUR` with `creatable` or `editable` set. Typecheck covers the shape; a
  unit test covers the cross-references.
- `prepareChangeset` refuses an `update_intent` whose `context` fails the template's schema.
- `renderGraph` never includes a `heavyFields` value.
- `commitChangeset` stores `payload.label` and `payload.figures`; the change feed renders them
  without reading `op.after.kind`.
- `chooseTemplate`'s criteria contain each template's `perception` line.
- An ESLint import-direction test: `features/workspace` does not import `features/travel`.
