# Routing and Saved Requests (Job Search PR 1, Second Half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jev routes a new goal to a template or to `unsupported`; a goal no template fits is saved instead of planned, and Home leaves it out; a goal Jev can't read gets a 503 instead of a guess; and every trip-only sentence becomes template-neutral. Trips behave as before.

**Architecture:** `chooseTemplate` offers each template's own sentence plus one template-neutral `unsupported` sentence, and throws `PerceptionFailedError` when Jev fails (the create route maps it to 503). `POST /api/intents` answers a union keyed by `outcome` (`started` or `unsupported`) with its status from a `Record` keyed by outcome, so PR 2 adds `awaiting_resume` and `existing_search` by adding members. A saved goal is an intent with `template: null`, filtered out of `listIntents`. One API constant holds the sentence for a goal Nexui can't plan, and the + sheet builds its examples and "Today Nexui plans …" sentence from a `TEMPLATE_EXAMPLES` registry in `@nexui/types`, so job search joins all three by declaration in PR 2.

**Tech Stack:** Next.js 16 route handlers, supabase-js 2 (PostgREST), Zod 4 contracts in `@nexui/types`, AI SDK 7 (`experimental_evaluate`, 7.0.122), Expo Router / React Native with TanStack Query, Node 24's test runner with type stripping.

**Spec:** `docs/superpowers/specs/2026-10-04-job-search-design.md`, section 2 ("Routing and saved requests"), with the tests section 10 lists for it. Read it, and `docs/superpowers/specs/2026-10-04-architecture-readiness.md` sections 3–6 (the no-branching rule and the "adding a template" measure). The handoff doc "Nexui handoff: after the template registries" assigns three carry-forwards to this plan; Tasks 1 and 2 take them.

**Not in this plan:**

- **Job search's own routing, `awaiting_resume` and `existing_search`** (Decision 1). PR 2 adds them by declaration: a `TemplateDefinition` in `lib/jobs/` with its `perception` sentence, `job_search` in `templateSchema` and `TEMPLATE_EXAMPLES`, and two union members with their `CREATE_STATUS` entries.
- **Job search's contracts and the run-kinds migration** (Decision 2): the contracts go to PR 2, the migration to its own PR before PR 4.
- **Notify-later and the goal-first welcome screen** (spec section 0): separate items. The welcome screen can start once this merges, and its example chips can read `TEMPLATE_EXAMPLES` (Task 5), which lists exactly the use cases that work.
- **Hiding saved goals from Changes** (Decision 7).

## Rollout

No migration: `intents.template` is already nullable and already allows `job_search`, and `create_run` is unchanged. The implementation PR merges after this plan's docs PR, like any API change.

- **The installed iOS preview build predates the union.** A trip still parses (Zod's default object schema drops the new `outcome` key), but a saved goal shows a parse error in its + sheet until the next preview build. That is acceptable before the beta; say so in the PR.
- **Job-hunting goals are saved as unsupported until PR 2 merges** (Decision 1), on dev and prod. No beta user exists yet, and today they already get "Nexui can plan trips so far."

## Global Constraints

- Node.js 24 and pnpm 10.34.5 (the shell's Node 26.8.1 also passes). Run every command from the worktree root. One test file runs with `node --experimental-strip-types --test tests/<file>.test.mjs`; all of them with `pnpm test` (545 pass at `55918aa`).
- **Copy, verbatim from spec section 2:**
  - The 503: `Nexui couldn't read that goal. Try again.`
  - Jev's `unsupported` criterion: `Anything else, such as a move, a wedding, buying a car or hiring for a team.`
  - The + sheet's reply: `Nexui can't plan this yet.` then `It's saved, and you'll hear when it can.` then `Today Nexui plans <plans>.`, built from `TEMPLATE_EXAMPLES` (trips only until PR 2; then exactly the spec's "trips and job searches").
  - From the UX canvas (artboard `Unsupported`): the label `Try one` above the examples, and the footer `No plan was created. Saved goals help decide what Nexui learns next.`
  - The sentence for a goal no template fits, wherever the API or app states it: `Nexui can't plan this yet.`
- **Statuses:** `started` 201, `unsupported` 201, the Jev failure 503. No migration.
- **Trips behave as before.** Every existing test passes, changed only where a task lists the change. `tests/model-surface.test.mjs` changes once, in Task 2, and only in `chooseTemplate.criteria` (`none` becomes `unsupported` with the new sentence): no tool description, tool schema or run instruction moves.
- **Replace seams with registries, never branch.** No `=== 'travel'`, `=== 'trip'` or `template === …` outside `apps/api/src/lib/travel/` and `packages/types/src/kinds/travel/`. Comparing a `TemplateChoice` with `'unsupported'` or a response's `outcome` is not a template branch.
- **Load order** (`tests/api-load-order.test.mjs`): `lib/kinds` imports no other domain, `lib/capabilities` only `lib/kinds`, `lib/travel` only `lib/capabilities`, `lib/templates` only those three. This plan adds a constant to `lib/templates` and no imports to that chain.
- API rules (`apps/api/AGENTS.md`): handler order (verify, read, parse, work, `schema.parse` the body); `jsonError` for failures; another domain through its barrel `#lib/<domain>`; siblings with `./file.ts`; `import type` for types; import groups Node, packages, `@nexui/*`, `#lib/*`, relative; explicit return types on exported functions; `console.error('[tag]', message)` only, never a goal, a body or a provider error.
- Mobile rules (`docs/architecture/mobile.md`): routes in `app/` only; components and helpers in `features/<area>/`; import another folder through its barrel (`#features/compose`, `#ui`); a barrel holds only re-exports, without file extensions; no `../` out of a folder.
- Style: strict TypeScript with `noUncheckedIndexedAccess`; braces on every `if`, `else` and loop; a blank line before `return`, after blocks and after declaration groups; no nested ternaries; kebab-case filenames. `.claude/hooks/format.sh` runs Prettier and ESLint after each edit; run `pnpm fix` before each commit anyway.
- Each task ends with `pnpm lint`, `pnpm typecheck` and `pnpm test` passing, then one commit. Commit messages: a concise imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm format:check` also reads the git-ignored `.superpowers/sdd/` notes that subagent-driven development writes; run `pnpm exec prettier --write .superpowers` before checking.
- **Ask before anything outward-facing.** No `pnpm db:push:*` (there is no migration anyway). Pushing the branch and opening a draft PR are covered by the session's instructions; never push to `main`, force-push or merge.

## Decisions this plan makes (flagged for review)

1. **`job_search` routes in PR 2, by declaration.** `templateSchema` is `['travel']` and `TEMPLATES` is `Record<Template, TemplateDefinition>`, so `job_search` can't be a routing answer until it has a definition, and a stub would drag PR 2 forward. This plan ships `travel` / `unsupported` with the union's `started` and `unsupported`. Because `TemplateChoice` is `Template | 'unsupported'`, the `CREATE_STATUS` map is keyed by outcome, and the + sheet reads `TEMPLATE_EXAMPLES`, PR 2's declaration makes Jev offer `job_search` and the + sheet name it, with no edit here. The cost: until PR 2 merges, a job-hunting goal is saved as unsupported.
2. **Neither "Contracts" nor "The migration" (the spec's week-1 row) rides with routing.**
   - Job search's contracts (section 3: the kinds, `pipeline` and `timeline` sections, `InsightAction`'s `upload` and `copy`, `stripStyle`) go in PR 2, whose seed writes them. PR 3 draws them.
   - The run-kinds migration (section 5.1, `checkin`, `scan` and `external`) is first needed by PR 4. Following the repo rule that a migration ships alone and first, it becomes its own migration-only PR, opened in week 2 or 3 so it is on dev and prod before PR 4. PR 2 needs no migration: the kit run is an `ask`, and `create_run` checks only `text` and `route`, not extra keys such as `task`.
3. **The SDK already refuses a choice Jev wasn't offered.** With `ai` 7.0.122, `experimental_evaluate` throws `InvalidResponseDataError` ("selected an unknown option") for an answer outside the criteria, including `toString`. So the carry-forward "check Jev's answer at runtime, with the 503" becomes: every failure inside `chooseTemplate` throws `PerceptionFailedError`, and a test pins that a stale `none`, an early `job_search` and `toString` all end there. There is no second check in our code; if an SDK upgrade drops its check, that test fails.
4. **`chooseTemplate` returns the choice, not a `Perceived`.** With no fallback, `source` would always be `model`. A create run records `perception: 'model'`. `routeAsk` keeps its `reasoning` fallback, since the spec changes only goals.
5. **One sentence for a goal no template fits, `Nexui can't plan this yet.`** It is exported from `#lib/templates` as `UNSUPPORTED_GOAL`. It serves as the saved goal's summary line (`createIntent`), the refusal to ask about it (`startAsk`), and the refusal to stage on it (`templateOf` and `requireAnchor` in `stage.ts`). That retires all three "can only change trips" copies and `NOT_A_TRIP_SUMMARY` (carry-forward 3). The plan screen's fallback says the same.
6. **The + sheet's examples come from `TEMPLATE_EXAMPLES`** (`Record<Template, { plans, goal }>` in `@nexui/types`): the placeholder, the "Today Nexui plans …" sentence and the "Try one" buttons. Until PR 2 they say only trips, so the sheet never offers a job search chip that would be saved as unsupported again. A missing entry fails typecheck, like `KIND_CARDS`. It costs use case #3 one more registry line in `packages/types`.
7. **Changes still says "Nexui started '<goal>'" for a saved goal.**
   - `create_intent` logs one `system` event per intent, and `changes_page` lists every event. Hiding them takes a one-line `changes_page` filter, a migration that would have to ship alone first, so this plan leaves it, as for today's `none` goals. Change rows don't link to plans, so nothing opens from there.
   - If you want it hidden, it can be a migration-only PR beside the run-kinds one.
8. **Tapping a "Try one" example fills the composer; it doesn't send.** The user can adjust "A week in Lisbon in May" before starting a real plan. The canvas doesn't say which.
9. **A saved goal answers `{ "outcome": "unsupported" }` with no intent id,** as the spec's `{}`. `scripts/eval-travel.mjs` can't tag such an intent, so `--clean` won't remove a trip prompt Jev misroutes; that row has no template and stays off Home.
10. **A hand-written mock fixture, `saved-goal`** (matches "wedding", answers `unsupported`, no steps), so mock mode, the route test, the smoke script and the Expo smoke test can reach a saved goal. Mock mode still answers `travel` when no fixture matches.
11. **`RunFixture.perception.template` is typed `TemplateChoice`** (carry-forward 2), imported as a type from `#lib/perception`.

## Review Focus

1. **Jev times out or the Gateway is down while a goal is created.** Expected: a 503 with `Nexui couldn't read that goal. Try again.`, no intent row, no run, one `[perception]` log line without the goal; the + sheet keeps the typed text and shows the message. Pinned by Task 2's slow-Jev and route tests (no database call) and Task 6's live-with-a-bad-key smoke step.
2. **Jev answers something it wasn't offered** (a stale `none`, `job_search` before PR 2 declares it). Expected: the same 503. Pinned by Task 2's unoffered-answer test.
3. **A saved goal reached anyway**: `/intent/<id>` by deep link, `POST /api/intents/<id>/ask`, a capability call. Expected: the plan screen's empty state saying `Nexui can't plan this yet.`, a 400 with that sentence for an ask, and a 400 "That action isn't available." for a capability; never a 500 or trip copy. Pinned by Task 1's orchestrator and staging tests.
4. **A user whose only goals are saved ones.** Expected: Home's empty state, not cards for goals it can't open. Pinned by Task 4's query test and smoke-script check.
5. **Sending again after the saved-goal reply** (a typed goal or a "Try one" example). Expected: a new plan starts; it is never an ask on the saved goal, and no "Open plan" button appears for the saved goal. `compose.tsx` has no unit tests; pinned by Task 6's Expo smoke steps.

## File Structure

| Path                                                                                | Change                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/src/lib/templates/{registry,index}.ts`                                    | `UNSUPPORTED_GOAL` (Task 1)                                            |
| `apps/api/src/lib/graph/commit.ts`, `apps/api/src/lib/staging/stage.ts`             | Use it (Task 1)                                                        |
| `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`                           | The no-workspace fallback (Task 1)                                     |
| `apps/api/src/lib/perception/{perceive,index}.ts`                                   | `unsupported`, `PerceptionFailedError` (Task 2)                        |
| `apps/api/src/lib/ai/fixtures/{types,index,saved-goal}.ts`                          | `TemplateChoice` (Task 2); new `saved-goal` fixture (Task 3)           |
| `apps/api/src/lib/orchestrator/orchestrate.ts`                                      | Refusal (1), the plain choice (2), the union (3)                       |
| `apps/api/src/app/api/intents/route.ts`                                             | The 503 (Task 2); status by outcome (Task 3)                           |
| `packages/types/src/api.ts`                                                         | `createIntentResponseSchema` becomes the union (Task 3)                |
| `apps/mobile/src/data/{queries,api}.ts`, `apps/mobile/src/app/(app)/compose.tsx`    | Read the union (Task 3); the saved-goal reply and placeholder (Task 5) |
| `scripts/{eval-travel,try-run,smoke-intent-graph}.mjs`                              | Read the union (Task 3); a saved goal stays off Home (Task 4)          |
| `apps/api/src/lib/graph/lists.ts`                                                   | Home lists only intents with a template (Task 4)                       |
| `packages/types/src/templates.ts`, `packages/types/src/index.ts`                    | New: `TEMPLATE_EXAMPLES` (Task 5)                                      |
| `apps/mobile/src/features/compose/{goal-examples.ts,saved-goal-reply.tsx,index.ts}` | New: examples, the reply card (Task 5)                                 |
| `tests/support/travel-model-surface.json`                                           | Regenerated: the routing question only (Task 2)                        |
| `docs/architecture/{intent-graph,mobile}.md`                                        | Through `docs-keeper` (Task 6)                                         |

New tests: `tests/mobile-goal-examples.test.mjs`. Changed tests: `perception`, `ai-session`, `orchestrator`, `capabilities-graph`, `intents-route`, `run-contracts`, `intent-graph-migration`, `shared-contracts`.

## Before Task 1: pre-flight

Line numbers in this plan are from `main` at `55918aa` and move as tasks land. Find every edit by the code the step quotes, never by line number.

```bash
git log --oneline -1           # 55918aa or a later main
pnpm install --frozen-lockfile
pnpm test                      # 545 pass
grep -rn "trips so far" apps packages tests --include='*.ts' --include='*.tsx' --include='*.mjs'
```

The grep should list `commit.ts`, `stage.ts` (twice), `orchestrate.ts`, `compose.tsx`, `intent/[id].tsx` and three tests. If anything else appears, tell the controller before starting.

---

### Task 1: One sentence for a goal Nexui can't plan

Carry-forward 3. Every "Nexui can plan trips so far." and "Nexui can only change trips so far." in the API, and the plan screen's fallback, becomes `Nexui can't plan this yet.`, from one constant. The + sheet's note waits for Task 5, which replaces it.

**Files:**

- Modify: `apps/api/src/lib/templates/registry.ts`, `apps/api/src/lib/templates/index.ts`
- Modify: `apps/api/src/lib/graph/commit.ts` (`NOT_A_TRIP_SUMMARY`, `createIntent`)
- Modify: `apps/api/src/lib/staging/stage.ts` (`requireAnchor`, `templateOf`)
- Modify: `apps/api/src/lib/orchestrator/orchestrate.ts` (`startAsk`)
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`
- Test: `tests/orchestrator.test.mjs`, `tests/capabilities-graph.test.mjs`

**Interfaces:**

- Produces: `UNSUPPORTED_GOAL: string`, exactly `Nexui can't plan this yet.`, exported from `#lib/templates`.

- [ ] **Step 1: Change the tests to expect the new sentence**

In `tests/orchestrator.test.mjs`, test "a goal that is not a trip gets a plain intent and no run", replace

```js
assert.equal(started.snapshot.intent.summary.line, 'Nexui can plan trips so far.');
```

with

```js
assert.equal(started.snapshot.intent.summary.line, "Nexui can't plan this yet.");
```

and in the test "an ask on an intent without a workspace is refused", replace `error.message === 'Nexui can only change trips so far.',` with `error.message === "Nexui can't plan this yet.",`.

In `tests/capabilities-graph.test.mjs`, test "an intent without a workspace has nothing to stage", replace `refused(/^Nexui can only change trips so far\.$/),` with `refused(/^Nexui can't plan this yet\.$/),`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/orchestrator.test.mjs tests/capabilities-graph.test.mjs`
Expected: FAIL, 3 tests, each still seeing the trip sentence.

- [ ] **Step 3: Add the constant**

In `apps/api/src/lib/templates/registry.ts`, after `templateFor`:

```ts
/**
 * What Nexui says about a goal no template fits: the saved goal's summary line, and the refusal
 * to ask about it or change it (job search spec, section 2).
 */
export const UNSUPPORTED_GOAL = "Nexui can't plan this yet.";
```

In `apps/api/src/lib/templates/index.ts`, change the registry line to:

```ts
export { TEMPLATES, templateFor, UNSUPPORTED_GOAL } from './registry.ts';
```

- [ ] **Step 4: Use it in the API**

`apps/api/src/lib/graph/commit.ts`: change the import to `import { templateFor, UNSUPPORTED_GOAL } from '#lib/templates';`, delete `const NOT_A_TRIP_SUMMARY = 'Nexui can plan trips so far.';` and the blank line after it, and in `createIntent` replace `patch: { summary: { line: NOT_A_TRIP_SUMMARY } }` with `patch: { summary: { line: UNSUPPORTED_GOAL } }`. In its doc comment, replace `one without (Jev said no template fits) gets only a summary line.` with `one without (a goal Nexui can't plan yet) gets only that summary line.`

`apps/api/src/lib/staging/stage.ts`: change the import to `import { templateFor, UNSUPPORTED_GOAL, type TemplateDefinition } from '#lib/templates';`, and in both `requireAnchor` and `templateOf` replace `throw new CapabilityError('Nexui can only change trips so far.');` with `throw new CapabilityError(UNSUPPORTED_GOAL);`.

`apps/api/src/lib/orchestrator/orchestrate.ts`: add `import { UNSUPPORTED_GOAL } from '#lib/templates';` after the `#lib/runs` import, and in `startAsk` replace `throw new ChangesetInvalidError('Nexui can only change trips so far.');` with `throw new ChangesetInvalidError(UNSUPPORTED_GOAL);`.

All three use the constant inside functions only, so the barrels' load order is unaffected.

- [ ] **Step 5: The plan screen's fallback**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, replace

```tsx
<ListEmpty text={data.intent.summary.line || 'Nexui can plan trips so far.'} />
```

with

```tsx
<ListEmpty text={data.intent.summary.line || "Nexui can't plan this yet."} />
```

- [ ] **Step 6: Run the tests and the sweep**

Run: `node --experimental-strip-types --test tests/orchestrator.test.mjs tests/capabilities-graph.test.mjs tests/api-load-order.test.mjs`
Expected: PASS.

Run: `grep -rn "trips so far" apps packages --include='*.ts' --include='*.tsx'`
Expected: only `apps/mobile/src/app/(app)/compose.tsx` (Task 5 replaces it).

- [ ] **Step 7: Commit**

```bash
pnpm fix && pnpm lint && pnpm typecheck && pnpm test
git add apps/api/src/lib/templates apps/api/src/lib/graph/commit.ts apps/api/src/lib/staging/stage.ts apps/api/src/lib/orchestrator/orchestrate.ts "apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx" tests/orchestrator.test.mjs tests/capabilities-graph.test.mjs
git commit -m "Say one template-neutral sentence for a goal Nexui can't plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Jev picks a template or `unsupported`, and a goal it can't read is a 503

Spec section 2, "Perception" and "If Jev fails, Nexui doesn't guess", with carry-forwards 1 and 2. The routing question's last choice becomes `unsupported`, with a sentence that names no template. A Jev failure, a timeout or an answer it wasn't offered throws `PerceptionFailedError` before anything is written, and the create route answers 503. The response shape doesn't change until Task 3.

**Files:**

- Modify: `apps/api/src/lib/perception/perceive.ts`, `apps/api/src/lib/perception/index.ts`
- Modify: `apps/api/src/lib/ai/fixtures/types.ts`
- Modify: `apps/api/src/lib/orchestrator/orchestrate.ts` (`startIntent`)
- Modify: `apps/api/src/app/api/intents/route.ts` (`POST`)
- Regenerate: `tests/support/travel-model-surface.json`
- Test: `tests/perception.test.mjs`, `tests/ai-session.test.mjs`, `tests/orchestrator.test.mjs`, `tests/intents-route.test.mjs`

**Interfaces:**

- Consumes: `TEMPLATES` from `#lib/templates`.
- Produces, from `#lib/perception`:
  - `type TemplateChoice = Template | 'unsupported'`;
  - `chooseTemplate(model: Experimental_EvaluationModel, goal: string, options?: PerceptionOptions): Promise<TemplateChoice>`, which throws `PerceptionFailedError` on any failure;
  - `class PerceptionFailedError extends Error`, thrown with the message `Nexui couldn't read that goal. Try again.`
- Produces: `RunFixture.perception.template?: TemplateChoice`.

- [ ] **Step 1: Rewrite the perception tests**

In `tests/perception.test.mjs`, change the import to

```js
import {
  chooseTemplate,
  PerceptionFailedError,
  routeAsk,
} from '../apps/api/src/lib/perception/perceive.ts';
```

add after the `answering` helper:

```js
const unread = (error) =>
  error instanceof PerceptionFailedError &&
  error.message === "Nexui couldn't read that goal. Try again.";
```

and replace the test "Jev picks the template from the goal alone" with:

```js
test('Jev picks the template from the goal alone', async () => {
  const seen = [];
  const model = answering({ template: { type: 'choice', choice: 'unsupported' } }, seen);
  const providerOptions = { gateway: { models: ['anthropic/claude-haiku-4.5'] } };

  assert.equal(
    await chooseTemplate(model, 'Plan my wedding next June', { providerOptions }),
    'unsupported',
  );
  assert.deepEqual(seen[0].state, { goal: 'Plan my wedding next June' });
  assert.deepEqual(Object.keys(seen[0].questions.template.criteria), ['travel', 'unsupported']);
  assert.deepEqual(seen[0].providerOptions, providerOptions);
});
```

Replace the test "when Jev fails, a goal is a trip and an ask gets the reasoning tier" with:

```js
test('when Jev fails, a goal is not guessed and an ask gets the reasoning tier', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  await assert.rejects(chooseTemplate(failingEvaluationModel(), 'Plan Japan'), unread);
  assert.deepEqual(
    await routeAsk(failingEvaluationModel(), { text: 'Hi there', goal: 'Plan Japan', summary: '' }),
    { value: 'reasoning', source: 'fallback' },
  );
  assert.equal(logged.mock.callCount(), 2);
  assert.deepEqual(logged.mock.calls[0].arguments, ['[perception]', 'Template routing failed.']);
});
```

In the test "a slow Jev is abandoned after the timeout", replace the `assert.deepEqual(await chooseTemplate(slow, 'Plan Japan', { timeoutMs: 20 }), { value: 'travel', source: 'fallback' });` statement with:

```js
await assert.rejects(chooseTemplate(slow, 'Plan Japan', { timeoutMs: 20 }), unread);
```

Replace the last test, "Jev reads each template's own sentence, then the one for no template", with:

```js
test("Jev reads each template's own sentence, then one for goals none fits", async () => {
  const seen = [];

  await chooseTemplate(
    answering({ template: { type: 'choice', choice: 'travel' } }, seen),
    'Plan Japan',
  );

  const { criteria } = seen[0].questions.template;

  assert.deepEqual(Object.keys(criteria), [...Object.keys(TEMPLATES), 'unsupported']);

  for (const template of Object.values(TEMPLATES)) {
    assert.equal(criteria[template.name], template.perception);
  }

  assert.equal(
    criteria.unsupported,
    'Anything else, such as a move, a wedding, buying a car or hiring for a team.',
  );
  // It names no template, so a new template never has to edit it.
  assert.doesNotMatch(criteria.unsupported, /trip|travel|job/i);
});
```

and add:

```js
test('an answer Jev was not offered is refused like a failure', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  // A stale fixture's `none`, `job_search` before its template exists, a prototype key.
  for (const choice of ['none', 'job_search', 'toString']) {
    await assert.rejects(
      chooseTemplate(answering({ template: { type: 'choice', choice } }), 'Find a new job'),
      unread,
      choice,
    );
  }

  assert.equal(logged.mock.callCount(), 3);
});
```

In `tests/ai-session.test.mjs`, change the `fixture`'s `perception: { template: 'none', route: 'edit' },` to `perception: { template: 'unsupported', route: 'edit' },`. In "a mock session answers Jev from its fixture…", replace

```js
assert.deepEqual(await chooseTemplate(session.evaluationModel, 'Find a new job'), {
  value: 'none',
  source: 'model',
});
```

with `assert.equal(await chooseTemplate(session.evaluationModel, 'Find a new job'), 'unsupported');`. In "without a fixture, mock perception says travel and reasoning…", replace `assert.equal((await chooseTemplate(session.evaluationModel, 'x')).value, 'travel');` with `assert.equal(await chooseTemplate(session.evaluationModel, 'x'), 'travel');`.

- [ ] **Step 2: Rewrite the orchestrator's routing tests**

In `tests/orchestrator.test.mjs`, add `import { PerceptionFailedError } from '../apps/api/src/lib/perception/perceive.ts';` after the `orchestrate.ts` import. Replace `jobFixture` with

```js
const savedFixture = {
  name: 'test-saved',
  kind: 'create_intent',
  match: ['wedding'],
  perception: { template: 'unsupported' },
  steps: [],
};
```

and `const fixtures = [tripFixture, jobFixture, askFixture];` with `const fixtures = [tripFixture, savedFixture, askFixture];`. In the test "a goal that is not a trip gets a plain intent and no run", rename it to "a goal no template fits gets a plain intent and no run" and replace `startIntent(deps, 'Find a new job')` with `startIntent(deps, 'Plan my wedding next June')`. Replace the test "when Jev is down, the goal is treated as a trip" with:

```js
test('when Jev is down, nothing is created and the goal is not guessed', async (t) => {
  t.mock.method(console, 'error', () => {});

  const { fake, tasks, deps } = setup(t);
  const openMock = deps.openSession;

  deps.openSession = (kind, text) => ({
    ...openMock(kind, text),
    evaluationModel: failingEvaluationModel(),
  });

  await assert.rejects(startIntent(deps, 'Plan Japan in December'), PerceptionFailedError);
  assert.equal(fake.state.created, null);
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
});
```

- [ ] **Step 3: Add the route's 503 test**

In `tests/intents-route.test.mjs`, add after the `url` constant:

```js
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
```

In "a misconfigured AI provider is a safe 500 that names the variable in the log", replace the `previous` constant, the two env lines and the whole `t.after(…)` block with `useEnv(t, { AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: undefined });`. Then add after the test "a goal must be 3 to 500 characters":

```js
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
    ([input]) => new URL(input instanceof Request ? input.url : String(input)).hostname,
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
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --experimental-strip-types --test tests/perception.test.mjs tests/ai-session.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs`
Expected: FAIL. `PerceptionFailedError` is not exported, the criteria still end with `none`, and the route answers 201 (the fallback treats the goal as a trip).

- [ ] **Step 5: Route to a template or `unsupported`, and throw when Jev can't**

In `apps/api/src/lib/perception/perceive.ts`, replace everything from `/** A template, or \`none\` for a goal no template fits. */`down to the end of`chooseTemplate` with:

```ts
/** A template, or `unsupported` for a goal no template fits: saved, but not planned. */
export type TemplateChoice = Template | 'unsupported';

/** An ask's route, and whether Jev gave it or the fallback did. */
export interface Perceived<T> {
  value: T;
  source: 'model' | 'fallback';
}

export interface PerceptionOptions {
  providerOptions?: GatewayOptions;
  timeoutMs?: number;
}

/** Perception runs before the response is sent, so it gets a short budget. */
export const PERCEPTION_TIMEOUT_MS = 5_000;

/** Jev couldn't say which template fits a goal. `message` is safe to show the user. */
export class PerceptionFailedError extends Error {}

// The last choice. It names no template, so a new template never has to edit it.
const UNSUPPORTED = 'Anything else, such as a move, a wedding, buying a car or hiring for a team.';

// Each template's own sentence, then `unsupported`: a new template teaches routing by existing.
function templateCriteria(): Record<TemplateChoice, string> {
  const criteria = {} as Record<TemplateChoice, string>;

  for (const template of Object.values(TEMPLATES)) {
    criteria[template.name] = template.perception;
  }

  criteria.unsupported = UNSUPPORTED;

  return criteria;
}

/**
 * Jev's template question for a new goal (spec section F): each template's `perception`
 * sentence, then `unsupported`. Nexui doesn't guess (job search spec, section 2): if Jev fails,
 * runs out of time or picks a choice it wasn't offered (the AI SDK refuses that answer), this
 * throws `PerceptionFailedError` and the caller creates nothing.
 *
 * @example
 * await chooseTemplate(session.evaluationModel, 'Plan my wedding next June'); // 'unsupported'
 */
export async function chooseTemplate(
  model: Experimental_EvaluationModel,
  goal: string,
  options: PerceptionOptions = {},
): Promise<TemplateChoice> {
  try {
    const result = await experimental_evaluate({
      model,
      state: { goal },
      questions: {
        template: {
          type: 'choice',
          instructions: 'Someone typed this goal to start a plan. Which template fits it?',
          criteria: templateCriteria(),
        },
      },
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? PERCEPTION_TIMEOUT_MS),
      maxRetries: 1,
      providerOptions: options.providerOptions,
    });

    return result.answers.template.choice;
  } catch {
    console.error('[perception]', 'Template routing failed.');

    throw new PerceptionFailedError("Nexui couldn't read that goal. Try again.");
  }
}
```

`routeAsk` and `AskContext` below it stay as they are. In `apps/api/src/lib/perception/index.ts`, change the first line to:

```ts
export { chooseTemplate, PerceptionFailedError, routeAsk } from './perceive.ts';
```

- [ ] **Step 6: Type fixtures by the choice**

In `apps/api/src/lib/ai/fixtures/types.ts`, change the imports to

```ts
import type { RunKind, RunRoute } from '@nexui/types';

import type { TemplateChoice } from '#lib/perception';
```

and `perception: { template?: Template | 'none'; route?: RunRoute };` to `perception: { template?: TemplateChoice; route?: RunRoute };`. `ai/mock.ts` still answers `travel` without a fixture (spec section 2); leave it.

- [ ] **Step 7: Start a plan from the plain choice**

In `apps/api/src/lib/orchestrator/orchestrate.ts`, in `startIntent`, replace `if (template.value === 'none') {` with `if (template === 'unsupported') {`, `createIntent(deps.db, goal, template.value)` with `createIntent(deps.db, goal, template)`, and the run input's

```ts
        template: template.value,
        perception: template.source,
```

with

```ts
        template,
        perception: 'model',
```

Replace its doc comment with:

```ts
/**
 * CreateIntent (spec section F): Jev picks the template, the template seeds the intent at once,
 * and a reasoning run is queued, which the worker claims after the response to fill it in. A
 * goal no template fits gets a plain intent and no run. If Jev can't read the goal, its
 * `PerceptionFailedError` stands and nothing is created. If the run can't be created, the
 * seeded plan is deleted and the error is rethrown.
 */
```

- [ ] **Step 8: Answer 503 in the create route**

In `apps/api/src/app/api/intents/route.ts`, add `import { PerceptionFailedError } from '#lib/perception';` after the `#lib/orchestrator` import (keep `#lib/*` imports in the group; `pnpm fix` orders them), and replace the `POST` handler's `catch` block with:

```ts
  } catch (error) {
    // Nexui doesn't guess a template; the + sheet keeps the goal so a retry is one tap.
    if (error instanceof PerceptionFailedError) {
      return jsonError(error.message, 503, headers);
    }

    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
```

In the handler's doc comment, append the sentence `If Jev can't read the goal, it answers 503 and writes nothing.`

- [ ] **Step 9: Regenerate what models see, and review the diff**

```bash
node --experimental-strip-types --no-warnings tests/support/model-surface.mjs
pnpm exec prettier --write tests/support/travel-model-surface.json
git diff tests/support/travel-model-surface.json
```

Expected diff, and nothing else:

```diff
-      "none": "Anything that is not a trip, such as a job search, a project, a purchase or a habit."
+      "unsupported": "Anything else, such as a move, a wedding, buying a car or hiring for a team."
```

If any tool, schema or instruction line moves, stop: something other than routing changed.

- [ ] **Step 10: Run the tests**

Run: `node --experimental-strip-types --test tests/perception.test.mjs tests/ai-session.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs tests/model-surface.test.mjs tests/api-load-order.test.mjs`
Expected: PASS. The 503 test finishes in milliseconds; if it takes seconds, the Gateway request is being retried, so check that the stub answers 401.

- [ ] **Step 11: Commit**

```bash
pnpm fix && pnpm lint && pnpm typecheck && pnpm test
git add apps/api/src/lib/perception apps/api/src/lib/ai/fixtures/types.ts apps/api/src/lib/orchestrator/orchestrate.ts apps/api/src/app/api/intents/route.ts tests/perception.test.mjs tests/ai-session.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs tests/support/travel-model-surface.json
git commit -m "Route goals to a template or unsupported, and answer 503 when Jev can't read one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The create response says what Nexui did with the goal

Spec section 2, "The create response becomes a union", and the first bullet of "Unsupported goals". `startIntent` and `POST /api/intents` answer `{ outcome: 'started', snapshot, runId }` (201) or `{ outcome: 'unsupported' }` (201), with the status read from a `Record` keyed by outcome. Mobile, the scripts and a new mock fixture follow. The + sheet's saved-goal reply is Task 5; here it only stops offering "Open plan" for a saved goal.

**Files:**

- Modify: `packages/types/src/api.ts` (`createIntentResponseSchema`)
- Modify: `apps/api/src/lib/orchestrator/orchestrate.ts` (`StartedIntent`, `startIntent`)
- Modify: `apps/api/src/app/api/intents/route.ts` (`POST`)
- Create: `apps/api/src/lib/ai/fixtures/saved-goal.ts`; Modify: `apps/api/src/lib/ai/fixtures/index.ts`
- Modify: `apps/mobile/src/data/queries.ts` (`useCreateIntent`), `apps/mobile/src/data/api.ts` (`createIntent`'s comment)
- Modify: `apps/mobile/src/app/(app)/compose.tsx` (`send`, "Open plan")
- Modify: `scripts/eval-travel.mjs` (`runCase`), `scripts/try-run.mjs` (`goal`), `scripts/smoke-intent-graph.mjs` (the first create)
- Test: `tests/run-contracts.test.mjs`, `tests/orchestrator.test.mjs`, `tests/intents-route.test.mjs`, `tests/ai-session.test.mjs`

**Interfaces:**

- Consumes: `chooseTemplate`'s `TemplateChoice` (Task 2); `UNSUPPORTED_GOAL` (Task 1, through `createIntent`).
- Produces:
  - `createIntentResponseSchema`: a `z.discriminatedUnion('outcome', …)` of `{ outcome: 'started'; snapshot: GraphSnapshot; runId: string }` and `{ outcome: 'unsupported' }`. `CreateIntentResponse` is inferred from it.
  - `StartedIntent` in `#lib/orchestrator`: the same two shapes.
  - `savedGoal: RunFixture` (`name: 'saved-goal'`, `match: ['wedding']`, `perception: { template: 'unsupported' }`, `steps: []`) in `FIXTURES`.

- [ ] **Step 1: Write the failing tests**

In `tests/run-contracts.test.mjs` (`RUN_ID`, `INTENT_ID` and `STAMP` are defined at its top), replace the test "creating an intent may start no run" with:

```js
test('creating an intent answers what Nexui did with the goal', () => {
  const snapshot = {
    intent: {
      id: INTENT_ID,
      goal: 'Plan Japan in December',
      template: 'travel',
      status: 'exploring',
      context: {},
      summary: { line: '' },
      createdAt: STAMP,
      updatedAt: STAMP,
      lastActivityAt: STAMP,
    },
    workspace: null,
    objects: [],
    relationships: [],
  };
  const started = { outcome: 'started', snapshot, runId: RUN_ID };

  assert.equal(createIntentResponseSchema.parse(started).runId, RUN_ID);
  assert.deepEqual(createIntentResponseSchema.parse({ outcome: 'unsupported' }), {
    outcome: 'unsupported',
  });
  // A started plan always has its run, and every answer names its outcome.
  assert.equal(createIntentResponseSchema.safeParse({ ...started, runId: null }).success, false);
  assert.equal(createIntentResponseSchema.safeParse({ snapshot, runId: RUN_ID }).success, false);
});
```

In `tests/orchestrator.test.mjs`, in "a trip goal is seeded at once and filled in by a run after the response", add `assert.equal(started.outcome, 'started');` as its first assertion, and replace the test "a goal no template fits gets a plain intent and no run" with:

```js
test('a goal no template fits is saved with no workspace, no run and no model call beyond Jev', async (t) => {
  const { fake, tasks, deps } = setup(t);

  assert.deepEqual(await startIntent(deps, 'Plan my wedding next June'), {
    outcome: 'unsupported',
  });
  assert.equal(fake.state.created.p_template, null);
  assert.deepEqual(
    fake.state.created.p_ops.map((op) => op.op),
    ['update_intent'],
  );
  assert.equal(fake.state.snapshot.intent.summary.line, "Nexui can't plan this yet.");
  assert.equal(fake.state.snapshot.workspace, null);
  assert.equal(fake.state.createdRun, null);
  assert.equal(tasks.length, 0);
});
```

In `tests/intents-route.test.mjs`, in "creating an intent seeds the trip, starts its run and answers at once", add `assert.equal(body.outcome, 'started');` after the status assertion, and add after that test:

```js
test('a goal no template fits is saved: a 201 with no plan and no run', async (t) => {
  useMockAi(t);

  const tasks = captureRuns(t);
  let created;

  // No `create_run` handler: a run would answer 500 and fail the test.
  mockSupabaseAuth(
    t,
    postgrest({
      create_intent: (args) => {
        created = args;

        return {};
      },
      get_intent_snapshot: () => ({
        ...snapshotRow(travelWorkspace(TRIP_ID)),
        intent: { ...intentRow, goal: 'Plan my wedding next June', template: null },
        workspace: null,
        objects: [],
        relationships: [],
      }),
    }),
  );

  // Mock mode's `saved-goal` fixture answers `unsupported` for a wedding.
  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan my wedding next June' }) }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { outcome: 'unsupported' });
  assert.equal(created.p_goal, 'Plan my wedding next June');
  assert.equal(created.p_template, null);
  assert.equal(tasks.length, 0);
});
```

In `tests/ai-session.test.mjs`, in "every create fixture replays cleanly against a freshly seeded trip", replace `FIXTURES.filter((candidate) => candidate.kind === 'create_intent')` with

```js
FIXTURES.filter(
  // A saved goal starts no run, so it has nothing to replay.
  (candidate) =>
    candidate.kind === 'create_intent' && candidate.perception.template !== 'unsupported',
);
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/run-contracts.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs tests/ai-session.test.mjs`
Expected: FAIL. There is no `outcome`, and the wedding goal is planned as a trip (no fixture yet).

- [ ] **Step 3: The union contract**

In `packages/types/src/api.ts`, replace

```ts
// The new intent, and the run that fills it in. A goal that isn't a trip starts no run.
export const createIntentResponseSchema = z.object({
  snapshot: graphSnapshotSchema,
  runId: idSchema.nullable(),
});
```

with

```ts
// What Nexui did with the goal (job search spec, section 2): a plan seeded with its run queued,
// or a goal no template fits, saved with no plan and no run. PR 2 adds `awaiting_resume` and
// `existing_search`.
export const createIntentResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('started'), snapshot: graphSnapshotSchema, runId: idSchema }),
  z.object({ outcome: z.literal('unsupported') }),
]);
```

- [ ] **Step 4: The orchestrator answers the union**

In `apps/api/src/lib/orchestrator/orchestrate.ts`, replace the `StartedIntent` interface with:

```ts
/**
 * What `startIntent` did with a goal (job search spec, section 2): seeded a plan and queued the
 * run that fills it in, or saved a goal no template fits, with no plan and no run.
 */
export type StartedIntent =
  { outcome: 'started'; snapshot: GraphSnapshot; runId: string } | { outcome: 'unsupported' };
```

In `startIntent`, replace

```ts
if (template === 'unsupported') {
  return { snapshot: await createIntent(deps.db, goal, null), runId: null };
}
```

with

```ts
// Saved, not planned: no workspace, no run and no model call beyond Jev.
if (template === 'unsupported') {
  await createIntent(deps.db, goal, null);

  return { outcome: 'unsupported' };
}
```

and the last line, `return { snapshot, runId: run.id };`, with `return { outcome: 'started', snapshot, runId: run.id };`. In its doc comment, replace `A goal no template fits gets a plain intent and no run.` with `A goal no template fits is saved as an intent with no template, workspace or run.`

- [ ] **Step 5: The route's status comes from the outcome**

In `apps/api/src/app/api/intents/route.ts`, add `type CreateIntentResponse,` to the `@nexui/types` import, add after `headers`:

```ts
// Each outcome's status (job search spec, section 2). A new outcome must name its own.
const CREATE_STATUS: Record<CreateIntentResponse['outcome'], number> = {
  started: 201,
  unsupported: 201,
};
```

and in `POST` replace `return Response.json(createIntentResponseSchema.parse(started), { status: 201, headers });` with

```ts
const body = createIntentResponseSchema.parse(started);

return Response.json(body, { status: CREATE_STATUS[body.outcome], headers });
```

Replace the handler's doc comment with:

```ts
/**
 * Starts a plan from a goal (spec section F; job search spec, section 2). Jev picks the
 * template: a trip is seeded at once and a run fills it in after the response (`started`), and
 * a goal no template fits is saved with no plan (`unsupported`). If Jev can't read the goal, it
 * answers 503 and writes nothing.
 */
```

- [ ] **Step 6: A mock fixture for a saved goal**

Create `apps/api/src/lib/ai/fixtures/saved-goal.ts`:

```ts
import type { RunFixture } from './types.ts';

// Written by hand, not recorded: Jev's answer for a goal no template fits, so mock mode can save
// a goal. No run starts, so there are no steps.
export const savedGoal: RunFixture = {
  name: 'saved-goal',
  kind: 'create_intent',
  match: ['wedding'],
  perception: { template: 'unsupported' },
  steps: [],
};
```

In `apps/api/src/lib/ai/fixtures/index.ts`, add `import { savedGoal } from './saved-goal.ts';` after the `japan-december` import, change the list to `[japanDecember, chicagoWeekend, japanAskFreeDays, savedGoal]`, and add to its doc comment: `` `saved-goal` saves any goal that mentions a wedding, for the unsupported path. ``

- [ ] **Step 7: Mobile reads the union**

In `apps/mobile/src/data/queries.ts`, replace `useCreateIntent`'s `onSuccess` with:

```ts
    onSuccess: (result) => {
      // A saved goal has no plan to show, and Home doesn't list it.
      if (result.outcome !== 'started') {
        return;
      }

      client.setQueryData(queryKeys.intent(result.snapshot.intent.id), result.snapshot);
      refreshLists(client);
    },
```

In `apps/mobile/src/data/api.ts`, replace `/** Starts a plan from a goal; a trip also starts the run that fills it in. */` with `/** Starts a plan from a goal and its run, or saves a goal Nexui can't plan yet. */`.

In `apps/mobile/src/app/(app)/compose.tsx`, give `Sent.runId` a comment:

```ts
interface Sent {
  text: string;
  /** The run working on it, or null for a goal Nexui saved because it can't plan it yet. */
  runId: string | null;
}
```

replace the `create.mutate(…)` call in `send` with:

```ts
create.mutate(trimmed, {
  onSuccess: (result) => {
    setText('');

    // A saved goal opens no plan, so the next send starts a new one.
    if (result.outcome === 'unsupported') {
      setSent({ text: trimmed, runId: null });

      return;
    }

    setTarget(result.snapshot.intent.id);
    setSent({ text: trimmed, runId: result.runId });
  },
});
```

and replace `{sent && !params.intentId ? (` (the "Open plan" button's condition) with `{sent && target && !params.intentId ? (`.

- [ ] **Step 8: The scripts read the union**

`scripts/eval-travel.mjs`, at the start of `runCase`, replace

```js
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
```

with

```js
const started = await call('POST', '/api/intents', { goal: testCase.goal });

// A saved goal has no id to tag, so `--clean` can't remove it; it stays off Home.
if (started.outcome !== 'started') {
  return {
    intentId: null,
    checks: [{ label: 'Jev saw a trip', ok: false, detail: `answered ${started.outcome}` }],
    notes: [],
    plan: [],
  };
}

const intentId = started.snapshot.intent.id;

await tag(intentId, testCase.name);
```

`scripts/try-run.mjs`, replace the `goal` case's body with:

```js
  case 'goal': {
    const started = await call('POST', '/api/intents', { goal: args[0] });

    if (started.outcome !== 'started') {
      console.log(`saved, not planned (${started.outcome})`);
      break;
    }

    const { snapshot, runId } = started;

    console.log(`intent ${snapshot.intent.id} (${snapshot.intent.template})`);
    printRun(await waitForRun(runId));
    await printPlan(call, snapshot.intent.id);
    break;
  }
```

`scripts/smoke-intent-graph.mjs`, replace

```js
const { snapshot: created, runId } = await call('POST', '/api/intents', {
  goal: 'Smoke test: three quiet days away',
});
```

with

```js
const started = await call('POST', '/api/intents', { goal: 'Smoke test: three quiet days away' });

assert.equal(started.outcome, 'started', `the goal was ${started.outcome}`);

const { snapshot: created, runId } = started;
```

- [ ] **Step 9: Run the tests**

Run: `node --experimental-strip-types --test tests/run-contracts.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs tests/ai-session.test.mjs tests/model-surface.test.mjs`
Expected: PASS.

Run: `node --check scripts/eval-travel.mjs && node --check scripts/try-run.mjs && node --check scripts/smoke-intent-graph.mjs`
Expected: no output (they run against a live API in Task 6).

- [ ] **Step 10: Commit**

```bash
pnpm fix && pnpm lint && pnpm typecheck && pnpm test
git add packages/types/src/api.ts apps/api/src/lib/orchestrator/orchestrate.ts apps/api/src/app/api/intents/route.ts apps/api/src/lib/ai/fixtures apps/mobile/src/data/queries.ts apps/mobile/src/data/api.ts "apps/mobile/src/app/(app)/compose.tsx" scripts/eval-travel.mjs scripts/try-run.mjs scripts/smoke-intent-graph.mjs tests/run-contracts.test.mjs tests/orchestrator.test.mjs tests/intents-route.test.mjs tests/ai-session.test.mjs
git commit -m "Answer a new goal with what Nexui did: started, or saved as unsupported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Saved goals stay off Home and go with the account

Spec section 2, "Unsupported goals", bullets 3 and 5. `listIntents` adds `template is not null`, so the saved goals are exactly the template-null rows. Account deletion already removes them: `intents.user_id` cascades from `auth.users`, which `deleteAccount` deletes. A test pins both facts.

**Files:**

- Modify: `apps/api/src/lib/graph/lists.ts` (`listIntents`)
- Modify: `scripts/smoke-intent-graph.mjs` (a saved goal, before the final cancel)
- Test: `tests/intents-route.test.mjs`, `tests/intent-graph-migration.test.mjs`

**Interfaces:**

- Consumes: the `unsupported` outcome (Task 3).
- Produces: `GET /api/intents` lists only intents with a template.

- [ ] **Step 1: Write the failing tests**

In `tests/intents-route.test.mjs`, rename "Home lists intents, most recent first" to "Home lists plans, most recent first, and leaves out saved goals", and add after its `status` assertion:

```js
assert.equal(asked.searchParams.get('template'), 'not.is.null');
```

In `tests/intent-graph-migration.test.mjs`, add:

```js
test('a saved goal is an intent with no template, and it goes with its account', () => {
  const intents = sql.match(/create table public\.intents \(([\s\S]*?)\n\);/)?.[1] ?? '';

  // Nullable: a goal Nexui can't plan yet is saved with `template` null.
  assert.match(intents, /\n {2}template text check \(template in \('travel', 'job_search'\)\),/);
  // Account deletion removes the auth user, and every intent with it.
  assert.match(
    intents,
    /user_id uuid not null default auth\.uid\(\) references auth\.users \(id\) on delete cascade/,
  );
});
```

- [ ] **Step 2: Run them to see the first fail**

Run: `node --experimental-strip-types --test tests/intents-route.test.mjs tests/intent-graph-migration.test.mjs`
Expected: the Home test FAILS (`template` is null); the migration test passes, since it pins what already holds.

- [ ] **Step 3: Leave saved goals out of Home**

In `apps/api/src/lib/graph/lists.ts`, add `.not('template', 'is', null)` after `.neq('status', 'archived')`, and replace `listIntents`' doc comment with:

```ts
/**
 * Home's cards: the user's plans that aren't archived, most recently active first. A goal saved
 * without a template (Nexui can't plan it yet) isn't a plan, so it isn't listed (job search
 * spec, section 2). An intent with a run still working on it shows "Drafting" instead of its
 * own badge (spec section D).
 */
```

- [ ] **Step 4: Check it in the smoke script**

In `scripts/smoke-intent-graph.mjs`, before the final `const cancelled = await call('POST', \`/api/runs/${asked.runId}/cancel\`);`, add:

```js
// A goal no template fits is saved, and Home leaves it out (mock mode's `saved-goal` fixture).
const saved = await call('POST', '/api/intents', { goal: 'Smoke test: plan my wedding next June' });

assert.deepEqual(saved, { outcome: 'unsupported' });

const home = await call('GET', '/api/intents');

assert.ok(
  home.items.every((item) => item.template !== null),
  'Home lists only plans',
);
console.log('saved goal: unsupported, not on Home');
```

- [ ] **Step 5: Run the tests**

Run: `node --experimental-strip-types --test tests/intents-route.test.mjs tests/intent-graph-migration.test.mjs && node --check scripts/smoke-intent-graph.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm fix && pnpm lint && pnpm typecheck && pnpm test
git add apps/api/src/lib/graph/lists.ts scripts/smoke-intent-graph.mjs tests/intents-route.test.mjs tests/intent-graph-migration.test.mjs
git commit -m "Keep saved goals off Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The + sheet's saved-goal reply, and examples from every template

Spec section 2, "Unsupported goals" bullet 2 and "Copy that assumes a trip" (the placeholder), with the UX canvas's `Unsupported` artboard. `TEMPLATE_EXAMPLES` in `@nexui/types` names each template's plans and an example goal. The + sheet builds three things from it: its new-plan placeholder (taking turns across templates), the "Today Nexui plans …" sentence, and one "Try one" button per template. The trip-only note goes.

**Files:**

- Create: `packages/types/src/templates.ts`; Modify: `packages/types/src/index.ts`
- Create: `apps/mobile/src/features/compose/goal-examples.ts`
- Create: `apps/mobile/src/features/compose/saved-goal-reply.tsx`
- Modify: `apps/mobile/src/features/compose/index.ts`
- Modify: `apps/mobile/src/app/(app)/compose.tsx`
- Test: `tests/shared-contracts.test.mjs`, new `tests/mobile-goal-examples.test.mjs`

**Interfaces:**

- Consumes: `Sent.runId === null` meaning a saved goal (Task 3).
- Produces:
  - In `@nexui/types`: `interface TemplateExample { plans: string; goal: string }` and `TEMPLATE_EXAMPLES: Record<Template, TemplateExample>`.
  - In `#features/compose`: `SavedGoalReply({ onTry }: { onTry: (goal: string) => void })` and `nextGoalPlaceholder(): string`.
  - In `features/compose/goal-examples.ts` (tested directly): `GOAL_EXAMPLES: readonly TemplateExample[]`, `plansToday(examples: readonly TemplateExample[]): string` and `exampleGoal(examples: readonly TemplateExample[], turn: number): string`.

- [ ] **Step 1: Write the failing tests**

In `tests/shared-contracts.test.mjs`, add:

```js
test('every template offers an example goal the create route accepts', () => {
  assert.deepEqual(Object.keys(types.TEMPLATE_EXAMPLES), types.templateSchema.options);

  for (const [name, example] of Object.entries(types.TEMPLATE_EXAMPLES)) {
    assert.equal(
      types.createIntentRequestSchema.safeParse({ goal: example.goal }).success,
      true,
      name,
    );
    assert.match(example.plans, /^[a-z]+( [a-z]+)*$/, name);
  }
});
```

Create `tests/mobile-goal-examples.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exampleGoal,
  GOAL_EXAMPLES,
  nextGoalPlaceholder,
  plansToday,
} from '../apps/mobile/src/features/compose/goal-examples.ts';
import { TEMPLATE_EXAMPLES } from '../packages/types/src/index.ts';

const trip = { plans: 'trips', goal: 'A week in Lisbon in May' };
const job = { plans: 'job searches', goal: 'Find a senior designer role in Berlin' };
const home = { plans: 'home searches', goal: 'Find a two-bed flat in Leeds' };

test('the saved-goal reply names what Nexui plans today', () => {
  assert.equal(plansToday([trip]), 'Today Nexui plans trips.');
  assert.equal(plansToday([trip, job]), 'Today Nexui plans trips and job searches.');
  assert.equal(
    plansToday([trip, job, home]),
    'Today Nexui plans trips, job searches and home searches.',
  );
});

test('new plans take turns with each template’s example goal', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((turn) => exampleGoal([trip, job], turn)),
    [trip.goal, job.goal, trip.goal, job.goal],
  );
  assert.equal(exampleGoal([trip], 5), trip.goal);
});

// Until job search declares its template (PR 2), the + sheet offers trips alone.
test('the + sheet offers every template the API plans, and only those', () => {
  assert.deepEqual(GOAL_EXAMPLES, Object.values(TEMPLATE_EXAMPLES));
  assert.equal(plansToday(GOAL_EXAMPLES), 'Today Nexui plans trips.');
  assert.equal(nextGoalPlaceholder(), 'A week in Lisbon in May');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/shared-contracts.test.mjs tests/mobile-goal-examples.test.mjs`
Expected: FAIL: `TEMPLATE_EXAMPLES` is undefined and `goal-examples.ts` doesn't exist.

- [ ] **Step 3: Declare each template's example**

Create `packages/types/src/templates.ts`:

```ts
import type { Template } from './graph.ts';

/** How the app names a template's plans, and a goal that starts one. */
export interface TemplateExample {
  /** Its plans, plural, as they read in a sentence: "trips". */
  plans: string;
  /** An example goal, for the + sheet's placeholder and its "Try one" buttons. */
  goal: string;
}

/**
 * Every template's example, in the order the + sheet offers them. A template `templateSchema`
 * lists without one fails typecheck, so the app never offers a template the API can't plan,
 * and never misses one it can.
 */
export const TEMPLATE_EXAMPLES: Record<Template, TemplateExample> = {
  travel: { plans: 'trips', goal: 'A week in Lisbon in May' },
};
```

In `packages/types/src/index.ts`, add `export * from './templates.ts';` after `export * from './graph.ts';`.

- [ ] **Step 4: The examples helper**

Create `apps/mobile/src/features/compose/goal-examples.ts`:

```ts
import { TEMPLATE_EXAMPLES, type TemplateExample } from '@nexui/types';

/** Every template's example, in the order `TEMPLATE_EXAMPLES` lists them. */
export const GOAL_EXAMPLES: readonly TemplateExample[] = Object.values(TEMPLATE_EXAMPLES);

/**
 * What Nexui plans today, from each template's plans.
 *
 * @example
 * plansToday([{ plans: 'trips', goal: '…' }, { plans: 'job searches', goal: '…' }]);
 * // 'Today Nexui plans trips and job searches.'
 */
export function plansToday(examples: readonly TemplateExample[]): string {
  const plans = examples.map((example) => example.plans);
  const last = plans.at(-1) ?? '';
  const rest = plans.slice(0, -1);
  const list = rest.length > 0 ? `${rest.join(', ')} and ${last}` : last;

  return `Today Nexui plans ${list}.`;
}

/**
 * The example goal for the `turn`th new plan. Templates take turns, so with trips and job
 * searches the placeholder alternates between them (job search spec, section 2).
 *
 * @example
 * exampleGoal([trip, job], 3); // job.goal
 */
export function exampleGoal(examples: readonly TemplateExample[], turn: number): string {
  return examples[turn % examples.length]?.goal ?? '';
}

// How many new-plan placeholders this app session has shown.
let shown = 0;

/** The placeholder for the next new plan; each call takes the next template's turn. */
export function nextGoalPlaceholder(): string {
  const goal = exampleGoal(GOAL_EXAMPLES, shown);

  shown += 1;

  return goal;
}
```

- [ ] **Step 5: The saved-goal reply**

Create `apps/mobile/src/features/compose/saved-goal-reply.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

import { GOAL_EXAMPLES, plansToday } from './goal-examples';

/**
 * The + sheet's answer to a goal no template fits (job search spec, section 2): Nexui saved it,
 * says what it plans today, and offers each template's example goal. Choosing one puts it in
 * the composer to edit or send; it starts a new plan, since a saved goal opens none.
 */
export function SavedGoalReply({ onTry }: { onTry: (goal: string) => void }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.reply}>
      <View style={styles.card}>
        <NexuiTag />
        <Text accessibilityRole="header" style={styles.title}>
          Nexui can&apos;t plan this yet.
        </Text>
        <Text style={styles.body}>
          It&apos;s saved, and you&apos;ll hear when it can. {plansToday(GOAL_EXAMPLES)}
        </Text>
        <Text style={styles.label}>Try one</Text>
        {GOAL_EXAMPLES.map((example) => (
          <Button
            key={example.goal}
            label={example.goal}
            accessibilityLabel={`Try: ${example.goal}`}
            onPress={() => onTry(example.goal)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        No plan was created. Saved goals help decide what Nexui learns next.
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  reply: { gap: 8 },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  label: { marginTop: 4, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.faint },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
}));
```

In `apps/mobile/src/features/compose/index.ts`, add (keeping the file sorted by path):

```ts
export { nextGoalPlaceholder } from './goal-examples';
export { SavedGoalReply } from './saved-goal-reply';
```

- [ ] **Step 6: Use them in the + sheet**

In `apps/mobile/src/app/(app)/compose.tsx`:

- Change the `#features/compose` import to `import { RunCard, SavedGoalReply, afterAsk, nextGoalPlaceholder, useKeyboardOverlap } from '#features/compose';` (`pnpm fix` orders it).
- After `const [sent, setSent] = useState<Sent | null>(null);`, add `const [goalPlaceholder] = useState(nextGoalPlaceholder);`. It runs once per opening; the app has no React StrictMode, so it isn't called twice.
- Replace

  ```tsx
  {
    sent && sent.runId === null ? (
      <Text style={styles.note}>Nexui can plan trips so far. Your plan is saved on Home.</Text>
    ) : null;
  }
  ```

  with

  ```tsx
  {
    sent && sent.runId === null ? <SavedGoalReply onTry={setText} /> : null;
  }
  ```

- Replace `placeholder={target ? 'Ask anything or change this plan' : 'A week in Portugal in May'}` with `placeholder={target ? 'Ask anything or change this plan' : goalPlaceholder}`.
- Delete the now-unused `note` style from `useStyles`.

- [ ] **Step 7: Run the tests and the sweep**

Run: `node --experimental-strip-types --test tests/shared-contracts.test.mjs tests/mobile-goal-examples.test.mjs`
Expected: PASS.

Run: `grep -rn "trips so far" apps packages --include='*.ts' --include='*.tsx'`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
pnpm fix && pnpm lint && pnpm typecheck && pnpm test
git add packages/types/src/templates.ts packages/types/src/index.ts apps/mobile/src/features/compose "apps/mobile/src/app/(app)/compose.tsx" tests/shared-contracts.test.mjs tests/mobile-goal-examples.test.mjs
git commit -m "Tell the + sheet's user a goal is saved, and offer each template's example

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, reviews, the whole-branch check and the smoke test

**Files:**

- Modify (through the `docs-keeper` agent): `docs/architecture/intent-graph.md`, `docs/architecture/mobile.md`

- [ ] **Step 1: Update the docs**

Dispatch the `docs-keeper` agent with this brief:

> Routing and saved requests (`docs/superpowers/plans/2026-10-10-routing-and-saved-requests.md`) is implemented on this branch. Update the docs to match the code, briefly, in each doc's existing style:
>
> 1. `docs/architecture/intent-graph.md`:
>    - "Templates": `templateFor` returns null for a saved goal Nexui can't plan yet; `UNSUPPORTED_GOAL` ("Nexui can't plan this yet.") is that goal's summary line and the refusal to ask about or stage on it.
>    - "AI runs", the Perception bullet: a goal is a template's name or `unsupported` (a sentence naming no template). If Jev fails, times out or picks a choice it wasn't offered (the AI SDK refuses that answer), `chooseTemplate` throws `PerceptionFailedError` and `POST /api/intents` answers 503 "Nexui couldn't read that goal. Try again." without writing anything. Asks keep their `reasoning` fallback. Mock mode answers `travel` without a fixture, and the hand-written `saved-goal` fixture answers `unsupported` for any goal with "wedding".
>    - A short new subsection on saved goals, beside the Perception bullet:
>      - the create response's `outcome` union and statuses (`started` 201, `unsupported` 201);
>      - a saved goal is an intent with `template` null: one summary op, no workspace, no run;
>      - `listIntents` leaves it off Home; Changes still shows its "started" row;
>      - account deletion removes it through the `intents.user_id` cascade;
>      - this query for the project's SQL editor, which lists saved goals across users to rank use case #3:
>
>        ```sql
>        select i.created_at, i.goal
>        from public.intents i
>        where i.template is null
>        order by i.created_at desc;
>        ```
>
>      - Note that job-hunting goals saved before job search's template shipped appear there too.
>    - Fix the stale "Nexui can only change trips so far." quote.
>    - "Checking it": the smoke script also saves a goal and checks Home leaves it out.
> 2. `docs/architecture/mobile.md`, "The + sheet":
>    - a saved goal shows `SavedGoalReply` (what Nexui plans today, from `TEMPLATE_EXAMPLES`, and a "Try one" button per template that fills the composer) and no "Open plan";
>    - the next send starts a new plan;
>    - the new-plan placeholder takes turns across the templates' examples (`nextGoalPlaceholder`);
>    - a 503 shows its message above the composer and keeps the typed goal.
>
> Don't change the job search spec or the readiness spec. Don't document anything the code doesn't do.

Review its diff, then commit:

```bash
git add docs
git commit -m "Document routing and saved goals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Run the reviewers**

Dispatch in parallel, each over `git diff origin/main...HEAD`:

- `api-reviewer`: everything under `apps/api` and `packages/types`;
- `mobile-reviewer`: `compose.tsx`, `features/compose`, `data/queries.ts`, `intent/[id].tsx`;
- `security-reviewer`: the create route's 503 and logging, `listIntents`, and that no goal text is logged.

Fix every finding that holds up, rerun `pnpm test`, and commit the fixes with a subject naming what changed.

- [ ] **Step 3: Sweep for what this plan replaces**

```bash
grep -rn "trips so far" apps packages scripts tests --include='*.ts' --include='*.tsx' --include='*.mjs'
grep -rn "'none'" apps/api/src/lib/perception apps/api/src/lib/orchestrator apps/api/src/lib/ai
grep -rnE "'travel'|'trip'|\"trip\"" apps/api/src/lib --include='*.ts' | grep -v '^apps/api/src/lib/travel/'
```

Expected: the first two print nothing. The third prints only `ai/mock.ts` (mock mode's default answer, kept by spec section 2) and `ai/fixtures/*.ts` (recorded runs, which are data); `perception/perceive.ts`'s fallback is gone.

- [ ] **Step 4: Verify the whole branch**

```bash
pnpm fix
git status --short   # nothing unexpected; commit any formatting with "Format"
pnpm lint
pnpm typecheck
pnpm test
pnpm exec prettier --write .superpowers
pnpm format:check
pnpm build
```

Expected: all pass. `pnpm build` builds the Next API (which loads every route module, so it also catches a load-order cycle) and exports Expo web.

- [ ] **Step 5: Smoke-test against dev with mock AI**

In a worktree, use ports 3010 and 8091, and restart Metro after any edit: it doesn't hot-reload there. Copy the env files from the main checkout if they're missing:

```bash
cp -n ../../../apps/api/.env.local apps/api/.env.local
cp -n ../../../apps/mobile/.env.local apps/mobile/.env.local
AI_PROVIDER=mock pnpm --filter @nexui/api exec next dev --port 3010     # in the background
node scripts/qa-session.mjs > .qa/session.json
node scripts/smoke-intent-graph.mjs .qa/session.json http://localhost:3010
```

Expected: the smoke script passes, including "saved goal: unsupported, not on Home".

Then start Expo web against it: `EXPO_PUBLIC_API_URL=http://localhost:3010 pnpm --filter @nexui/mobile exec expo start --web --port 8091` (in the background). Open `http://localhost:8091` in a browser (Playwright). Put `.qa/session.json`'s `session` in localStorage under its `storageKey`, reload, and check each step, with a screenshot in `.qa/` for each:

1. **+** on Home: the placeholder reads "A week in Lisbon in May".
2. Send "Plan my wedding next June". Expected:
   - the bubble, then the reply: "Nexui can't plan this yet.", "It's saved, and you'll hear when it can. Today Nexui plans trips.", "Try one" with one button "A week in Lisbon in May", and the footer;
   - no "Open plan";
   - the composer is empty.
3. Tap "A week in Lisbon in May": the composer holds it. Send. Expected: a run card streams (mock), "Open plan" appears, and Home lists the trip but not the wedding goal.
4. Stop the API and start it with a key the Gateway refuses: `AI_PROVIDER=live AI_GATEWAY_API_KEY=invalid-smoke-key pnpm --filter @nexui/api exec next dev --port 3010`. In **+**, send "A weekend in Porto". Expected: "Nexui couldn't read that goal. Try again." above the composer, and "A weekend in Porto" still in it.

Finish with `node scripts/qa-session.mjs --revoke .qa/session.json` and stop both servers.

- [ ] **Step 6: Push and open the draft PR**

```bash
git push -u origin HEAD
gh pr create --draft --title "Route goals to a template or save them (job search PR 1, routing)" --body-file <(cat <<'EOF'
Implements job search spec section 2 (routing and saved requests), per docs/superpowers/plans/2026-10-10-routing-and-saved-requests.md. Job search itself routes in PR 2, by declaration.

- Jev answers a template or `unsupported`. A goal it can't read is a 503 ("Nexui couldn't read that goal. Try again.") with nothing written, never a guessed trip.
- `POST /api/intents` answers `{ outcome: 'started', snapshot, runId }` or `{ outcome: 'unsupported' }`.
- A saved goal is an intent with no template: no workspace, no run, not on Home, deleted with the account.
- The + sheet says the goal is saved and offers each template's example; every trip-only sentence is template-neutral.
- What models see changes only in Jev's routing question (tests/support/travel-model-surface.json).

No migration.

## Validation
- pnpm lint, typecheck, test, format:check: (results)
- pnpm build: (result)
- Smoke script on dev with AI_PROVIDER=mock: (result)
- Expo web smoke (saved goal, Try one, 503): (result, screenshots)

## Merge checklist
- [ ] Merge after the plan's docs PR.
- [ ] Optional live routing check (costs one trip run): with AI_PROVIDER=live, `node scripts/try-run.mjs goal "A weekend in Porto"` starts a trip and `node scripts/try-run.mjs goal "Plan my wedding next June"` prints "saved, not planned".
- [ ] The installed iOS preview build shows a parse error for a saved goal until the next build; trips work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

Fill in the results before creating it.

## Validation

- Every task: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass; `tests/model-surface.test.mjs` passes, changed only in Task 2's routing question.
- Whole branch: the sweep in Task 6 Step 3, `pnpm format:check` and `pnpm build`.
- Behaviour: the smoke script on dev with mock AI, and the Expo web smoke steps, including the 503 against a Gateway that refuses the key.
