# Job Search Mobile (Job Search PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app draws a job search end to end:

- the + sheet asks for a resume and starts the plan;
- the plan shows its search line, metrics, Open band buttons, interviews coming up, and a pipeline of roles with Interested and Pass;
- one `/object` sheet opens a role, a draft, the search or a trip's stop;
- Home draws a search's companies as chips.

Along the way the app stops knowing trips outside `features/travel/`, so a third template adds one folder and one line per registry.

**Architecture:** Registries, as in PRs 1 and 2.

- **Folders.** `features/workspace/` keeps the layout engine and the generic primitives. `features/travel/` and `features/jobs/` hold each template's primitives and detail bodies. A new `features/registry/` joins them in `SECTION_REGISTRY` and `DETAIL_REGISTRY`. Lint keeps `features/workspace/` from importing either template folder or the registry.
- **Actions.** A primitive reports a capability-shaped `WorkspaceAction` (`ask`, `open`, `capability` with its request and optimistic ops, `upload`, `start`, `copy`, `link`), so a screen never names a template's capability.
- **Shared types.** `@nexui/types` gains `KIND_META`, the line under a plan's title, and `TEMPLATE_INTAKES`, the + sheet's resume step and which route an upload takes.
- **Changes feed.** It shows each changeset's stored label and figures instead of reading kinds.
- **API.** `object.update` becomes callable from the app, a role can be renamed, and a new `jobs.forgetPass` removes a pass reason.

**Tech Stack:** Expo SDK 57 (React Native 0.86, Expo Router with typed routes; `expo-document-picker` and `expo-clipboard` are new), TanStack Query 5, Zustand 5, Zod 4 contracts in `@nexui/types`, Next.js 16 route handlers, ESLint 9 flat config (`import/no-restricted-paths`), Node 24's test runner with type stripping.

**Spec:** `docs/superpowers/specs/2026-10-04-job-search-design.md` ("the spec"):

- section 3.2 (the workspace and its contracts);
- section 4 (the resume step, the paperclip, `upload`);
- section 6 (`/object` and its bodies);
- section 10 (week 3, and PR 3's row).

Read it with `docs/superpowers/specs/2026-10-04-architecture-readiness.md` ("the readiness doc"), sections 3.4, 3.5, 3.12 and 5, and its rule: a trip-only seam is replaced by a registry, never branched. The UX canvas [Job Search Experience](https://claude.ai/artifact/WKBn2WoC6QjKJkogjqZSAp) is the design source (17 screens; open it with the Artifact tool's read action); where it and the spec disagree, the spec wins. The PR 2 plan (`docs/superpowers/plans/2026-10-10-job-search-core-api.md`, "Not in this plan") and PR #43's "Left for later" hand this plan its six carried items (see "Carried from PR 2").

**Not in this plan:**

- **PR 4: background work and legwork.**
  - Kits: the Interested card's "Application kit ready", **Prepare my application**, and queuing a kit on Interested.
  - Follow-up drafts, **Add interview**, **Prep me**, and `objectId` on asks with the + sheet's context chip.
  - The check-in, the scan, the check status line ("Checks every morning at 7") and **Pause** / **Resume** in the search sheet.
  - The eval's scan and kit halves.
- **PR 5:** forwarding, Copy address, Add Nexui to contacts.
- **Shoulds the spec lets go** (section 10's cut list):
  - Desktop pipeline columns. Web uses the phone layout, and the web app was cut on 2026-10-10.
  - The company body.
  - Editing drafts in place.
- **Turning job search on in production.** `JOB_SEARCH=on` in Vercel production is a merge-checklist item, done after the new preview build is on the device (Rollout).

## Rollout

No migration.

- **A new preview build** (Decision 1). `expo-document-picker` and `expo-clipboard` are native modules. Local iOS checks need a new dev client (`pnpm --filter @nexui/mobile exec expo run:ios`), and the device needs a new EAS preview build (`pnpm build:preview`, the founder's), the last step of Task 17. Web needs neither.
- **Job search stays dark in production until that build is installed.** The installed build draws a job search's stand-ins and can't upload a resume. Order: merge, build, install, then set `JOB_SEARCH=on` in Vercel production.
- **API changes deploy with the merge.**
  - `object.update` is callable by the app.
  - Roles become renamable.
  - `jobs.forgetPass` is new.
  - The installed build calls none of them, and trips are unaffected.
- **`TEMPLATE_EXAMPLES.job_search` is filled in** (Task 3), so the + sheet offers a job search example. In an environment where `JOB_SEARCH` is off, Jev saves that goal as unsupported. Dev has it on.

## Global Constraints

- Node.js 24 and pnpm 10.34.5. Run every command from the worktree root. One test file runs with `node --experimental-strip-types --test tests/<file>.test.mjs`; all of them with `pnpm test` (691 pass at `1468204`).
- **Copy, verbatim from the spec, the canvas and the API:**
  - The resume step: `Planning this as a job search`, `Add your resume?`, `Nexui uses it to screen roles and tailor your drafts. It reads the PDF once and doesn't keep the file.`, buttons `Add resume (PDF)` and `Continue without`, the note `Without it, Nexui searches on your goal alone. You can add it later from the plan.`, and while it reads `Reading your resume…`.
  - A second job search: `You already have a job search. Add this to it?` with `Open my search`.
  - Upload refusals, as the API words them: `That file is over 4 MB.` and `That file isn't a PDF.`
  - The pass picker: `Why pass?`, then `PASS_REASONS` in order (`Too junior`, `Too senior`, `Wrong location`, `Not this company`, `Pay too low`, `Not the work I want`), then `Skip, just pass`.
  - The role sheet: `Why it fits`, `Gaps`, `View posting`, `Drafts`, `People`, `No contacts yet. Tell Nexui who you're talking to and it adds them here.`, `I applied`, `Ask about this role`, `Accept offer`, `Decline`, `Close this role`, `Rename`.
  - The draft sheet: `Open in Mail`, `Copy`, `I sent it`, `Nexui never sends email. Open in Mail fills in a message in your own mail app.`
  - The search sheet: `Your search`, `Roles`, `Where`, `How you work`, `Salary floor`, `Industries`, `Never show`, `your current employer`, `You passed because`, `Resume`, `Replace`, `The search ends when you accept an offer.`
  - The AI disclosure (spikes note 3.4 item 4), under the pipeline's New stage: `Picked by Nexui's AI from employers' own job boards.`
- **Limits.**
  - A resume PDF of at most 4 MB (`MAX_UPLOAD_BYTES`, shared from `@nexui/types` in Task 3), checked in the app before the upload, with the API's own copy.
  - `start` and `resume` calls time out after 90 seconds: the read alone may take 60.
- **Statuses the app reads:** `start` 202 (`{ snapshot, runId, intake }`), 409 once started; `resume` 200 (a commit, undoable); create's four outcomes as in PR 2.
- **Replace seams with registries, never branch.** In `apps/mobile/src`, no template or template-kind name is compared outside `features/travel/`, `features/jobs/` and `features/registry/`, except `data/place-media.ts` (Departure 9). The check, run in pre-flight and again in Task 17, should print only `data/place-media.ts`:

  ```bash
  grep -rnE "(===|!==) '(travel|job_search|trip|place|leg|stay|search|company|opportunity|interview|person|document)'|kind: '(trip|place|leg|stay|search|company|opportunity|interview|person|document)'|'(trip|place|leg|stay)\.[a-zA-Z]+'" apps/mobile/src | grep -v "^apps/mobile/src/features/\(travel\|jobs\|registry\)/"
  ```

- **Import directions** (lint from Task 7 on): `features/workspace` imports neither `features/travel`, `features/jobs` nor `features/registry`. `features/travel` and `features/jobs` import `features/workspace`, never each other or the registry. Only routes import `features/registry`.
- **The pure display layer** (`docs/architecture/mobile.md`).
  - Files that `tests/mobile-*.test.mjs` load under plain Node have no `react-native` or `expo-*` import.
  - They import siblings by `./name.ts` and no barrel but `#lib`.
  - `import type` from another barrel is fine, because Node strips it.
  - Every new `.ts` helper in this plan is one of these files, and Task 17 adds them to the doc's list.
- **Mobile rules** (`docs/architecture/mobile.md`):
  - Routes go in `app/` only; components and helpers in `features/<area>/`.
  - Another folder is imported through its barrel; inside a folder use `./file` (`../file` from a subfolder to its feature).
  - A barrel only re-exports.
  - Import groups: packages, `@nexui/*`, `#…`, relative.
- **API rules** (`apps/api/AGENTS.md`):
  - `import type` for types.
  - Another domain is imported through `#lib/<domain>`; a sibling as `./file.ts`.
  - Exported functions have explicit return types.
  - Error messages are safe to show.
  - The load order holds (`lib/kinds` imports no other domain).
- **Style.**
  - Strict TypeScript with `noUncheckedIndexedAccess`.
  - Braces on every `if`, `else` and loop.
  - A blank line before `return`, after blocks and after declaration groups.
  - No nested ternaries; expand conditional object spreads.
  - Kebab-case filenames.
  - `.claude/hooks/format.sh` runs Prettier and ESLint after each edit; run `pnpm fix` before each commit anyway.
- **Each task ends** with `pnpm lint`, `pnpm typecheck` and `pnpm test` passing, then one commit.
  - Commit messages are a concise imperative subject ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Write the message to a scratch file in the session's tmp folder (not `.qa/`, which the auto-mode check refuses) and use `git commit -F <file>`.
  - Run each git command on its own: the worktree guard refuses `git -C`, loops and chained git commands.
- `pnpm format:check` also reads the git-ignored `.superpowers/sdd/` notes that subagent-driven development writes; run `pnpm exec prettier --write .superpowers` before checking.
- **Expo in a worktree.** Metro doesn't hot-reload in `.claude/worktrees` (no watchman): restart it after edits, and use ports 3010 (API) and 8091 (Expo).
  - Typed routes are generated by `expo start` and not committed. If `apps/mobile/.expo/types/` exists from an earlier start, it still lists `/place`: delete that folder (or start Expo once) before `pnpm typecheck` in Task 8.
- **Env files.** A new worktree has none: copy `apps/api/.env.local` and `apps/mobile/.env` from the main checkout. Check a variable with Node's `process.loadEnvFile` and print only booleans, never values.
- **No live calls without the founder's yes.**
  - Tests stub every network call.
  - Mock-AI runs against the dev project as the QA user are fine; delete what they create.
  - No live AI calls, Parallel searches or board fetches outside tests.
  - No `pnpm db:push:*` (there is no migration).
  - Pushing the branch and opening a draft PR are covered; never push to `main`, force-push or merge.

## Carried from PR 2

The six items PR 2's build and reviews left for this PR, and where each lands:

| Item                                                                                                                 | Source                       | Lands in                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Home's card ignores `summary.stripStyle`, so chip strips draw like routes; `photo-band.ts` counts the strip as stops | PR #43; PR 2's mobile review | Task 9                                                      |
| Show a link's host on roles a model added, since their `url` can be any https page                                   | PR #43                       | Task 13 (`linkHost`, under **View posting** for every role) |
| The `upload` action picks `/start` or `/resume` from `context.jobs.startedAt`                                        | PR #43                       | Task 3 (`intakeRoute`), Task 10                             |
| The "Add your resume" card has no button                                                                             | PR 2's mobile review         | Task 10 (`upload`, `start` and `copy` draw)                 |
| Renaming a role: an interview goal adds one titled "Role"                                                            | PR #44                       | Task 4 (API, Decision 2), Task 13 (**Rename**)              |
| The interview card's subtitle shows the raw ISO `at` (`packages/types/src/kinds/cards.ts`)                           | PR 2's final review          | Task 2 (`dateTime` format)                                  |

## Where this plan departs from the spec

1. **No desktop pipeline columns.** Web draws the phone layout: spec section 10 cuts columns first, and the web app was cut on 2026-10-10.
2. **The search sheet has no Pause, Resume or check status yet.**
   - `jobs.setSearchStatus` exists, but Resume "sets the next check to the next 07:00" (spec section 8), which PR 4's scheduling adds.
   - Spec section 10 puts "Hired and pause" in week 4.
   - **Accept offer** does land here, in the role sheet's stage picker, because `derive.jobSearch` already ends a search with a hire.
3. **Ask about this role opens + with the role named in the prompt** (`About Staff PM, Payments at Ledgerly: `). The + sheet's context chip and `objectId` on asks are PR 4's (PR 2 plan, "Not in this plan"). **Add interview** is PR 4's too (handoff scope cut).
4. **The draft sheet is built and tested now**, but drafts appear only once PR 4's kits and follow-ups write them. Until then the role sheet's Drafts list is empty.
5. **The Watching list draws with the generic `objectList` primitive**, with no company body (a Should).
6. **The pass picker's skip is `Skip, just pass`** (the canvas), the spec's **Skip**. Its note says Nexui uses the reason "to tune the roles it picks", not the canvas's "tomorrow's roles", since daily scans come with PR 4.
7. **Empty stages are hidden**, except New, which always shows (with its disclosure). The canvas draws "Offer · 0".
8. **Timeline rows open the role their interview is `for`.** There is no interview body; an interview with no role doesn't open.
9. **`data/place-media.ts` stays keyed by place objects** (readiness doc 3.5 item 4 asked for the summary strip's `key`). The media route answers per place id, so keying on strips would change the API for no gain. `photo-band.ts` does key on the strip.
10. **The `gate` stays.** PR 2's Decision 2 said this PR removes it. The handoff makes turning job search on in production a merge-checklist item, and the gate is the switch for it and for template #3.
11. **Criteria are edited through `object.update`**, with no criteria-specific capability (Decision 2). The current employer stays on the never-show list without a remove button, since the scan drops it from the resume anyway.
12. **The posting note reads `still live today on its job board`** (or `last seen live <date>` from an earlier day), not the spec's "still live this morning" (spec section 6). `lastSeenLiveAt` can be stamped at any hour, not only by a morning scan, and the note names where Nexui looked.

## Decisions this plan makes (flagged for review)

The handoff's two open decisions first:

1. **Native modules: Option A, recommended.**
   - PR 3 adds `expo-document-picker` (the resume step, the paperclip, **Add resume**, **Replace**) and `expo-clipboard` (**Copy**), with the EAS preview build as Task 17's last, manual step.
   - The resume step is the core of the flow, and the spec's Nov 16–20 slot was always for this build.
   - Option B (ship on web first, native modules in their own PR) would leave the phone unable to add a resume, the one step every job search starts with.
   - **The founder decides**, because it needs an EAS build. If B is chosen, Tasks 10, 14, 15 and 16 keep their code and the native install moves to its own PR; web works with both modules.
2. **Renaming a role: include it, recommended. One correction to the handoff:** `object.update` is not callable from the app today (`callableByUser: false`, `apps/api/src/lib/capabilities/graph.ts`), so making roles editable alone wouldn't let a user rename one. Task 4:
   - **Makes `object.update` callable by users.** It gives no new power: `POST /api/intents/[id]/changesets` already lets the user update any object, and `object.update` adds the kind's checks and read-only fields.
   - **Makes `opportunity` editable**, with `readOnlyFields` for the code-owned fields. These are the handoff's seven (`source`, `fit`, `lastSeenLiveAt`, `stage`, `outcome`, `appliedAt`, `followUps`) plus four more:
     - `url` and `postedAt`, since a model never writes a board fact;
     - `postingClosedAt` and `lastContactAt`, since `jobs.*` stamps them.
   - **Adds `KindBehaviour.nameField`**, so a role's object title follows `data.title` as a place's follows `data.name`.
   - **Corrects `docs/architecture/intent-graph.md`**, which says `object.update` refuses a role.
   - **Is the search sheet's only way to edit criteria.** Spec section 6's "criteria as editable chips" needs a user path, and today only a decision's option can change them.
   - **The alternative** is two job-specific capabilities (`jobs.renameRole`, `jobs.setCriteria`): more code for the same checks.

The plan's own:

3. **`jobs.forgetPass`, user-only, removes one pass reason** (by its `at`), since `passReasons` is read-only to `object.update` and the spec's search sheet lists them as removable. Its label is `Removed “<reason>” for <company>`.
4. **The registries live in `features/registry/`.**
   - `SECTION_REGISTRY` and `SectionView` move there from `features/workspace/sections/registry.tsx`.
   - `DETAIL_REGISTRY`, `DetailView` and `hasDetail` are new.
   - Only routes import it.
   - Three new lint zones hold the import directions, and `tests/mobile-import-direction.test.mjs` runs ESLint on probe files to pin them (readiness doc section 6).
5. **`WorkspaceAction` becomes capability-shaped:**

   ```ts
   type WorkspaceAction =
     | { type: 'ask'; prompt: string }
     | { type: 'open'; objectId: string }
     | { type: 'capability'; request: CapabilityRequest; optimistic: ChangesetOp[] }
     | { type: 'link'; url: string }
     // Task 10:
     | { type: 'upload'; docType: 'resume' }
     | { type: 'start' }
     | { type: 'copy'; text: string };
   ```

   The primitive that knows a capability builds its request and optimistic ops:
   - travel's `daysAction` and `moveAction`;
   - jobs' `stageAction`, `passAction` and `cardAction`;
   - the generic `resolveAction` and `fromInsightAction`.

   `workspace-actions.ts` holds only the type and the two generic builders, and never changes for a template. Each screen turns actions into effects explicitly, with no shared action wrapper (root `AGENTS.md`).

6. **`KIND_META` lives in `@nexui/types`** (readiness doc section 5 lists it there), with `tripMeta` moved from mobile and `searchMeta` new. Both need `formatMoney`, so it moves to `packages/types/src/kinds/money.ts`, and mobile's `lib/format.ts` re-exports it.
7. **`TEMPLATE_INTAKES` lives in `@nexui/types`.** Each template has the + sheet's step copy and `started(context)`, or null. `intakeRoute(intent)` answers `'start'`, `'resume'` or null. Job search's `started` reads `context.jobs.startedAt`, so no app code names a template's context. `TemplateExample` gains `one` ("a job search") and `short` ("search") for the second-search reply.
8. **The change feed reads `payload.label` and `payload.figures` only** (readiness doc 3.4).
   - A labelled changeset reads as its label.
   - A changeset with none reads `Made a change` or `Made <n> changes`.
   - The system's first event reads `Started “<goal>”`.
   - A figure reads as its label with a before → after.
   - Events from before labels lose their old sentences: this is a prototype, so no compatibility path.
   - The row's actor shows as its avatar and at the start of the meta line, so a label like `Moved Staff PM to Interested` reads whole.
9. **A decision's "Per day" row comes from `KIND_CARDS`.** `CardSpec` gains `compare` (fields a decision shows for an option's candidate). `place` declares `{ field: 'data.estDailyCost', label: 'Per day', format: 'estimate' }`. `decision-section.tsx` stops reading `PlaceData`. `DecisionOption.place` becomes `candidate`.
10. **Two helpers move so template folders' pure files can use them under Node:**
    - `aiMarkFor` to `lib/ai-mark.ts` (`#lib`).
    - `legBetween` to `@nexui/types` (`kinds/travel/figures.ts`, beside `tripParts`).
11. **Pipeline card actions are optimistic.** Interested and Pass move the card at once (`stageAction` and `passAction` patch the role's `stage`), so triage feels instant; the server's snapshot follows, as with a trip's days.
12. **Dates show in the device's time zone, for display only, as the spec's timeline does.**
    - A date-only `at` shows its date in UTC, so it never moves a day.
    - `formatDateTime` in `lib/format.ts` serves cards and the role sheet.
    - The timeline and the role sheet take an optional `timeZone` so tests pin it.
13. **Uploads are explicit in each screen.**
    - `choosePdf()` in `data/` opens the picker and refuses a file over 4 MB.
    - `useStartPlan` and `useReplaceResume` send it.
    - `intakeRoute` picks between them.
    - The workspace screen, the object screen and the + sheet each spell out the sequence.

## Review Focus

1. **A role with almost nothing: an interview goal's "Role" at Datadog**, with no `url`, `source`, `fit`, `salary` or `location`, and maybe no `at` link to a company. Expected:
   - the pipeline card shows its title and nothing broken;
   - the role sheet shows no View posting and no fit;
   - Rename works.

   Pinned by Task 12's and Task 13's sparse-role tests.

2. **A role a model added with any https `url`** (`https://apply.example.net/jobs/1?ref=x`). Expected:
   - the role sheet names the host (`apply.example.net`) under View posting before the user leaves the app;
   - the link opens only on tap;
   - an unparsable URL shows no button.

   Pinned by Task 13's `linkHost` tests.

3. **A file from the picker.** Expected:
   - **cancel** does nothing;
   - **over 4 MB** is refused in the app with `That file is over 4 MB.` and nothing is sent;
   - **a web `File`** is posted as the file;
   - **a native `{ uri, name }`** is posted with `application/pdf`;
   - **not a PDF**: the API's `That file isn't a PDF.` shows in the screen's error line.

   The size check and both file parts are pinned by Task 10's `upload-form` tests. The API's refusals are pinned by PR 2's route tests, and the error line is in Task 10's smoke.

4. **Interview times.** A date-only `at`, one in the past, and one near midnight in another zone. Expected:
   - the timeline splits upcoming and past by the device clock;
   - a date-only interview shows its date with no time and never shifts a day;
   - the past folds to a count.

   Pinned by Task 11's tests with a fixed `timeZone`.

5. **Changes with no label.** An Undo, an event from before labels, the system's first event, and a figure whose `before` is null. Expected: the feed shows a plain sentence or `—`, never reads a kind, and never throws. Pinned by Task 5's tests.

## File Structure

| Path                                                                                                                                                            | Change                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/types/src/kinds/{money,meta,cards}.ts`, `kinds/travel/{meta,figures}.ts`, `kinds/jobs/{meta,intake,schemas}.ts`, `templates.ts`, `api.ts`, `index.ts` | `formatMoney`, `KIND_META` (1); card formats (2); intakes, examples, upload limit (3); `legBetween` (7); `WORK_MODES` (12) |
| `apps/api/src/lib/{kinds/behaviour,capabilities/graph,jobs/roles,http/upload}.ts`, `docs/architecture/intent-graph.md`                                          | Renamable roles, `object.update` for users, `jobs.forgetPass` (4); shared upload limit (3)                                 |
| `apps/mobile/src/lib/{format,ai-mark,index}.ts`                                                                                                                 | Money re-export (1); `formatDateTime`, formats (2); `aiMarkFor` moves in (7)                                               |
| `apps/mobile/src/features/changes/{change-feed.ts,change-row.tsx}`                                                                                              | Labels and figures (5)                                                                                                     |
| `apps/mobile/src/features/workspace/`                                                                                                                           | Actions (6, 10); layout, barrel (7); `detail-types.ts` (8)                                                                 |
| `apps/mobile/src/features/travel/` (new)                                                                                                                        | Map, route, allocation, stepper, stop details, trip actions, place sheet, travel formatters (7); place body (8)            |
| `apps/mobile/src/features/registry/` (new)                                                                                                                      | `SECTION_REGISTRY` (7); `DETAIL_REGISTRY` (8); jobs entries (11–15)                                                        |
| `apps/mobile/src/features/jobs/` (new)                                                                                                                          | Timeline (11); pipeline, pass picker (12); role (13), draft (14), search (15) bodies                                       |
| `apps/mobile/src/features/home/{intent-card.tsx,photo-band.ts}`                                                                                                 | Chips, the band's count (9)                                                                                                |
| `apps/mobile/src/features/compose/`                                                                                                                             | Resume step, second-search reply, the sheet's reply state (16)                                                             |
| `apps/mobile/src/data/{api,queries,pick-pdf,upload-form,index}.ts`                                                                                              | Uploads (10)                                                                                                               |
| `apps/mobile/src/app/(app)/{object,_layout,compose}.tsx`, `(tabs)/(home)/intent/[id].tsx`; `place.tsx` removed                                                  | Meta (1, 8); actions (6, 10); `/object` (8); + sheet (16)                                                                  |
| `apps/mobile/{package.json,eslint.config.js}`, `pnpm-lock.yaml`                                                                                                 | Lint zones (7); native modules (10)                                                                                        |
| `docs/architecture/{mobile,job-search}.md`                                                                                                                      | Task 17                                                                                                                    |

New tests: `kind-meta`, `template-intakes`, `mobile-import-direction`, `mobile-upload-form`, `mobile-jobs-timeline`, `mobile-jobs-pipeline`, `mobile-jobs-role`, `mobile-jobs-draft`, `mobile-jobs-search`, `mobile-compose-reply`.

Changed: `mobile-format`, `kind-cards`, `mobile-goal-examples`, `jobs-capabilities`, `kind-behaviour`, `capabilities-route`, `model-surface` (its two JSON files), `mobile-change-feed`, `mobile-workspace-actions`, `mobile-workspace-layout`, `mobile-stop-details`, `mobile-map-region`, `mobile-country-names`, `mobile-photo-band`.

## Before Task 1: pre-flight

Line numbers in this plan are from `main` at `1468204` and move as tasks land. Find every edit by the code a step quotes, never by line number.

```bash
git log --oneline -1           # 1468204 or a later main
pnpm install --frozen-lockfile
pnpm test                      # 691 pass
```

Then run the seam grep from Global Constraints. At `1468204` it prints ten lines: these are the seams this plan removes, plus `data/place-media.ts`, which stays:

- `intent/[id].tsx` (the meta line);
- four in `change-feed.ts`;
- three in `workspace-actions.ts`;
- one in `workspace-layout.ts` (`legBetween`);
- `data/place-media.ts`.

If it prints anything else, tell the controller before starting.

---

### Task 1: The line under a plan's title (`KIND_META`)

Readiness doc 3.5 item 2, spec section 3.2 item 1.

- The meta line becomes a registry in `@nexui/types`: `tripMeta` moves there from mobile, `searchMeta` is new, and `formatMoney` moves with them.
- The workspace screen reads `anchorMeta` instead of branching on `kind === 'trip'`.
- Tapping the line comes in Task 8.

**Files:**

- Modify: `packages/types/src/kinds/money.ts`, `packages/types/src/index.ts`
- Create: `packages/types/src/kinds/travel/meta.ts`, `packages/types/src/kinds/jobs/meta.ts`, `packages/types/src/kinds/meta.ts`
- Modify: `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/index.ts`, `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`
- Create: `tests/kind-meta.test.mjs`
- Modify: `tests/mobile-format.test.mjs`

**Interfaces:**

- Produces, from `@nexui/types`:
  - `formatMoney(money: Money): string`
  - `tripMeta(trip: Partial<TripData>): string`
  - `searchMeta(search: Partial<SearchData>): string`
  - `KIND_META: Record<AnchorKind, (anchor: GraphObject) => string>`
  - `interface AnchorMeta { objectId: string; kind: AnchorKind; text: string }`
  - `anchorMeta(snapshot: GraphSnapshot): AnchorMeta | null`
- `#lib` keeps exporting `formatMoney` (a re-export) and stops exporting `tripMeta`.

- [ ] **Step 1: Write the failing test**

Create `tests/kind-meta.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANCHOR_KINDS,
  anchorMeta,
  formatMoney,
  KIND_META,
  searchMeta,
  tripMeta,
} from '../packages/types/src/index.ts';
import { jobSnapshot, SEARCH_ID, searchData } from './support/jobs.mjs';

test('every anchor kind has a meta line', () => {
  assert.deepEqual(Object.keys(KIND_META).sort(), [...ANCHOR_KINDS].sort());
});

test("a trip's meta line names dates, travelers and pace", () => {
  assert.equal(
    tripMeta({ startDate: '2026-12-12', endDate: '2026-12-24', travelers: 2, pace: 'balanced' }),
    'Dec 12 – 24, 2 travelers, balanced pace',
  );
  assert.equal(tripMeta({ totalDays: 3, travelers: 1 }), '3 days, 1 traveler');
  assert.equal(tripMeta({}), '');
});

test("a search's meta line names its roles, where, and the pay floor", () => {
  assert.equal(
    searchMeta({ ...searchData, salaryFloor: { amount: 120_000, currency: 'GBP' } }),
    'Staff Product Manager · London or remote · £120k+',
  );
  assert.equal(
    searchMeta({
      ...searchData,
      roles: ['Staff PM', 'Senior PM', 'Lead PM'],
      locations: ['Remote (UK)'],
      workModes: ['remote'],
    }),
    'Staff PM or Senior PM +1 · Remote (UK)',
  );
  assert.equal(
    searchMeta({ ...searchData, locations: [], workModes: ['onsite'] }),
    'Staff Product Manager',
  );
});

test('a search with no roles yet has no meta line: its build run sets them', () => {
  assert.equal(searchMeta({ ...searchData, roles: [] }), '');
  assert.equal(anchorMeta(jobSnapshot({ search: { ...searchData, roles: [] } })), null);
});

test("the meta line is the anchor's, with its id and kind", () => {
  const snapshot = jobSnapshot();

  assert.deepEqual(anchorMeta(snapshot), {
    objectId: SEARCH_ID,
    kind: 'search',
    text: 'Staff Product Manager · London or remote',
  });
  assert.equal(anchorMeta({ ...snapshot, workspace: null }), null);
});

test('money reads short, as meta lines and cards show it', () => {
  assert.equal(formatMoney({ amount: 120_000, currency: 'GBP' }), '£120k');
  assert.equal(formatMoney({ amount: 950, currency: 'EUR' }), '€950');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/kind-meta.test.mjs`
Expected: FAIL, `SyntaxError: The requested module … does not provide an export named 'anchorMeta'`.

- [ ] **Step 3: Move `formatMoney` into `@nexui/types`**

Append to `packages/types/src/kinds/money.ts` (the body is mobile's `formatMoney`, unchanged):

```ts
const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  const cached = currencyFormats.get(key);

  if (cached) {
    return cached;
  }

  const created = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

  currencyFormats.set(key, created);

  return created;
}

/**
 * A short amount for a metric, a card or a plan's meta line. Callers add "≈" where the figure is
 * an estimate.
 *
 * @example
 * formatMoney({ amount: 3140, currency: 'USD' }) // '$3.1k'
 */
export function formatMoney(money: Money): string {
  const { amount, currency } = money;

  if (amount >= 1_000_000) {
    return `${currencyFormat(currency, 1).format(amount / 1_000_000)}m`;
  }

  if (amount >= 1_000) {
    return `${currencyFormat(currency, 1).format(amount / 1_000)}k`;
  }

  return currencyFormat(currency, 0).format(amount);
}
```

- [ ] **Step 4: Create the two meta lines and the registry**

Create `packages/types/src/kinds/travel/meta.ts`:

```ts
import { formatDateRange } from './figures.ts';
import type { TripData } from './schemas.ts';

/**
 * The line under a trip's title.
 *
 * @example
 * tripMeta({ startDate: '2026-12-12', endDate: '2026-12-24', travelers: 2, pace: 'balanced' })
 * // 'Dec 12 – 24, 2 travelers, balanced pace'
 */
export function tripMeta(trip: Partial<TripData>): string {
  const parts: string[] = [];

  if (trip.startDate && trip.endDate) {
    parts.push(formatDateRange(trip.startDate, trip.endDate));
  } else if (trip.totalDays) {
    parts.push(`${trip.totalDays} ${trip.totalDays === 1 ? 'day' : 'days'}`);
  }

  if (trip.travelers) {
    parts.push(`${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'}`);
  }

  if (trip.pace) {
    parts.push(`${trip.pace} pace`);
  }

  return parts.join(', ');
}
```

Create `packages/types/src/kinds/jobs/meta.ts`:

```ts
import { formatMoney } from '../money.ts';
import type { SearchData } from './schemas.ts';

// "A", "A or B", "A, B or C".
function either(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  const rest = items.slice(0, -1);

  return rest.length > 0 ? `${rest.join(', ')} or ${last}` : last;
}

/**
 * The line under a job search's title (spec section 3.2): its roles, where, and the pay floor.
 * Empty until the build run sets the roles.
 *
 * @example
 * searchMeta({ roles: ['Staff PM'], locations: ['London'], workModes: ['hybrid', 'remote'],
 *   salaryFloor: { amount: 120000, currency: 'GBP' } })
 * // 'Staff PM · London or remote · £120k+'
 */
export function searchMeta(search: Partial<SearchData>): string {
  const roles = search.roles ?? [];

  if (roles.length === 0) {
    return '';
  }

  const places = (search.locations ?? []).slice(0, 2);
  const remoteNamed = places.some((place) => place.toLowerCase().includes('remote'));

  if (search.workModes?.includes('remote') && !remoteNamed) {
    places.push('remote');
  }

  const more = roles.length > 2 ? ` +${roles.length - 2}` : '';
  const parts = [`${roles.slice(0, 2).join(' or ')}${more}`, either(places)];

  if (search.salaryFloor) {
    parts.push(`${formatMoney(search.salaryFloor)}+`);
  }

  return parts.filter((part) => part.length > 0).join(' · ');
}
```

Create `packages/types/src/kinds/meta.ts`:

```ts
import type { GraphObject, GraphSnapshot } from '../graph.ts';
import { anchorKindSchema, type AnchorKind } from './figures.ts';
import { searchMeta } from './jobs/meta.ts';
import type { SearchData } from './jobs/schemas.ts';
import { tripMeta } from './travel/meta.ts';
import type { TripData } from './travel/schemas.ts';

/** Each anchor kind's line under the plan's title (readiness doc, section 3.5). */
export const KIND_META: Record<AnchorKind, (anchor: GraphObject) => string> = {
  trip: (anchor) => tripMeta(anchor.data as Partial<TripData>),
  search: (anchor) => searchMeta(anchor.data as Partial<SearchData>),
};

/** A plan's meta line and the anchor it describes, which the line opens when it has a sheet. */
export interface AnchorMeta {
  objectId: string;
  kind: AnchorKind;
  text: string;
}

/**
 * The plan's meta line, or null for a plan with no anchor or nothing to say yet.
 *
 * @example
 * anchorMeta(snapshot) // { objectId: '…', kind: 'search', text: 'Staff PM · London or remote' }
 */
export function anchorMeta(snapshot: GraphSnapshot): AnchorMeta | null {
  const anchorId = snapshot.workspace?.doc.anchorId;
  const anchor = snapshot.objects.find((object) => object.id === anchorId);
  const kind = anchorKindSchema.safeParse(anchor?.kind);

  if (!anchor || !kind.success) {
    return null;
  }

  const text = KIND_META[kind.data](anchor);

  return text ? { objectId: anchor.id, kind: kind.data, text } : null;
}
```

In `packages/types/src/index.ts`, after `export * from './kinds/figures.ts';`, add:

```ts
export * from './kinds/travel/meta.ts';
export * from './kinds/jobs/meta.ts';
export * from './kinds/meta.ts';
```

- [ ] **Step 5: Point mobile at the shared formatter and meta line**

In `apps/mobile/src/lib/format.ts`:

- Delete `currencyFormats`, `currencyFormat`, `formatMoney` and `tripMeta`.
- In the `@nexui/types` import, drop `formatDateRange` and `type TripData`, and add `formatMoney`.
- Below the imports, add:

```ts
// Shared with the meta line in `@nexui/types`; cards and metrics read it from here.
export { formatMoney };
```

In `apps/mobile/src/lib/index.ts`, drop `tripMeta` from the export list. `formatMoney` stays exported from `./format.ts`.

In `tests/mobile-format.test.mjs`, delete the `tripMeta` import and the test `'the trip meta line names dates, travelers and pace'` (it moved to `kind-meta`).

- [ ] **Step 6: The workspace screen reads `anchorMeta`**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

- Replace `import type { GraphSnapshot, TripData } from '@nexui/types';` with `import { anchorMeta } from '@nexui/types';`.
- Delete `import { tripMeta } from '#lib';` and the local `function anchorMeta(…)`.
- In `renderBody`:

```tsx
const data = intent.data;
const meta = anchorMeta(data);
```

and in the header:

```tsx
{
  meta ? <Text style={styles.meta}>{meta.text}</Text> : null;
}
```

- [ ] **Step 7: Run the tests**

Run: `node --experimental-strip-types --test tests/kind-meta.test.mjs tests/mobile-format.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (696: six new, one moved).

- [ ] **Step 8: Commit**

Message: `Move the meta line into KIND_META, and add the search's`

```bash
git add packages/types/src apps/mobile/src/lib apps/mobile/src/app tests/kind-meta.test.mjs tests/mobile-format.test.mjs
git commit -F <message file>
```

---

### Task 2: Interview times, and a decision's per-day row from the cards

Carried item 6, and readiness doc 3.5's `decision-section.tsx` bullet.

- `KIND_CARDS` gains two formats: `dateTime`, for an interview's `at`, and `estimate`, for an amount marked "≈".
- It also gains `compare`: the rows a decision adds for an option's candidate.
- The decision primitive stops reading `PlaceData`.

**Files:**

- Modify: `packages/types/src/kinds/cards.ts`
- Modify: `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/index.ts`
- Modify: `apps/mobile/src/features/workspace/workspace-layout.ts`, `apps/mobile/src/features/workspace/sections/decision-section.tsx`
- Modify: `tests/kind-cards.test.mjs`, `tests/mobile-format.test.mjs`

**Interfaces:**

- Produces, from `@nexui/types`:
  - `FieldFormat` adds `'dateTime' | 'estimate'`.
  - `interface CompareField { field: string; label: string; format?: FieldFormat }`
  - `CardSpec.compare?: CompareField[]`
- Produces, from `#lib`:
  - `isDateOnly(at: string): boolean`
  - `formatDateTime(at: string, timeZone?: string): string`: "Fri, Oct 9, 2:00 PM", or "Wed, Oct 21" for a date
  - `formatTime(at: string, timeZone?: string): string`: "2:00 PM", or '' for a date
  - `formatDate(at: string, timeZone?: string): string`: "Sep 26"
- Changes: `DecisionOption` is `{ option: GraphObject; candidate: GraphObject | null }` (was `place`).

- [ ] **Step 1: Write the failing tests**

In `tests/mobile-format.test.mjs`, add `formatDate`, `formatDateTime`, `formatTime` and `isDateOnly` to the `lib/format.ts` import, then add:

```js
test('dates read with their time in the given zone; a date alone never moves a day', () => {
  assert.equal(formatDateTime('2026-10-09T13:00:00Z', 'Europe/London'), 'Fri, Oct 9, 2:00 PM');
  assert.equal(
    formatDateTime('2026-10-09T23:30:00-07:00', 'Europe/London'),
    'Sat, Oct 10, 7:30 AM',
  );
  assert.equal(formatDateTime('2026-10-21'), 'Wed, Oct 21');
  assert.equal(formatDateTime('not a date'), 'not a date');
  assert.equal(formatTime('2026-10-09T13:00:00Z', 'Europe/London'), '2:00 PM');
  assert.equal(formatTime('2026-10-21'), '');
  assert.equal(formatDate('2026-09-26T23:30:00Z', 'Europe/London'), 'Sep 27');
  assert.equal(formatDate('2026-09-26'), 'Sep 26');
  assert.deepEqual([isDateOnly('2026-10-21'), isDateOnly('2026-10-21T09:00:00Z')], [true, false]);
  assert.equal(formatField('2026-10-21', 'dateTime'), 'Wed, Oct 21');
  assert.equal(formatField({ amount: 120, currency: 'USD' }, 'estimate'), '≈ $120');
  assert.deepEqual(cardText(object('interview', { at: '2026-10-21', label: 'Phone screen' })), {
    title: 'Phone screen',
    subtitle: 'Wed, Oct 21',
  });
});
```

In `tests/kind-cards.test.mjs`, inside the loop over `KIND_CARDS`, after the subtitle loop, add:

```js
for (const line of card.compare ?? []) {
  assert.match(line.field, FIELD, kind);
}
```

and append:

```js
test("an interview's card shows its time, and a place compares its daily cost", () => {
  assert.deepEqual(KIND_CARDS.interview.subtitle, [{ field: 'data.at', format: 'dateTime' }]);
  assert.deepEqual(KIND_CARDS.place.compare, [
    { field: 'data.estDailyCost', label: 'Per day', format: 'estimate' },
  ]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/mobile-format.test.mjs tests/kind-cards.test.mjs`
Expected: FAIL, `formatDateTime` isn't exported, and the interview subtitle has no format.

- [ ] **Step 3: Add the formats and `compare` to the cards**

In `packages/types/src/kinds/cards.ts`, replace the `FieldFormat` and `CardSpec` declarations:

```ts
/**
 * How a field reads on a card or in a comparison. `dateTime` is a date with its time (an
 * interview's `at`); `estimate` is an amount marked "≈".
 */
export type FieldFormat = 'currency' | 'days' | 'hours' | 'text' | 'dateTime' | 'estimate';

/** A row a decision adds for an option's candidate object, such as a place's daily cost. */
export interface CompareField {
  field: string;
  label: string;
  format?: FieldFormat;
}

/** Which fields make up an object's card: a title and a one-line subtitle (spec section D). */
export interface CardSpec {
  title: string;
  subtitle: { field: string; format?: FieldFormat }[];
  /** Rows a decision compares across its options' candidates of this kind. */
  compare?: CompareField[];
}
```

Change two entries in `KIND_CARDS`:

```ts
  place: {
    title: 'data.name',
    subtitle: [{ field: 'data.days', format: 'days' }, { field: 'data.why' }],
    compare: [{ field: 'data.estDailyCost', label: 'Per day', format: 'estimate' }],
  },
```

```ts
  interview: { title: 'data.label', subtitle: [{ field: 'data.at', format: 'dateTime' }] },
```

- [ ] **Step 4: Format dates and estimates in the app**

In `apps/mobile/src/lib/format.ts`, add above `formatField`:

```ts
// Intl puts a narrow no-break space before AM and PM; cards use a plain one.
const NARROW_SPACE = / /g;

/** True for a date with no time, such as an interview "next Tuesday": `2026-10-21`. */
export function isDateOnly(at: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(at);
}

// A date-or-time as an instant and the zone to read it in: a date alone is noon UTC that day
// (as `interviewTime` counts it), read in UTC so it never moves a day.
function instant(at: string, timeZone?: string): { date: Date; timeZone?: string } | null {
  if (isDateOnly(at)) {
    return { date: new Date(`${at}T12:00:00Z`), timeZone: 'UTC' };
  }

  const time = Date.parse(at);

  return Number.isNaN(time) ? null : { date: new Date(time), timeZone };
}

function formatted(
  at: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const read = instant(at, timeZone);

  if (!read) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: read.timeZone })
    .format(read.date)
    .replace(NARROW_SPACE, ' ');
}

/**
 * A date and time for a card or a sheet, in the device's time zone unless one is given. A date
 * with no time shows the date alone. Anything unparsable shows as it is.
 *
 * @example
 * formatDateTime('2026-10-09T13:00:00Z', 'Europe/London') // 'Fri, Oct 9, 2:00 PM'
 * formatDateTime('2026-10-21') // 'Wed, Oct 21'
 */
export function formatDateTime(at: string, timeZone?: string): string {
  const day = { weekday: 'short', month: 'short', day: 'numeric' } as const;

  if (isDateOnly(at)) {
    return formatted(at, timeZone, day) ?? at;
  }

  return formatted(at, timeZone, { ...day, hour: 'numeric', minute: '2-digit' }) ?? at;
}

/** @example formatTime('2026-10-09T13:00:00Z', 'Europe/London') // '2:00 PM'; '' for a date */
export function formatTime(at: string, timeZone?: string): string {
  if (isDateOnly(at)) {
    return '';
  }

  return formatted(at, timeZone, { hour: 'numeric', minute: '2-digit' }) ?? '';
}

/** @example formatDate('2026-09-26T09:00:00Z') // 'Sep 26' */
export function formatDate(at: string, timeZone?: string): string {
  return formatted(at, timeZone, { month: 'short', day: 'numeric' }) ?? at;
}
```

In `formatField`, change the money and string branches:

```ts
if (isMoney(value)) {
  return format === 'estimate' ? `≈ ${formatMoney(value)}` : formatMoney(value);
}
```

```ts
if (typeof value === 'string') {
  return format === 'dateTime' ? formatDateTime(value) : value;
}
```

Add `formatDate`, `formatDateTime`, `formatTime` and `isDateOnly` to `apps/mobile/src/lib/index.ts`'s export list.

- [ ] **Step 5: The decision primitive reads candidates through `KIND_CARDS`**

In `apps/mobile/src/features/workspace/workspace-layout.ts`, replace `DecisionOption`:

```ts
export interface DecisionOption {
  option: GraphObject;
  /** The object the option would add (its `placeId`), if the graph has it. */
  candidate: GraphObject | null;
}
```

In `decisionData`, rename the result field:

```ts
return { option, candidate: place ?? null };
```

In `apps/mobile/src/features/workspace/sections/decision-section.tsx`:

- Change the `@nexui/types` import to `isKindName`, `KIND_CARDS`, `readField`, `type CompareField`, `type DecisionData`, `type GraphObject`, `type OptionData` and `type Section` (drop `PlaceData`).
- Drop `formatMoney` from the `#lib` import.
- Replace `decisionRows`:

```ts
// What a candidate's kind compares (`KIND_CARDS`), such as a place's daily cost.
function compareFields(candidate: GraphObject | null): CompareField[] {
  return candidate && isKindName(candidate.kind) ? (KIND_CARDS[candidate.kind].compare ?? []) : [];
}

// The section's fields, then every metric any option reports, then what the options'
// candidates compare. Rows where no option has a value are left out.
function decisionRows(fields: FieldSpec[], options: DecisionOption[]): ComparisonRow[] {
  const byField = fields.map((field) => ({
    label: field.label,
    cells: options.map((entry) => formatField(readField(entry.option, field.field), field.format)),
  }));
  const metricKeys = [
    ...new Set(
      options.flatMap((entry) => Object.keys((entry.option.data as OptionData).metrics ?? {})),
    ),
  ];
  const metrics = metricKeys.map((key) => ({
    label: humanizeKey(key),
    cells: options.map((entry) => formatField((entry.option.data as OptionData).metrics[key])),
  }));
  const compared = new Map(
    options.flatMap((entry) => compareFields(entry.candidate)).map((field) => [field.field, field]),
  );
  const candidates = [...compared.values()].map((field) => ({
    label: field.label,
    cells: options.map((entry) =>
      entry.candidate ? formatField(readField(entry.candidate, field.field), field.format) : '—',
    ),
  }));

  return [...byField, ...metrics, ...candidates].filter((row) =>
    row.cells.some((cell) => cell !== '—'),
  );
}
```

In `DecisionSection`'s `columns`, change the photo line to:

```ts
    photo: candidatePhoto(entry.candidate ? photos[entry.candidate.id] : undefined),
```

Then run `grep -rn "\.place\b" tests/mobile-workspace-layout.test.mjs apps/mobile/src/features/workspace`. Any decision test or code still reading an option's `.place` reads `.candidate` now. One is known: the decision test in `tests/mobile-workspace-layout.test.mjs` that reads `entry.place` (line 109 at `1468204`) reads `entry.candidate`. A route stop's `stop.place` is a different type and stays.

- [ ] **Step 6: Run the tests**

Run: `node --experimental-strip-types --test tests/mobile-format.test.mjs tests/kind-cards.test.mjs tests/mobile-workspace-layout.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (698).

- [ ] **Step 7: Commit**

Message: `Show interview times on cards, and compare a candidate's daily cost through KIND_CARDS`

```bash
git add packages/types/src/kinds/cards.ts apps/mobile/src tests/mobile-format.test.mjs tests/kind-cards.test.mjs
git commit -F <message file>
```

---

### Task 3: Job search's example, its intake, and the shared upload limit

Spec sections 2 and 4, and carried item 3.

- `TEMPLATE_EXAMPLES.job_search` is filled in, so the + sheet offers a job search goal.
- `TEMPLATE_INTAKES` gives the resume step its copy and tells whether a plan has started.
- `intakeRoute` answers `start` or `resume` from that.
- `MAX_UPLOAD_BYTES` moves to `@nexui/types`, so the app refuses a big file before sending it.

**Files:**

- Create: `packages/types/src/kinds/jobs/intake.ts`
- Modify: `packages/types/src/templates.ts`, `packages/types/src/api.ts`, `packages/types/src/index.ts`
- Modify: `apps/api/src/lib/http/upload.ts`, `apps/api/src/lib/http/index.ts`
- Create: `tests/template-intakes.test.mjs`
- Modify: `tests/mobile-goal-examples.test.mjs`

**Interfaces:**

- Produces, from `@nexui/types`:
  - `TemplateExample` gains `one: string` ("a job search") and `short: string` ("search").
  - `interface TemplateIntake { planning; title; detail; add; skip; note; reading; unreadable: string; started(context): boolean }`
  - `TEMPLATE_INTAKES: Record<Template, TemplateIntake | null>`
  - `intakeRoute(intent: Pick<IntentRecord, 'template' | 'context'>): 'start' | 'resume' | null`
  - `jobSearchStarted(context: Readonly<Record<string, unknown>>): boolean`
  - `MAX_UPLOAD_BYTES` (4 MB)
- `#lib/http` stops exporting `MAX_UPLOAD_BYTES`. Nothing outside `upload.ts` uses it.

- [ ] **Step 1: Write the failing tests**

Create `tests/template-intakes.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  intakeRoute,
  jobSearchStarted,
  MAX_UPLOAD_BYTES,
  TEMPLATE_EXAMPLES,
  TEMPLATE_INTAKES,
  templateSchema,
} from '../packages/types/src/index.ts';

const STAMP = '2026-10-11T09:00:00.000Z';

test('every template has an intake entry, and only a job search asks for a document', () => {
  assert.deepEqual(Object.keys(TEMPLATE_INTAKES).sort(), [...templateSchema.options].sort());
  assert.equal(TEMPLATE_INTAKES.travel, null);
  assert.equal(TEMPLATE_INTAKES.job_search.title, 'Add your resume?');
  assert.equal(TEMPLATE_INTAKES.job_search.add, 'Add resume (PDF)');
});

test('an upload starts a job search until its build is queued, then replaces the resume', () => {
  const plan = (context) => ({ template: 'job_search', context });

  assert.equal(intakeRoute(plan({ jobs: { timezone: 'Europe/London', seen: [] } })), 'start');
  assert.equal(
    intakeRoute(plan({ jobs: { timezone: 'Europe/London', startedAt: STAMP, seen: [] } })),
    'resume',
  );
  assert.equal(intakeRoute(plan({})), 'start');
  assert.equal(intakeRoute({ template: 'travel', context: {} }), null);
  assert.equal(intakeRoute({ template: null, context: {} }), null);
  assert.equal(jobSearchStarted({ jobs: { startedAt: '' } }), false);
});

test('every template names its plans for the + sheet, and uploads stop at 4 MB', () => {
  for (const example of Object.values(TEMPLATE_EXAMPLES)) {
    assert.ok(example.plans && example.one && example.short && example.goal);
  }

  assert.equal(TEMPLATE_EXAMPLES.job_search.one, 'a job search');
  assert.equal(MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
});
```

In `tests/mobile-goal-examples.test.mjs`, replace the last test:

```js
test('the + sheet offers every template the API plans: trips and job searches', () => {
  assert.deepEqual(
    GOAL_EXAMPLES,
    Object.values(TEMPLATE_EXAMPLES).filter((example) => example !== null),
  );
  assert.equal(plansToday(GOAL_EXAMPLES), 'Today Nexui plans trips and job searches.');
  assert.equal(nextGoalPlaceholder(), 'A week in Lisbon in May');
  assert.equal(nextGoalPlaceholder(), 'Find a senior designer role in Berlin');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/template-intakes.test.mjs tests/mobile-goal-examples.test.mjs`
Expected: FAIL, missing exports, and `plansToday` still says only trips.

- [ ] **Step 3: Read whether a job search has started**

Create `packages/types/src/kinds/jobs/intake.ts`:

```ts
import { z } from 'zod';

// What the app reads of a job search's `context.jobs`: only whether `start` has queued its
// build. The API owns the rest (`apps/api/src/lib/jobs/context.ts`).
const startedSchema = z.object({ jobs: z.object({ startedAt: z.string().min(1) }) });

/**
 * True once `POST /api/intents/[id]/start` has queued a job search's build run.
 *
 * @example
 * jobSearchStarted({ jobs: { timezone: 'UTC', seen: [] } }) // false
 */
export function jobSearchStarted(context: Readonly<Record<string, unknown>>): boolean {
  return startedSchema.safeParse(context).success;
}
```

- [ ] **Step 4: Examples, intakes and the route**

Replace `packages/types/src/templates.ts` with:

```ts
import type { IntentRecord, Template } from './graph.ts';
import { jobSearchStarted } from './kinds/jobs/intake.ts';

/** How the app names a template's plans, and a goal that starts one. */
export interface TemplateExample {
  /** Its plans, plural, as they read in a sentence: "trips". */
  plans: string;
  /** One plan with its article: "a trip". */
  one: string;
  /** The plan in a button's few words: "trip", as in "Open my trip". */
  short: string;
  /** An example goal, for the + sheet's placeholder and its "Try one" buttons. */
  goal: string;
}

/**
 * Every template's example, in the order the + sheet offers them, or null for a template whose
 * app side hasn't shipped. A template `templateSchema` lists without an entry fails typecheck, so
 * the app never offers a template it can't show.
 */
export const TEMPLATE_EXAMPLES: Record<Template, TemplateExample | null> = {
  travel: { plans: 'trips', one: 'a trip', short: 'trip', goal: 'A week in Lisbon in May' },
  job_search: {
    plans: 'job searches',
    one: 'a job search',
    short: 'search',
    goal: 'Find a senior designer role in Berlin',
  },
};

/**
 * A template that reads a document before its first run (job search spec, section 4): the + sheet's
 * step copy, and how the app tells the plan has started.
 */
export interface TemplateIntake {
  /** Above the step: "Planning this as a job search". */
  planning: string;
  title: string;
  detail: string;
  /** The button that picks a file. */
  add: string;
  /** The button that starts with none. */
  skip: string;
  /** Under the buttons. */
  note: string;
  /** While the file is read. */
  reading: string;
  /** In + when the plan started without the file it was sent. */
  unreadable: string;
  /** True once the plan's first run was queued: a new file then replaces the one it has. */
  started: (context: Readonly<Record<string, unknown>>) => boolean;
}

/** Each template's intake, or null for one that starts at once. */
export const TEMPLATE_INTAKES: Record<Template, TemplateIntake | null> = {
  travel: null,
  job_search: {
    planning: 'Planning this as a job search',
    title: 'Add your resume?',
    detail:
      "Nexui uses it to screen roles and tailor your drafts. It reads the PDF once and doesn't " +
      'keep the file.',
    add: 'Add resume (PDF)',
    skip: 'Continue without',
    note: 'Without it, Nexui searches on your goal alone. You can add it later from the plan.',
    reading: 'Reading your resume…',
    unreadable: "Couldn't read that PDF. Nexui started without it; add another from the plan.",
    started: jobSearchStarted,
  },
};

/**
 * Where a plan's upload goes: `start` before its first run, `resume` after, or null for a
 * template that takes no document.
 *
 * @example
 * intakeRoute({ template: 'job_search', context: { jobs: { startedAt: '…' } } }) // 'resume'
 */
export function intakeRoute(
  intent: Pick<IntentRecord, 'template' | 'context'>,
): 'start' | 'resume' | null {
  const intake = intent.template ? TEMPLATE_INTAKES[intent.template] : null;

  if (!intake) {
    return null;
  }

  return intake.started(intent.context) ? 'resume' : 'start';
}
```

In `packages/types/src/index.ts`, after `export * from './kinds/jobs/meta.ts';`, add `export * from './kinds/jobs/intake.ts';`.

In `packages/types/src/api.ts`, above `startResponseSchema`, add:

```ts
/** The largest file `start` and `resume` take: under Vercel's 4.5 MB body limit (spec section 4). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
```

- [ ] **Step 5: The API reads the shared limit**

In `apps/api/src/lib/http/upload.ts`, delete `export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;` and import it in the `@nexui/types` group: `import { MAX_UPLOAD_BYTES } from '@nexui/types';`. Keep the comment above the old line, moved onto the import if it explains the limit.

In `apps/api/src/lib/http/index.ts`, change the upload line to `export { readUpload } from './upload.ts';`.

Run `grep -rn "MAX_UPLOAD_BYTES" apps/api/src tests`. Only `upload.ts` should print.

- [ ] **Step 6: Run the tests**

Run: `node --experimental-strip-types --test tests/template-intakes.test.mjs tests/mobile-goal-examples.test.mjs tests/http-helpers.test.mjs tests/start-route.test.mjs tests/resume-route.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (701).

- [ ] **Step 7: Commit**

Message: `Offer job search in the + sheet, and share its intake copy and upload limit`

```bash
git add packages/types/src apps/api/src/lib/http tests/template-intakes.test.mjs tests/mobile-goal-examples.test.mjs
git commit -F <message file>
```

---

### Task 4: Renamable roles, `object.update` for the app, and `jobs.forgetPass`

Decisions 2 and 3, and carried item 5. Three changes:

- **`object.update` becomes user-callable.** Its kind checks and read-only fields bind the app as they bind models.
- **A role becomes editable,** with its code-owned fields read-only and its object title following `data.title` (`KindBehaviour.nameField`).
- **A new user-only `jobs.forgetPass`** drops one pass reason.

The doc that says `object.update` refuses a role is corrected.

**Files:**

- Modify: `apps/api/src/lib/kinds/behaviour.ts`, `apps/api/src/lib/capabilities/graph.ts`, `apps/api/src/lib/jobs/roles.ts`
- Modify: `docs/architecture/intent-graph.md`
- Modify: `tests/jobs-capabilities.test.mjs`, `tests/kind-behaviour.test.mjs`, `tests/capabilities-route.test.mjs`
- Regenerate: `tests/support/travel-model-surface.json`, `tests/support/job-search-model-surface.json`

**Interfaces:**

- Produces:
  - `KindBehaviour.nameField?: string`: the data field the object's title follows (default `'name'`).
  - `object.update` with `callableByUser: true`.
  - `jobs.forgetPass`, input `{ at: timestamp }`, `exposeToModel: false`, `callableByUser: true`, label `` `Removed “${reasonLabel}” for ${company}` ``.
- Consumed by:
  - Task 13 (Rename): `{ name: 'object.update', input: { ref: roleId, data: { title } } }`.
  - Task 15 (criteria): `{ name: 'object.update', input: { ref: searchId, data: { … } } }`.
  - Task 15 (a pass reason): `{ name: 'jobs.forgetPass', input: { at } }`.

- [ ] **Step 1: Write the failing tests**

In `tests/jobs-capabilities.test.mjs`, append:

```js
test("a user renames a role through object.update; what code stamped stays code's", () => {
  const plan = planWith({ role: roleData({ title: 'Role', stage: 'interviewing' }) });
  const s = stager(plan, 'user');

  s.call('object.update', { ref: ROLE_ID, data: { title: 'Staff PM, Lending' } });

  const role = s.graph().objects.find((object) => object.id === ROLE_ID);

  assert.deepEqual(
    [role.title, role.data.title, role.data.stage],
    ['Staff PM, Lending', 'Staff PM, Lending', 'interviewing'],
  );
  assert.throws(
    () =>
      s.call('object.update', {
        ref: ROLE_ID,
        data: { stage: 'offer', url: 'https://apply.example.net/1' },
      }),
    refused(/^url and stage can't be changed this way\.$/),
  );
  commitsAsOne(plan, s);
});

test('forgetting a pass removes that reason only', () => {
  const passes = [
    {
      reason: 'too_junior',
      company: 'Northbeam',
      title: 'Lead PM, Risk',
      at: '2026-10-12T09:00:00.000Z',
    },
    {
      reason: 'not_this_company',
      company: 'Pennant',
      title: 'Senior PM',
      at: '2026-10-13T09:00:00.000Z',
    },
  ];
  const plan = planWith({ search: { ...searchData, passReasons: passes } });
  const s = stager(plan, 'user');

  s.call('jobs.forgetPass', { at: passes[0].at });

  assert.deepEqual(dataOf(s, SEARCH_ID).passReasons, [passes[1]]);
  assert.equal(s.takeEntries().at(-1).label, 'Removed “Too junior” for Northbeam');
  assert.throws(
    () => s.call('jobs.forgetPass', { at: passes[0].at }),
    refused(/^That pass reason is already gone\.$/),
  );
});
```

In the same file's flags test (`'buttons may add, move, pass, log contact and pause; …'`):

- rename it to `'buttons may add, move, pass, forget a pass, log contact, pause and edit; only models add interviews and drafts'`;
- add `'jobs.forgetPass': [false, true],` after `'jobs.pass'`;
- add `'object.update': [true, true],` at the end of `expected`.

In `tests/kind-behaviour.test.mjs`, append:

```js
test("a role is renamable, its title follows data.title, and what jobs.* stamps is code's", () => {
  assert.equal(KIND_BEHAVIOUR.opportunity.editable, true);
  assert.equal(KIND_BEHAVIOUR.opportunity.nameField, 'title');
  assert.deepEqual(KIND_BEHAVIOUR.opportunity.readOnlyFields, [
    'url',
    'source',
    'fit',
    'postedAt',
    'lastSeenLiveAt',
    'postingClosedAt',
    'stage',
    'outcome',
    'appliedAt',
    'lastContactAt',
    'followUps',
  ]);
});
```

In `tests/capabilities-route.test.mjs`, append:

```js
test('the app may change an object through object.update, with its kind’s checks', async (t) => {
  const applied = graph(t);
  const response = await press({
    name: 'object.update',
    input: { ref: TOKYO_ID, data: { why: 'Ramen' } },
  });

  assert.equal(response.status, 200);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].p_ops[0].patch, { data: { ...tokyoData, why: 'Ramen' } });
  assert.equal(applied[0].p_payload.label, 'Updated Tokyo');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/jobs-capabilities.test.mjs tests/kind-behaviour.test.mjs tests/capabilities-route.test.mjs`
Expected: FAIL:

- the rename test, with `Role can't be edited this way.` (a role isn't editable, and the fixture's title is `Role`). The stager doesn't check `callableByUser`, so this is the kind check failing, not the flag;
- the forget test, with `That action isn't available.` from the stager (no `jobs.forgetPass` yet);
- the flags test, which expects `jobs.forgetPass` and a user-callable `object.update`;
- the kind-behaviour test (`editable` is `false`, and there is no `nameField`);
- the route test, with `That action isn't available.` (400). Only `invokeCapability` checks `callableByUser`, so this is the one failure the flag causes.

- [ ] **Step 3: Roles are editable, and name their title field**

In `apps/api/src/lib/kinds/behaviour.ts`, add to `KindBehaviour` after `readOnlyFields`:

```ts
  /**
   * The data field the object's title follows when `object.update` changes it, as a place's title
   * follows `name` (the default). A role's is `title`.
   */
  nameField?: string;
```

Replace the `opportunity` entry and its comment:

```ts
  // Roles are added and moved by `jobs.*`, which link them to their company and stamp dates; a
  // user (or a model, when asked) may rename one or correct where it is (Decision 2).
  opportunity: {
    creatable: false,
    editable: true,
    positioned: false,
    links: [],
    nameField: 'title',
    readOnlyFields: [
      'url',
      'source',
      'fit',
      'postedAt',
      'lastSeenLiveAt',
      'postingClosedAt',
      'stage',
      'outcome',
      'appliedAt',
      'lastContactAt',
      'followUps',
    ],
    plural: 'roles',
    modelHelp:
      'title (the role as the user names it), location?, workMode? (remote|hybrid|onsite), ' +
      'salary? {min?, max?, currency}. Stages, dates, links and fit are set by the jobs tools.',
  },
```

- [ ] **Step 4: `object.update` is the app's too, and follows `nameField`**

In `apps/api/src/lib/capabilities/graph.ts`, in `objectUpdate`:

- Set `callableByUser: true` and add the comment `// The app's renames and criteria edits. A user can already write any object through POST /changesets; this adds the kind's checks.`
- Replace the title-follows block:

```ts
patch.data = { ...object.data, ...changes };

// The title follows the kind's name field (a place's `name`, a role's `title`) while
// they match.
const nameField = behaviour.nameField ?? 'name';
const name = changes[nameField];

if (typeof name === 'string' && object.title === object.data[nameField]) {
  patch.title = name;
}
```

- [ ] **Step 5: `jobs.forgetPass`**

In `apps/api/src/lib/jobs/roles.ts`, add `PASS_REASONS` to the `@nexui/types` import. Above `ROLE_CAPABILITIES`, add:

```ts
const forgetPass = defineCapability({
  name: 'jobs.forgetPass',
  description: 'Remove one pass reason, by when it was given, so the scans stop learning from it.',
  input: z.strictObject({ at: timestampSchema }),
  policy: 'internal',
  exposeToModel: false,
  callableByUser: true,
  execute(input, ctx) {
    const search = searchOf(ctx);
    const entry = search.data.passReasons.find((pass) => pass.at === input.at);

    if (!entry) {
      throw new CapabilityError('That pass reason is already gone.');
    }

    const reason =
      PASS_REASONS.find((option) => option.value === entry.reason)?.label ?? entry.reason;
    const passReasons = search.data.passReasons.filter((pass) => pass !== entry);

    return {
      output: {},
      ops: [
        {
          op: 'update_object',
          id: search.object.id,
          patch: { data: { ...search.data, passReasons } },
          origin: 'direct',
        },
      ],
      label: `Removed “${reason}” for ${entry.company}`,
    };
  },
});
```

and change the export:

```ts
/** The capabilities that add a role, move it along, and forget why one was passed. */
export const ROLE_CAPABILITIES: readonly Capability[] = [
  addRole,
  setStage,
  pass,
  forgetPass,
  logContact,
];
```

- [ ] **Step 6: Correct the doc**

In `docs/architecture/intent-graph.md`, replace the sentence ending "`object.update` refuses a role, the resume and the search's bookkeeping." with:

```md
Of job search's kinds only companies and people are creatable through `object.create`; roles are added and moved by `jobs.*`, which link them to their company and stamp their dates. `object.update` may rename a role or correct where it is, and refuses the fields `jobs.*` owns (its URL, source, fit, stage, outcome and dates), the resume and the search's bookkeeping. The app calls `object.update` too, for renames and criteria, with the same checks.
```

- [ ] **Step 7: Regenerate what models see, and review it**

Run: `node --experimental-strip-types tests/support/model-surface.mjs`
Then run: `pnpm exec prettier --write tests/support/*.json`
Then run: `git diff --stat tests/support`

Expected diff, in both files:

- `object.update`'s `callableByUser` flips to `true`.

In the job search file only:

- `object.update`'s description names roles among its parts;
- `jobs.forgetPass` appears after `jobs.pass` with `exposeToModel: false`.

Nothing else should change. Anything else is a bug: stop and report it.

- [ ] **Step 8: Run the tests**

Run: `node --experimental-strip-types --test tests/jobs-capabilities.test.mjs tests/kind-behaviour.test.mjs tests/capabilities-route.test.mjs tests/model-surface.test.mjs tests/jobs-template.test.mjs tests/capabilities-graph.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (705).

Before committing, `git status` should show nothing under `apps/api/next-env.d.ts`. If `next dev` touched it, restore it: `git checkout -- apps/api/next-env.d.ts`.

- [ ] **Step 9: Commit**

Message: `Let the app rename a role and edit a search through object.update, and forget a pass`

```bash
git add apps/api/src docs/architecture/intent-graph.md tests/jobs-capabilities.test.mjs tests/kind-behaviour.test.mjs tests/capabilities-route.test.mjs tests/support/travel-model-surface.json tests/support/job-search-model-surface.json
git commit -F <message file>
```

---

### Task 5: The change feed reads labels, not kinds

Readiness doc 3.4, the mobile half (Decision 8). Since PR 1, every changeset's event carries `payload.label` (the capability's label, `Edited the plan` for a raw changeset, a run step's first label) and `payload.figures` (`{ label, before, after }` per anchor figure the derivation moved). The feed shows them and drops the trip sentences it rebuilt from ops.

- Undo and Redo events carry no payload. They already show only as the state of the row they reverted.

**Files:**

- Modify: `apps/mobile/src/features/changes/change-feed.ts`, `apps/mobile/src/features/changes/change-row.tsx`
- Modify: `tests/mobile-change-feed.test.mjs`

**Interfaces:**

- Changes: `ChangeRow.text` is a whole sentence (`Set Tokyo to 3 days`, `Unallocated days`); `ChangeRow.diff` is `{ before: string; after: string } | null` (no `unit`). `buildChangeRows`, `filterRows` and `groupByDay` keep their signatures.

- [ ] **Step 1: Rewrite the tests around payloads**

Replace `tests/mobile-change-feed.test.mjs` with:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChangeRows,
  filterRows,
  groupByDay,
} from '../apps/mobile/src/features/changes/change-feed.ts';

const event = (id, actor, payload = {}, extra = {}) => ({
  id,
  intentId: 'a1b2c3d4-0000-4000-8000-000000000001',
  seq: 1,
  type: 'changeset',
  actor,
  runId: null,
  revertsEventId: null,
  revertedByEventId: null,
  ops: [],
  payload,
  intentGoal: 'Japan in December',
  createdAt: '2026-09-30T10:00:00Z',
  ...extra,
});
const op = (name, id, origin = 'direct') => ({
  op: name,
  table: 'objects',
  id,
  before: {},
  after: {},
  origin,
});
const shortenTokyo = (extra = {}) =>
  event(
    'e1',
    'user',
    {
      label: 'Set Tokyo to 3 days',
      figures: [{ label: 'unallocated days', before: '0', after: '1' }],
    },
    extra,
  );

test('a change reads as its label, with each figure it moved tied to it', () => {
  const rows = buildChangeRows([shortenTokyo()]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text, row.diff, row.revert, row.undone]),
    [
      ['You', 'Set Tokyo to 3 days', null, { label: 'Undo', eventId: 'e1' }, false],
      ['Auto-calculated', 'Unallocated days', { before: '0', after: '1' }, null, false],
    ],
  );
  assert.equal(rows[1].actor, 'derived');
});

test('an undone change is struck through and offers Redo on its Undo event', () => {
  const undo = event('u1', 'user', {}, { revertsEventId: 'e1' });
  const rows = buildChangeRows([undo, shortenTokyo({ revertedByEventId: 'u1' })]);

  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].undone, rows[0].revert], [true, { label: 'Redo', eventId: 'u1' }]);
  assert.equal(rows[1].undone, true);
});

test('after Undo then Redo the change is live again and Undo targets the Redo', () => {
  const redo = event('r1', 'user', {}, { revertsEventId: 'u1' });
  const undo = event('u1', 'user', {}, { revertsEventId: 'e1', revertedByEventId: 'r1' });
  const rows = buildChangeRows([redo, undo, shortenTokyo({ revertedByEventId: 'u1' })]);

  assert.deepEqual(
    [rows[0].eventId, rows[0].undone, rows[0].revert],
    ['e1', false, { label: 'Undo', eventId: 'r1' }],
  );
});

test('an undone change whose Undo is on a later page still offers Redo', () => {
  const rows = buildChangeRows([shortenTokyo({ revertedByEventId: 'u-elsewhere' })]);

  assert.deepEqual(rows[0].revert, { label: 'Redo', eventId: 'u-elsewhere' });
});

test("a job search's changes read as their labels, never as their kinds", () => {
  const rows = buildChangeRows([
    event('e2', 'user', {
      label: 'Moved Staff PM, Payments to Interested',
      figures: [
        { label: 'new roles', before: '3', after: '2' },
        { label: 'roles in play', before: '1', after: '2' },
      ],
    }),
    event('e3', 'ai', { label: 'Found 2 new roles' }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text]),
    [
      ['You', 'Moved Staff PM, Payments to Interested'],
      ['Auto-calculated', 'New roles'],
      ['Auto-calculated', 'Roles in play'],
      ['Nexui', 'Found 2 new roles'],
    ],
  );
});

test('a change with no label reads plainly, and the first event names the plan', () => {
  const rows = buildChangeRows([
    event('e4', 'system'),
    event('e5', 'user', {}, { ops: [op('update_object', 'o1'), op('update_object', 'o2')] }),
    event('e6', 'ai', { figures: [{ label: 'total days', before: null, after: '8' }] }),
    event('e7', 'user', { label: 42 }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.who, row.text, row.diff, row.revert?.label ?? null]),
    [
      ['You', 'Started “Japan in December”', null, null],
      ['You', 'Made 2 changes', null, 'Undo'],
      ['Nexui', 'Made a change', null, 'Undo'],
      ['Auto-calculated', 'Total days', { before: '—', after: '8' }, null],
      ['You', 'Made a change', null, 'Undo'],
    ],
  );
});

test('filters keep one actor, and Auto-calculated keeps only derived rows', () => {
  const rows = buildChangeRows([shortenTokyo(), event('e8', 'ai', { label: 'Added Kyoto' })]);

  assert.deepEqual(
    filterRows(rows, 'you').map((row) => row.key),
    ['e1'],
  );
  assert.deepEqual(
    filterRows(rows, 'nexui').map((row) => row.key),
    ['e8'],
  );
  assert.deepEqual(
    filterRows(rows, 'auto').map((row) => row.key),
    ['e1:0'],
  );
  assert.equal(filterRows(rows, 'all').length, 3);
});

test('rows group under Today and Yesterday in order', () => {
  const now = new Date(2026, 8, 30, 12);
  const at = (date) => date.toISOString();
  const rows = buildChangeRows([
    event('a', 'ai', { label: 'Added Kyoto' }, { createdAt: at(new Date(2026, 8, 30, 9)) }),
    event('b', 'ai', { label: 'Added Tokyo' }, { createdAt: at(new Date(2026, 8, 29, 20)) }),
  ]);

  assert.deepEqual(
    groupByDay(rows, now).map((group) => [group.label, group.rows.map((row) => row.key)]),
    [
      ['Today', ['a']],
      ['Yesterday', ['b']],
    ],
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/mobile-change-feed.test.mjs`
Expected: FAIL. The feed still builds sentences from ops (`'made a change'`), and diffs carry `unit`.

- [ ] **Step 3: Rewrite the feed**

Replace `apps/mobile/src/features/changes/change-feed.ts` with:

```ts
import { changesetPayloadSchema, type ChangeItem, type ChangesetPayload } from '@nexui/types';

import { capitalize, dayLabel } from '#lib';

export type ChangeFilter = 'all' | 'you' | 'nexui' | 'auto';

export type RowActor = 'user' | 'ai' | 'derived';

export interface ChangeRow {
  key: string;
  eventId: string;
  intentId: string | null;
  actor: RowActor;
  who: string;
  /** What happened, as a sentence: the change's label, or the name of a figure it moved. */
  text: string;
  diff: { before: string; after: string } | null;
  intentGoal: string | null;
  createdAt: string;
  undone: boolean;
  /**
   * The event to revert: the change itself (Undo), or the latest Undo or Redo in its chain.
   * Null for derived rows, which undo with the edit that caused them, and for the create event.
   */
  revert: { label: 'Undo' | 'Redo'; eventId: string } | null;
}

const WHO: Record<RowActor, string> = { user: 'You', ai: 'Nexui', derived: 'Auto-calculated' };

// An event's label and figures. One the app can't read counts as neither.
function payloadOf(item: ChangeItem): ChangesetPayload {
  const parsed = changesetPayloadSchema.safeParse(item.payload);

  return parsed.success ? parsed.data : {};
}

// The main row's sentence: the plan's start, the stored label, or how much changed.
function sentence(item: ChangeItem, payload: ChangesetPayload): string {
  if (item.actor === 'system') {
    return `Started “${item.intentGoal ?? 'a plan'}”`;
  }

  if (payload.label) {
    return payload.label;
  }

  const direct = (item.ops ?? []).filter((op) => op.origin === 'direct').length;

  return direct > 1 ? `Made ${direct} changes` : 'Made a change';
}

// Follows Undo → Redo → Undo … An odd number of reverts means the change is undone now, and
// the last event in the chain is the one to revert next.
function revertState(
  item: ChangeItem,
  byId: Map<string, ChangeItem>,
): { undone: boolean; target: string } {
  let target = item.id;
  let reverts = 0;
  let next = item.revertedByEventId;

  while (next && reverts < 100) {
    reverts += 1;
    target = next;
    next = byId.get(next)?.revertedByEventId ?? null;
  }

  return { undone: reverts % 2 === 1, target };
}

function actorOf(item: ChangeItem): RowActor {
  if (item.actor === 'ai') {
    return 'ai';
  }

  return item.actor === 'derived' ? 'derived' : 'user';
}

/**
 * The Changes feed's rows, newest first: one per changeset, reading its stored label, plus one
 * per figure its derivation moved. Undo and Redo events show only as the state of the row they
 * reverted. No row reads an object's kind (readiness doc, section 3.4).
 */
export function buildChangeRows(items: readonly ChangeItem[]): ChangeRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return items
    .filter((item) => item.type === 'changeset' && item.revertsEventId === null)
    .flatMap((item) => {
      const { undone, target } = revertState(item, byId);
      const actor = actorOf(item);
      const payload = payloadOf(item);
      const main: ChangeRow = {
        key: item.id,
        eventId: item.id,
        intentId: item.intentId,
        actor,
        who: WHO[actor],
        text: sentence(item, payload),
        diff: null,
        intentGoal: item.intentGoal,
        createdAt: item.createdAt,
        undone,
        revert:
          item.actor === 'system' ? null : { label: undone ? 'Redo' : 'Undo', eventId: target },
      };
      const figures = item.actor === 'system' ? [] : (payload.figures ?? []);

      return [
        main,
        ...figures.map((figure, index): ChangeRow => ({
          ...main,
          key: `${item.id}:${index}`,
          actor: 'derived',
          who: WHO.derived,
          text: capitalize(figure.label),
          diff: { before: figure.before ?? '—', after: figure.after ?? '—' },
          revert: null,
        })),
      ];
    });
}

const FILTER_ACTOR: Record<Exclude<ChangeFilter, 'all'>, RowActor> = {
  you: 'user',
  nexui: 'ai',
  auto: 'derived',
};

export function filterRows(rows: readonly ChangeRow[], filter: ChangeFilter): ChangeRow[] {
  if (filter === 'all') {
    return [...rows];
  }

  return rows.filter((row) => row.actor === FILTER_ACTOR[filter]);
}

/** Consecutive rows under "Today", "Yesterday" or a date. */
export function groupByDay(
  rows: readonly ChangeRow[],
  now: Date,
): { label: string; rows: ChangeRow[] }[] {
  const groups: { label: string; rows: ChangeRow[] }[] = [];

  for (const row of rows) {
    const label = dayLabel(row.createdAt, now);
    const last = groups.at(-1);

    if (last?.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }

  return groups;
}
```

- [ ] **Step 4: The row shows the sentence, and who in the meta line**

In `apps/mobile/src/features/changes/change-row.tsx`:

- Delete `const unit = …`.
- Replace the meta line's computation and the body's two `Text`s:

```tsx
const meta = [
  row.undone ? 'Undone' : null,
  row.who,
  row.intentGoal,
  formatRelative(row.createdAt, now),
]
  .filter(Boolean)
  .join(' · ');
```

```tsx
        <Text style={[styles.sentence, row.undone && styles.undone]}>
          {row.text}
          {row.diff ? (
            <Text style={styles.diff}>
              {' '}
              {row.diff.before} → {row.diff.after}
            </Text>
          ) : null}
        </Text>
        <Text style={styles.meta}>{meta}</Text>
```

- Change the revert button's `accessibilityLabel` to `` `${revert.label}: ${row.text}` ``.
- Delete the now-unused `who` style.
- Update the component's doc comment to: "One change: its sentence (with before → after for a figure), then who, which plan and when. In Changes it carries Undo or Redo; a derived row instead says it undoes with the edit that caused it."

- [ ] **Step 5: Run the tests**

Run: `node --experimental-strip-types --test tests/mobile-change-feed.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (705).

- [ ] **Step 6: Commit**

Message: `Show each change's stored label and figures in Changes`

```bash
git add apps/mobile/src/features/changes tests/mobile-change-feed.test.mjs
git commit -F <message file>
```

---

### Task 6: Capability-shaped `WorkspaceAction`

Readiness doc 3.5 item 1 (Decision 5). `WorkspaceAction` loses its trip members (`setDays`, `move`, `openPlace`) and the decision one (`resolveDecision`). A primitive builds the capability request and its optimistic ops itself:

- the route uses `daysAction` and `moveAction`;
- a decision uses `resolveAction`;
- an insight uses `fromInsightAction`.

The screens send what they're given. The trip helpers live in `features/workspace/trip-actions.ts` for this task only; Task 7 moves them to `features/travel/`.

**Files:**

- Modify: `apps/mobile/src/features/workspace/workspace-actions.ts`, `apps/mobile/src/features/workspace/index.ts`, `apps/mobile/src/features/workspace/day-stepper.tsx`
- Create: `apps/mobile/src/features/workspace/trip-actions.ts`
- Modify: `apps/mobile/src/features/workspace/sections/{route-section,decision-section,insight-section}.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, `apps/mobile/src/app/(app)/place.tsx`
- Modify: `tests/mobile-workspace-actions.test.mjs`

**Interfaces:**

- Produces, from `features/workspace` (`workspace-actions.ts`, pure):
  - `type WorkspaceAction = { type: 'ask'; prompt } | { type: 'open'; objectId } | { type: 'capability'; request: CapabilityRequest; optimistic: ChangesetOp[] } | { type: 'link'; url }`
  - `type CapabilityAction = Extract<WorkspaceAction, { type: 'capability' }>`
  - `resolveAction(decisionId: string, optionId: string | null): CapabilityAction`
  - `fromInsightAction(action: InsightAction): WorkspaceAction | null`
- Produces, from `trip-actions.ts` (pure; moves in Task 7):
  - `MAX_PLACE_DAYS`
  - `daysAction(place: GraphObject, days: number): CapabilityAction | null`
  - `moveAction(snapshot: GraphSnapshot, placeId: string, by: -1 | 1): CapabilityAction | null`
- Removes: `capabilityFor`, `optimisticOps`, `ServerAction`.

- [ ] **Step 1: Rewrite the tests**

Replace `tests/mobile-workspace-actions.test.mjs` with:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { daysAction, moveAction } from '../apps/mobile/src/features/workspace/trip-actions.ts';
import {
  fromInsightAction,
  resolveAction,
} from '../apps/mobile/src/features/workspace/workspace-actions.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import { KYOTO_ID, snapshotRow, STAMP, TOKYO_ID, TRIP_ID } from './support/graph.mjs';

const snapshot = () => mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const placeOf = (graph, id) => graph.objects.find((object) => object.id === id);
const run = (graph, action) => applyOps(graph, action.optimistic, STAMP);

test('a day change is trip.setPlaceDays with the absolute value, shown at once', () => {
  const graph = snapshot();
  const action = daysAction(placeOf(graph, TOKYO_ID), 3);

  assert.equal(action.type, 'capability');
  assert.deepEqual(action.request, {
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 3 },
  });
  assert.equal(placeOf(run(graph, action), TOKYO_ID).data.days, 3);
});

test('a day change to the current value, or out of range, sends nothing', () => {
  const tokyo = placeOf(snapshot(), TOKYO_ID);

  assert.equal(daysAction(tokyo, 4), null);
  assert.equal(daysAction(tokyo, -1), null);
  assert.equal(daysAction(tokyo, 366), null);
  assert.equal(daysAction(tokyo, 2.5), null);
});

test('three quick taps stack: each call is absolute and the shown days keep up', () => {
  let graph = snapshot();
  const sent = [];

  for (const days of [3, 2, 1]) {
    const action = daysAction(placeOf(graph, TOKYO_ID), days);

    sent.push(action.request.input.days);
    graph = run(graph, action);
  }

  assert.deepEqual(sent, [3, 2, 1]);
  assert.equal(placeOf(graph, TOKYO_ID).data.days, 1);
});

test('moving a stop reorders the whole route; the ends cannot move past the edge', () => {
  const graph = snapshot();
  const down = moveAction(graph, TOKYO_ID, 1);

  assert.deepEqual(down.request, {
    name: 'trip.reorderPlaces',
    input: { placeIds: [KYOTO_ID, TOKYO_ID] },
  });

  const moved = run(graph, down);

  assert.deepEqual([placeOf(moved, TOKYO_ID).position, placeOf(moved, KYOTO_ID).position], [2, 1]);
  assert.equal(moveAction(graph, TOKYO_ID, -1), null);
  assert.equal(moveAction(graph, KYOTO_ID, 1), null);
});

test('decisions and insight buttons go to the server as they are, with nothing shown early', () => {
  assert.deepEqual(resolveAction('d1', 'o1'), {
    type: 'capability',
    request: { name: 'decision.resolve', input: { decisionId: 'd1', optionId: 'o1' } },
    optimistic: [],
  });
  assert.deepEqual(resolveAction('d1', null).request.input, { decisionId: 'd1' });
  assert.deepEqual(
    fromInsightAction({
      type: 'capability',
      label: 'Heard back',
      name: 'jobs.logContact',
      input: { objectId: 'r1', direction: 'received' },
    }),
    {
      type: 'capability',
      request: { name: 'jobs.logContact', input: { objectId: 'r1', direction: 'received' } },
      optimistic: [],
    },
  );
  assert.deepEqual(fromInsightAction({ type: 'ask', label: 'Prep me', prompt: 'Prep me' }), {
    type: 'ask',
    prompt: 'Prep me',
  });
  assert.equal(fromInsightAction({ type: 'start', label: 'Start without' }), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/mobile-workspace-actions.test.mjs`
Expected: FAIL, `Cannot find module '…/trip-actions.ts'`.

- [ ] **Step 3: The generic actions**

Replace `apps/mobile/src/features/workspace/workspace-actions.ts` with:

```ts
import type { CapabilityRequest, ChangesetOp, InsightAction } from '@nexui/types';

/**
 * What a primitive or a details sheet reports upward (readiness doc, section 3.5). The primitive
 * that knows a capability builds its request and the ops that show it at once; the screen sends
 * it, opens a sheet or a link, and never names a template's capability.
 */
export type WorkspaceAction =
  | { type: 'ask'; prompt: string }
  | { type: 'open'; objectId: string }
  | { type: 'capability'; request: CapabilityRequest; optimistic: ChangesetOp[] }
  | { type: 'link'; url: string };

export type CapabilityAction = Extract<WorkspaceAction, { type: 'capability' }>;

/**
 * Settles a decision with the chosen option, or with none ("Keep the day free"). Only the server
 * knows what picking does, so nothing shows before it answers.
 */
export function resolveAction(decisionId: string, optionId: string | null): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'decision.resolve',
      input: optionId ? { decisionId, optionId } : { decisionId },
    },
    optimistic: [],
  };
}

/** An insight's button as an action, or null for a button this app doesn't draw yet. */
export function fromInsightAction(action: InsightAction): WorkspaceAction | null {
  switch (action.type) {
    case 'ask':
      return { type: 'ask', prompt: action.prompt };
    case 'capability':
      return {
        type: 'capability',
        request: { name: action.name, input: action.input },
        optimistic: [],
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: The trip's actions**

Create `apps/mobile/src/features/workspace/trip-actions.ts`:

```ts
import {
  tripParts,
  type ChangesetOp,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
} from '@nexui/types';

import type { CapabilityAction } from './workspace-actions.ts';

export const MAX_PLACE_DAYS = 365;

function findPlace(snapshot: GraphSnapshot, id: string): GraphObject | undefined {
  return snapshot.objects.find((object) => object.id === id && object.kind === 'place');
}

function routeIds(snapshot: GraphSnapshot): string[] {
  const anchorId = snapshot.workspace?.doc.anchorId;

  return anchorId ? tripParts(snapshot, anchorId).places.map((place) => place.id) : [];
}

// The route with one stop moved, or null when it can't move that way.
function movedRoute(snapshot: GraphSnapshot, placeId: string, by: -1 | 1): string[] | null {
  const ids = routeIds(snapshot);
  const from = ids.indexOf(placeId);
  const to = from + by;

  if (from < 0 || to < 0 || to >= ids.length) {
    return null;
  }

  const next = [...ids];

  next.splice(from, 1);
  next.splice(to, 0, placeId);

  return next;
}

/**
 * A stop's new day count as `trip.setPlaceDays`, shown at once, or null when the value is out of
 * range or unchanged. Values are absolute, so a burst of taps ends in the state the user saw
 * last. The route and the stop sheet both report it, after `rememberDays`.
 */
export function daysAction(place: GraphObject, days: number): CapabilityAction | null {
  const before = (place.data as PlaceData).days;

  if (!Number.isInteger(days) || days < 0 || days > MAX_PLACE_DAYS || days === before) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'trip.setPlaceDays', input: { placeId: place.id, days } },
    optimistic: [
      {
        op: 'update_object',
        id: place.id,
        patch: { data: { ...place.data, days } },
        origin: 'direct',
      },
    ],
  };
}

/**
 * A stop moved one place along the route as `trip.reorderPlaces`, with the positions it shows at
 * once, or null when it can't move that way.
 */
export function moveAction(
  snapshot: GraphSnapshot,
  placeId: string,
  by: -1 | 1,
): CapabilityAction | null {
  const placeIds = movedRoute(snapshot, placeId, by);

  if (!placeIds) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'trip.reorderPlaces', input: { placeIds } },
    optimistic: placeIds.flatMap((id, index): ChangesetOp[] =>
      findPlace(snapshot, id)?.position === index + 1
        ? []
        : [{ op: 'update_object', id, patch: { position: index + 1 }, origin: 'direct' }],
    ),
  };
}
```

In `apps/mobile/src/features/workspace/day-stepper.tsx`, import `MAX_PLACE_DAYS` from `./trip-actions` instead of `./workspace-actions`.

In `apps/mobile/src/features/workspace/index.ts`, replace the `workspace-actions` lines with:

```ts
export { daysAction, moveAction } from './trip-actions';
export { fromInsightAction, resolveAction } from './workspace-actions';
export type { CapabilityAction, WorkspaceAction } from './workspace-actions';
```

- [ ] **Step 5: The primitives build their actions**

In `sections/route-section.tsx`:

- import `daysAction` and `moveAction` from `../trip-actions` (drop `../workspace-actions`);
- add `snapshot` to `RouteSection`'s props destructuring;
- change the stop row's handlers:

```tsx
            onMove={(by) => {
              const action = moveAction(snapshot, stop.place.id, by);

              if (action) {
                onAction(action);
              }
            }}
            onOpen={() => onAction({ type: 'open', objectId: stop.place.id })}
```

`setDays` keeps its body: `daysAction(place, days)` now returns the capability action it reports.

In `sections/decision-section.tsx`, import `resolveAction` from `../workspace-actions`. Change the two decision buttons to `onPress={() => onAction(resolveAction(decision.id, column.id))}` and `onPress={() => onAction(resolveAction(decision.id, null))}`.

In `sections/insight-section.tsx`:

- delete the local `toAction`;
- import `fromInsightAction` from `../workspace-actions`;
- use it in `buttons`: `const next = fromInsightAction(action);`;
- change the comment above the import to `// Buttons this app doesn't draw yet (upload, copy, start) are left out until job search's intake lands.`

- [ ] **Step 6: The screens send what they're given**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

- import `Linking` from `react-native`;
- drop `capabilityFor` and `optimisticOps` from the `#features/workspace` import;
- replace `handleAction`:

```tsx
const handleAction = (action: WorkspaceAction): void => {
  switch (action.type) {
    case 'open':
      router.push({ pathname: '/place', params: { intentId: id, placeId: action.objectId } });

      return;
    case 'ask':
      router.push({
        pathname: '/compose',
        params: action.prompt ? { intentId: id, prompt: action.prompt } : { intentId: id },
      });

      return;
    case 'capability':
      edit.mutate(
        { request: action.request, optimistic: action.optimistic },
        { onSuccess: (result) => setUndoable(result.event.id) },
      );

      return;
    case 'link':
      void Linking.openURL(action.url).catch(() => undefined);
  }
};
```

(Task 8 sends `open` to `/object`.)

In `apps/mobile/src/app/(app)/place.tsx`, drop `capabilityFor` and `optimisticOps` from the import and change `setDays`:

```tsx
const setDays = (days: number): void => {
  const action = details ? daysAction(details.place, days) : null;

  if (!details || !action) {
    return;
  }

  rememberDays(details.place.id, details.data.days, days);
  edit.mutate(
    { request: action.request, optimistic: action.optimistic },
    { onSuccess: (result) => setUndoable(result.event.id) },
  );
};
```

- [ ] **Step 7: Run the tests**

Run: `node --experimental-strip-types --test tests/mobile-workspace-actions.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (704: the old file's two stepper tests merged into one).

Smoke on Expo web (dev API with `AI_PROVIDER=mock`, or any existing trip of the QA user's):

- `+` and `−` on a stop change its days at once, with Undo;
- ↑↓ reorder;
- Choose on a decision resolves it;
- tapping a stop opens its sheet.

- [ ] **Step 8: Commit**

Message: `Let primitives build their capability requests, so screens never name a template's`

```bash
git add apps/mobile/src tests/mobile-workspace-actions.test.mjs
git commit -F <message file>
```

---

### Task 7: `features/travel/`, `features/registry/`, and the import directions

Readiness doc 3.5 item 3 and 3.12's `format.ts` split (Decisions 4 and 10). This is mechanical: files move, imports change, nothing behaves differently.

- **The trip's primitives, stop details, stepper, place sheet and travel formatters** move to `features/travel/`.
- **`SECTION_REGISTRY` and `SectionView`** move to `features/registry/`.
- **`aiMarkFor`** moves to `lib/`, and **`legBetween`** to `@nexui/types`, so pure files in either template folder can use them under Node.
- **Three lint zones** hold the directions, and a test runs ESLint on probes to prove it.

**Files:**

- Move (`git mv`; `ws` is `apps/mobile/src/features/workspace`, `tr` is `apps/mobile/src/features/travel`):

  | From                                             | To                                                       |
  | ------------------------------------------------ | -------------------------------------------------------- |
  | `ws/sections/map-section.tsx`                    | `tr/sections/map-section.tsx`                            |
  | `ws/sections/map-section.web.tsx`                | `tr/sections/map-section.web.tsx`                        |
  | `ws/sections/map-fallback.tsx`                   | `tr/sections/map-fallback.tsx`                           |
  | `ws/sections/map-region.ts`                      | `tr/sections/map-region.ts`                              |
  | `ws/sections/map-style.ts`                       | `tr/sections/map-style.ts`                               |
  | `ws/sections/route-section.tsx`                  | `tr/sections/route-section.tsx`                          |
  | `ws/sections/allocation-section.tsx`             | `tr/sections/allocation-section.tsx`                     |
  | `ws/day-stepper.tsx`                             | `tr/day-stepper.tsx`                                     |
  | `ws/use-edit-memory-store.ts`                    | `tr/use-edit-memory-store.ts`                            |
  | `ws/stop-details.ts`                             | `tr/stop-details.ts`                                     |
  | `ws/trip-actions.ts`                             | `tr/trip-actions.ts`                                     |
  | `apps/mobile/src/features/place/place-sheet.tsx` | `tr/place-sheet.tsx`                                     |
  | `apps/mobile/src/lib/country-names.ts`           | `tr/country-names.ts`                                    |
  | `ws/ai-mark.ts`                                  | `apps/mobile/src/lib/ai-mark.ts`                         |
  | `ws/sections/registry.tsx`                       | `apps/mobile/src/features/registry/section-registry.tsx` |

- Delete: `apps/mobile/src/features/place/index.ts` (the folder goes)
- Create: `apps/mobile/src/features/travel/travel-format.ts`, `apps/mobile/src/features/travel/index.ts`, `apps/mobile/src/features/registry/index.ts`
- Modify: `packages/types/src/kinds/travel/figures.ts` (`legBetween`)
- Modify: `apps/mobile/src/lib/{format,index}.ts`
- Modify: `apps/mobile/src/features/workspace/{index.ts,workspace-layout.ts}`
- Modify: `apps/mobile/src/features/workspace/sections/{comparison-section,decision-section,object-list-section}.tsx`
- Modify: `apps/mobile/src/app/(app)/place.tsx`, `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, `apps/mobile/eslint.config.js`
- Create: `tests/mobile-import-direction.test.mjs`
- Modify: `tests/mobile-format.test.mjs`, `tests/mobile-stop-details.test.mjs`, `tests/mobile-map-region.test.mjs`, `tests/mobile-country-names.test.mjs`, `tests/mobile-workspace-actions.test.mjs`

**Interfaces:**

- Produces:
  - from `@nexui/types`: `legBetween(snapshot: GraphSnapshot, fromId: string, toId: string): GraphObject | null`;
  - from `#lib`: `aiMarkFor`, `type AiMark`.
- `#features/workspace` exports:
  - the generic primitives: `SectionFrame`, `ComparisonSection`, `DecisionSection`, `InsightSection`, `MetricSection`, `ObjectListSection`, `PendingSection`;
  - `type SectionProps`, `type MapPin`, `type RouteStop`, `type SectionDataOf`, `type SectionEntry`;
  - and what it exported before, minus the moved names.
- `#features/travel` exports `AllocationSection`, `MapSection`, `RouteSection`, `PlaceSheet`, `type AboutState`, `DayStepper`, `daysAction`, `rememberDays`, `useEditMemoryStore`, `placeName`, `stopDetails`, `type StopDetails`.
- `#features/registry` exports `SectionView`.

- [ ] **Step 1: Write the failing import-direction test**

Create `tests/mobile-import-direction.test.mjs`:

```js
// Runs the app's own ESLint config on probe files, so the import directions between the
// template folders hold as `pnpm lint` enforces them (readiness doc, section 6).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const { ESLint } = createRequire(`${mobile}package.json`)('eslint');
const eslint = new ESLint({ cwd: mobile });

async function refusals(file, source) {
  const [result] = await eslint.lintText(source, { filePath: `${mobile}${file}` });

  return result.messages.filter((message) => message.ruleId === 'import/no-restricted-paths')
    .length;
}

const probe = (from, name) =>
  `import { ${name} } from '${from}';\n\nexport const probe = ${name};\n`;

test(
  'features/workspace imports no template folder and not the registries',
  { timeout: 120_000 },
  async () => {
    assert.equal(
      await refusals('src/features/workspace/probe.ts', probe('#features/travel', 'RouteSection')),
      1,
    );
    assert.equal(
      await refusals('src/features/workspace/probe.ts', probe('#features/registry', 'SectionView')),
      1,
    );
  },
);

test(
  'a template folder imports the workspace, never the registries',
  { timeout: 120_000 },
  async () => {
    assert.equal(
      await refusals('src/features/travel/probe.ts', probe('#features/workspace', 'SectionFrame')),
      0,
    );
    assert.equal(
      await refusals('src/features/travel/probe.ts', probe('#features/registry', 'SectionView')),
      1,
    );
  },
);
```

Run: `node --experimental-strip-types --test tests/mobile-import-direction.test.mjs`
Expected: FAIL, since `#features/travel` and `#features/registry` don't resolve, and no zone refuses them.

- [ ] **Step 2: Move the files**

`git mv` doesn't create a missing folder, so make the two new ones first:

```bash
mkdir -p apps/mobile/src/features/travel/sections apps/mobile/src/features/registry
```

Then run each `git mv` on its own, as in the Files list. For example:

```bash
git mv apps/mobile/src/features/workspace/sections/map-section.tsx apps/mobile/src/features/travel/sections/map-section.tsx
```

Then run `git rm apps/mobile/src/features/place/index.ts`.

- [ ] **Step 3: Move `legBetween` into the travel figures, and `aiMarkFor` into `lib`**

In `packages/types/src/kinds/travel/figures.ts` (which already imports `GraphObject` and `GraphSnapshot` from `../../graph.ts`), add (the body is `workspace-layout.ts`'s, unchanged):

```ts
/** The leg from one stop to another, if the graph has one. */
export function legBetween(
  snapshot: GraphSnapshot,
  fromId: string,
  toId: string,
): GraphObject | null {
  const end = (legId: string, type: 'leg_from' | 'leg_to'): string | undefined =>
    snapshot.relationships.find((edge) => edge.sourceId === legId && edge.type === type)?.targetId;

  return (
    snapshot.objects.find(
      (object) =>
        object.kind === 'leg' &&
        end(object.id, 'leg_from') === fromId &&
        end(object.id, 'leg_to') === toId,
    ) ?? null
  );
}
```

`lib/ai-mark.ts` (moved) needs no change. Replace `apps/mobile/src/lib/index.ts` with:

```ts
// The pure display layer loads this barrel under Node, so keep '.ts' paths and no react-native.
export { aiMarkFor } from './ai-mark.ts';
export type { AiMark } from './ai-mark.ts';
export {
  capitalize,
  cardText,
  dayLabel,
  formatDate,
  formatDateTime,
  formatDays,
  formatField,
  formatHours,
  formatMoney,
  formatRelative,
  formatTime,
  humanizeKey,
  isDateOnly,
  ordinalWord,
} from './format.ts';
```

- [ ] **Step 4: Split the travel formatters out of `lib/format.ts`**

Create `apps/mobile/src/features/travel/travel-format.ts`. Move these from `lib/format.ts` with their doc comments, unchanged: `placeName`, `countryName`, `TRAVEL_MODES`, `travelTo`, `legFigures`, `photoCredit`.

```ts
import type { GraphObject, LegData, PhotoCredit, PlaceData } from '@nexui/types';

import { formatHours, formatMoney } from '#lib';

import { COUNTRY_NAMES } from './country-names.ts';

/** A place's display name: its `data.name`, else its title. */
export function placeName(object: GraphObject): string {
  const name = (object.data as Partial<PlaceData>).name;

  return name ?? object.title ?? 'Stop';
}

/**
 * A country's English name from its ISO code, or the code itself for one the list doesn't
 * know. The list is bundled because Hermes has no Intl.DisplayNames.
 *
 * @example countryName('DE') // 'Germany'
 */
export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

const TRAVEL_MODES: Record<LegData['mode'], string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Drive',
  ferry: 'Ferry',
  other: 'Travel',
};

/** @example travelTo('train', 'Prague') // 'Train to Prague' */
export function travelTo(mode: LegData['mode'], name: string): string {
  return `${TRAVEL_MODES[mode]} to ${name}`;
}

/**
 * A leg's time and cost, either of which may be missing.
 *
 * @example
 * legFigures({ mode: 'train', estHours: 4.25, estCost: { amount: 40, currency: 'USD' } })
 * // '4h 15m, ≈ $40'
 */
export function legFigures(leg: LegData): string {
  const parts: string[] = [];

  if (leg.estHours !== undefined) {
    parts.push(formatHours(leg.estHours));
  }

  if (leg.estCost) {
    parts.push(`≈ ${formatMoney(leg.estCost)}`);
  }

  return parts.join(', ');
}

/**
 * A photo's credit line, as the stop sheet shows it under the photo.
 *
 * @example
 * photoCredit({ author: 'Kasa Fue', license: 'CC BY-SA 4.0' })
 * // 'Photo: Kasa Fue, CC BY-SA 4.0, via Wikimedia Commons'
 */
export function photoCredit(credit: Pick<PhotoCredit, 'author' | 'license'>): string {
  const who = [credit.author, credit.license].filter(Boolean).join(', ');

  return `Photo: ${who}, via Wikimedia Commons`;
}
```

In `apps/mobile/src/lib/format.ts`:

- delete those six declarations and the `COUNTRY_NAMES` import;
- drop `type LegData`, `type PhotoCredit` and `type PlaceData` from the `@nexui/types` import.

- [ ] **Step 5: Fix the moved files' imports**

Each block replaces the file's whole import section. Code below the imports doesn't change.

`travel/sections/map-section.tsx`:

```tsx
import Constants from 'expo-constants';
import { useMemo, type ReactElement } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { fonts, createThemedStyles, useColors, useScheme } from '#theme';
import { SectionFrame, type SectionProps } from '#features/workspace';

import { MapFallback } from './map-fallback';
import { fitRegion } from './map-region';
import { darkMapStyle } from './map-style';
```

`travel/sections/map-section.web.tsx`:

```tsx
import type { ReactElement } from 'react';

import type { SectionProps } from '#features/workspace';

import { MapFallback } from './map-fallback';
```

`travel/sections/map-fallback.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { AiText } from '#ui';
import { SectionFrame, type MapPin } from '#features/workspace';
```

`travel/sections/allocation-section.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { formatDays } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { SectionFrame, type SectionDataOf, type SectionProps } from '#features/workspace';
```

`travel/sections/route-section.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { GraphObject, LegData, PlaceData } from '@nexui/types';

import type { PhotoState } from '#data';
import { aiMarkFor, capitalize, formatDays } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { AiText, PlacePhoto } from '#ui';
import {
  SectionFrame,
  type RouteStop,
  type SectionDataOf,
  type SectionProps,
} from '#features/workspace';

import { DayStepper, SmallButton } from '../day-stepper';
import { stopButtonLabel, stopKind } from '../stop-details';
import { legFigures, placeName } from '../travel-format';
import { daysAction, moveAction } from '../trip-actions';
import { rememberDays, useEditMemoryStore } from '../use-edit-memory-store';
```

`travel/stop-details.ts` (a pure file, so `.ts` paths):

```ts
import {
  legBetween,
  tripParts,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
  type StayData,
} from '@nexui/types';

import { capitalize, formatDays, formatMoney, ordinalWord } from '#lib';

import { countryName } from './travel-format.ts';
```

`travel/trip-actions.ts`: replace `import type { CapabilityAction } from './workspace-actions.ts';` with `import type { CapabilityAction } from '#features/workspace';`. Node strips a type-only import, so the file stays pure.

`travel/place-sheet.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LegData, PhotoCredit, PlaceAbout, StayData } from '@nexui/types';

import type { PhotoState } from '#data';
import { aiMarkFor, formatDays, formatMoney } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { AiText, Button, PlacePhoto } from '#ui';

import { DayStepper } from './day-stepper';
import { stayLine, stopSubtitle, type StopDetails } from './stop-details';
import { legFigures, photoCredit, placeName, travelTo } from './travel-format';
```

`travel/day-stepper.tsx` and `travel/use-edit-memory-store.ts` keep their imports.

Create `apps/mobile/src/features/travel/index.ts`:

```ts
export { DayStepper } from './day-stepper';
export { PlaceSheet } from './place-sheet';
export type { AboutState } from './place-sheet';
export { AllocationSection } from './sections/allocation-section';
export { MapSection } from './sections/map-section';
export { RouteSection } from './sections/route-section';
export { stopDetails } from './stop-details';
export type { StopDetails } from './stop-details';
export { placeName } from './travel-format';
export { daysAction } from './trip-actions';
export { rememberDays, useEditMemoryStore } from './use-edit-memory-store';
```

- [ ] **Step 6: The workspace keeps the engine and the generic primitives**

In `apps/mobile/src/features/workspace/workspace-layout.ts`:

- import `legBetween` from `@nexui/types` and delete the local `legBetween`;
- replace `import { placeName } from '#lib';` and `import { aiMarkFor } from './ai-mark.ts';` with `import { aiMarkFor, cardText } from '#lib';`;
- in `mapPins`, change `label: placeName(place),` to `label: cardText(place).title,`;
- in the allocation case, change the label fallback to `typeof label === 'string' && label.length > 0 ? label : cardText(object).title`.

In `sections/comparison-section.tsx`, `sections/decision-section.tsx` and `sections/object-list-section.tsx`, replace `import { aiMarkFor } from '../ai-mark';` by adding `aiMarkFor` to the file's `#lib` import.

Replace `apps/mobile/src/features/workspace/index.ts` with:

```ts
export { ComparisonSection } from './sections/comparison-section';
export { DecisionSection } from './sections/decision-section';
export { InsightSection } from './sections/insight-section';
export { MetricSection } from './sections/metric-section';
export { ObjectListSection } from './sections/object-list-section';
export { PendingSection } from './sections/pending-section';
export { SectionFrame } from './sections/section-frame';
export type { SectionProps } from './sections/types';
export { UndoToast } from './undo-toast';
export { focusIntent, useFocusedIntentStore } from './use-focused-intent-store';
export { useRevealOpenBand } from './use-reveal-open-band';
export { revealOpenBand } from './use-reveal-store';
export { fromInsightAction, resolveAction } from './workspace-actions';
export type { CapabilityAction, WorkspaceAction } from './workspace-actions';
export { layoutWorkspace } from './workspace-layout';
export type { MapPin, RouteStop, SectionDataOf, SectionEntry } from './workspace-layout';
```

- [ ] **Step 7: The section registry joins them**

Replace the import section of `apps/mobile/src/features/registry/section-registry.tsx` (moved from `sections/registry.tsx`; its body doesn't change) with:

```tsx
import type { ComponentType, ReactElement } from 'react';

import type { GraphSnapshot, Section } from '@nexui/types';

import type { PhotoState } from '#data';
import { AllocationSection, MapSection, RouteSection } from '#features/travel';
import {
  ComparisonSection,
  DecisionSection,
  InsightSection,
  MetricSection,
  ObjectListSection,
  PendingSection,
  type SectionDataOf,
  type SectionEntry,
  type SectionProps,
  type WorkspaceAction,
} from '#features/workspace';
```

Change its doc comment to: "Every section type's primitive: the generic ones from `features/workspace`, each template's from its folder. A type without one fails typecheck (spec section D). A new template adds its primitives here, one line each."

Create `apps/mobile/src/features/registry/index.ts`:

```ts
export { SectionView } from './section-registry';
```

- [ ] **Step 8: The routes import from the new barrels**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, drop `SectionView` from the `#features/workspace` import and add `import { SectionView } from '#features/registry';` after it.

In `apps/mobile/src/app/(app)/place.tsx`, replace the `#features/place` and `#features/workspace` imports with these, and change `placeName` to come from `#features/travel` (drop it from `#lib`):

```tsx
import {
  PlaceSheet,
  daysAction,
  placeName,
  rememberDays,
  stopDetails,
  useEditMemoryStore,
} from '#features/travel';
import { UndoToast } from '#features/workspace';
```

- [ ] **Step 9: Lint the directions**

In `apps/mobile/eslint.config.js`, add three zones after `onlyImports('lib', [])` in the `zones` array:

```js
          // Each template's folder and the generic workspace stay apart; only features/registry
          // joins them (readiness doc, section 3.5).
          {
            target: './src/features/workspace',
            from: ['./src/features/travel', './src/features/jobs', './src/features/registry'],
            message:
              "features/workspace/ draws any template: it never imports a template's folder or features/registry (see \"Where code lives\" in docs/architecture/mobile.md).",
          },
          {
            target: './src/features/travel',
            from: ['./src/features/jobs', './src/features/registry'],
            message:
              "features/travel/ may import features/workspace/, never another template's folder or features/registry.",
          },
          {
            target: './src/features/jobs',
            from: ['./src/features/travel', './src/features/registry'],
            message:
              "features/jobs/ may import features/workspace/, never another template's folder or features/registry.",
          },
```

- [ ] **Step 10: Point the tests at the new paths**

- `tests/mobile-stop-details.test.mjs`: `features/workspace/stop-details.ts` → `features/travel/stop-details.ts`.
- `tests/mobile-map-region.test.mjs`: `features/workspace/sections/map-region.ts` → `features/travel/sections/map-region.ts`.
- `tests/mobile-country-names.test.mjs`: `lib/format.ts` → `features/travel/travel-format.ts`.
- `tests/mobile-workspace-actions.test.mjs`: `features/workspace/trip-actions.ts` → `features/travel/trip-actions.ts`.
- `tests/mobile-format.test.mjs`:
  - import `aiMarkFor` from `../apps/mobile/src/lib/ai-mark.ts`;
  - import `countryName`, `legFigures`, `photoCredit` and `travelTo` from `../apps/mobile/src/features/travel/travel-format.ts`;
  - keep the rest from `lib/format.ts`.

- [ ] **Step 11: Run everything**

Run: `node --experimental-strip-types --test tests/mobile-import-direction.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (706).

Run the seam grep from Global Constraints. It prints `intent/[id].tsx`'s line no more (Task 1), nor `change-feed.ts`'s (Task 5), and none from `features/workspace`. Expected output: only `data/place-media.ts`.

Smoke on Expo web, a trip: the map, route, day bar and a stop's sheet look and behave as before.

- [ ] **Step 12: Commit**

Message: `Move the trip's primitives into features/travel and the section registry into features/registry`

```bash
git add -A apps/mobile tests packages/types/src/kinds/travel/figures.ts
git commit -F <message file>
```

Check `git status` first: only this task's files should be staged.

---

### Task 8: `/object` and `DETAIL_REGISTRY`

Spec section 6 ("`/object`, the one details sheet") and readiness doc 3.5 item 2.

- `app/(app)/place.tsx` becomes `app/(app)/object.tsx`, with the same sheet presentation, close behavior and collapsable-root workaround.
- A `DETAIL_REGISTRY` keyed by kind picks the body. Its first entry is the stop, a `PlaceBody` wrapping the unchanged `PlaceSheet`, which now fetches its own media.
- `open` actions go to `/object`. The meta line opens its anchor when the anchor's kind has a body (the search's comes in Task 15).

**Files:**

- Create: `apps/mobile/src/features/workspace/detail-types.ts`, `apps/mobile/src/features/travel/place-body.tsx`, `apps/mobile/src/features/registry/detail-registry.tsx`, `apps/mobile/src/app/(app)/object.tsx`
- Delete: `apps/mobile/src/app/(app)/place.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, the barrels of `features/workspace`, `features/travel` and `features/registry`

**Interfaces:**

- Produces, from `#features/workspace`: `interface DetailProps { object: GraphObject; snapshot: GraphSnapshot; onAction: (action: WorkspaceAction) => void; onDone: () => void; busy: boolean }`.
- Produces, from `#features/registry`:
  - `DETAIL_REGISTRY: { [K in KindName]?: ComponentType<DetailProps> }`
  - `DetailView(props: DetailProps): ReactElement`
  - `hasDetail(kind: string): boolean`
- Produces, from `#features/travel`: `PlaceBody`. The barrel drops what only `place.tsx` used: `PlaceSheet`, `AboutState`, `DayStepper`, `daysAction`, `rememberDays`, `useEditMemoryStore`, `placeName`, `stopDetails`, `StopDetails`.
- Route: `/object` with params `{ intentId: string; objectId: string }`.

- [ ] **Step 1: The body contract**

Create `apps/mobile/src/features/workspace/detail-types.ts`:

```ts
import type { GraphObject, GraphSnapshot } from '@nexui/types';

import type { WorkspaceAction } from './workspace-actions';

/**
 * What every details body receives (job search spec, section 6): the object, the plan it's in,
 * and where to report actions. Like a primitive, a body never calls the API: the object screen
 * sends what it reports, and `open` swaps the sheet to another object in place.
 */
export interface DetailProps {
  object: GraphObject;
  snapshot: GraphSnapshot;
  onAction: (action: WorkspaceAction) => void;
  /** Closes the sheet. Every body keeps Done in view. */
  onDone: () => void;
  /** An edit or upload is in flight: disable buttons that would race it. */
  busy: boolean;
}
```

Add `export type { DetailProps } from './detail-types';` to `features/workspace/index.ts`, in name order.

- [ ] **Step 2: The stop's body**

Create `apps/mobile/src/features/travel/place-body.tsx`:

```tsx
import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { mediaPlaceIds, usePlaceAbout, usePlacePhotos } from '#data';
import { createThemedStyles } from '#theme';
import { Button, ListEmpty } from '#ui';
import type { DetailProps } from '#features/workspace';

import { PlaceSheet } from './place-sheet';
import { stopDetails } from './stop-details';
import { placeName } from './travel-format';
import { daysAction } from './trip-actions';
import { rememberDays, useEditMemoryStore } from './use-edit-memory-store';

/**
 * A route stop in the object sheet (spec section 5): its photo and Wikipedia introduction from
 * the plan's media query, and its days through the route's own capability, remembered for "was
 * 4". Next stop swaps the sheet to the next stop; Find a stay asks Nexui.
 */
export function PlaceBody({ object, snapshot, onAction, onDone }: DetailProps): ReactElement {
  const styles = useStyles();
  const intentId = snapshot.intent.id;
  const placeIds = useMemo(() => mediaPlaceIds(snapshot), [snapshot]);
  const about = usePlaceAbout(intentId, placeIds, object.id);
  const photo = usePlacePhotos(intentId, placeIds)[object.id] ?? null;
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const details = stopDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gone}>
        <ListEmpty text="This stop is no longer on your route." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const setDays = (days: number): void => {
    const action = daysAction(details.place, days);

    if (!action) {
      return;
    }

    rememberDays(details.place.id, details.data.days, days);
    onAction(action);
  };

  return (
    <PlaceSheet
      details={details}
      about={about}
      photo={photo}
      was={wasDays[details.place.id]}
      onDone={onDone}
      onDays={setDays}
      onNext={(placeId) => onAction({ type: 'open', objectId: placeId })}
      onFindStay={() =>
        onAction({ type: 'ask', prompt: `Find a stay in ${placeName(details.place)}` })
      }
      onOpenLink={(url) => onAction({ type: 'link', url })}
    />
  );
}

const useStyles = createThemedStyles(() => ({
  gone: { gap: 12 },
}));
```

Replace `apps/mobile/src/features/travel/index.ts` with:

```ts
export { PlaceBody } from './place-body';
export { AllocationSection } from './sections/allocation-section';
export { MapSection } from './sections/map-section';
export { RouteSection } from './sections/route-section';
```

- [ ] **Step 3: The detail registry**

Create `apps/mobile/src/features/registry/detail-registry.tsx`:

```tsx
import type { ComponentType, ReactElement } from 'react';
import { View } from 'react-native';

import { isKindName, type KindName } from '@nexui/types';

import { createThemedStyles } from '#theme';
import { Button, ListEmpty } from '#ui';
import { PlaceBody } from '#features/travel';
import type { DetailProps } from '#features/workspace';

/**
 * Each kind's details body (job search spec, section 6), as `SECTION_REGISTRY` picks primitives.
 * A kind without one doesn't open. A new template adds its bodies here, one line each.
 */
export const DETAIL_REGISTRY: { [K in KindName]?: ComponentType<DetailProps> } = {
  place: PlaceBody,
};

/** True when a kind has a details body, so a row or the meta line may open it. */
export function hasDetail(kind: string): boolean {
  return isKindName(kind) && DETAIL_REGISTRY[kind] !== undefined;
}

/** One object's details, drawn by its kind's body, or a note that there's nothing more. */
export function DetailView(props: DetailProps): ReactElement {
  const styles = useStyles();
  const Body = isKindName(props.object.kind) ? DETAIL_REGISTRY[props.object.kind] : undefined;

  if (!Body) {
    return (
      <View style={styles.none}>
        <ListEmpty text="There's nothing more to show for this." />
        <Button label="Done" onPress={props.onDone} />
      </View>
    );
  }

  return <Body {...props} />;
}

const useStyles = createThemedStyles(() => ({
  none: { gap: 12 },
}));
```

Replace `apps/mobile/src/features/registry/index.ts` with:

```ts
export { DetailView, hasDetail } from './detail-registry';
export { SectionView } from './section-registry';
```

- [ ] **Step 4: The object screen**

Create `apps/mobile/src/app/(app)/object.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { useIntent, useUndo, useWorkspaceEdit } from '#data';
import { fonts, createThemedStyles } from '#theme';
import { Button, ListEmpty, ListError, SkeletonRows } from '#ui';
import { DetailView } from '#features/registry';
import { UndoToast, type WorkspaceAction } from '#features/workspace';

// Closes the sheet onto its plan. A sheet opened from a link or a reload on web has no history
// to go back to, so it opens the plan instead.
function close(intentId: string): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace({ pathname: '/intent/[id]', params: { id: intentId } });
  }
}

/**
 * One object's details (job search spec, section 6): a stop, a role, a draft or the search, the
 * body `DETAIL_REGISTRY` picks by kind. It reads the plan from the workspace's cache. Bodies
 * report actions: edits go through the same capability, optimistic ops and Undo as the
 * workspace; `open` swaps the body in place (Next stop, a role's draft); an ask closes the sheet
 * onto + with the prompt filled in.
 */
export default function ObjectScreen(): ReactElement {
  const styles = useStyles();
  const { intentId, objectId } = useLocalSearchParams<{ intentId: string; objectId: string }>();
  const intent = useIntent(intentId);
  const edit = useWorkspaceEdit(intentId);
  const undo = useUndo();
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const scroll = useRef<ScrollView>(null);
  const object = intent.data?.objects.find((candidate) => candidate.id === objectId);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [objectId]);

  const handleAction = (action: WorkspaceAction): void => {
    switch (action.type) {
      case 'open':
        router.setParams({ objectId: action.objectId });

        return;
      case 'ask':
        router.dismiss();
        router.push({ pathname: '/compose', params: { intentId, prompt: action.prompt } });

        return;
      case 'capability':
        edit.mutate(
          { request: action.request, optimistic: action.optimistic },
          { onSuccess: (result) => setUndoable(result.event.id) },
        );

        return;
      case 'link':
        void Linking.openURL(action.url).catch(() => undefined);
    }
  };

  const renderBody = (): ReactElement => {
    if (intent.isPending) {
      return <SkeletonRows count={4} />;
    }

    if (intent.isLoadingError) {
      return <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />;
    }

    if (!object) {
      return (
        <View style={styles.gone}>
          <ListEmpty text="This is no longer in your plan." />
          <Button label="Done" onPress={() => close(intentId)} />
        </View>
      );
    }

    return (
      <DetailView
        object={object}
        snapshot={intent.data}
        onAction={handleAction}
        onDone={() => close(intentId)}
        busy={edit.isPending}
      />
    );
  };

  return (
    <View collapsable={false} style={styles.screen}>
      {/* As in the + sheet: with the collapsable root, this empty first child stops
          react-native-screens resizing the ScrollView, which leaves an iOS form sheet blank
          (docs/architecture/mobile.md). */}
      <View collapsable={false} />
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}>
        {edit.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t save that. {edit.error.message}
          </Text>
        ) : null}
        {undo.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t undo that. {undo.error.message}
          </Text>
        ) : null}
        {renderBody()}
      </ScrollView>
      {undoable ? (
        <UndoToast
          key={undoable}
          onDismiss={hideUndo}
          onUndo={() => {
            undo.mutate(undoable);
            setUndoable(null);
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.card },
  scroll: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  // The place body's photo bleeds through this padding.
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 },
  gone: { gap: 12 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
```

Run `git rm "apps/mobile/src/app/(app)/place.tsx"`. In `apps/mobile/src/app/(app)/_layout.tsx`:

- change `<Stack.Screen name="place" options={sheetOptions} />` to `<Stack.Screen name="object" options={sheetOptions} />`;
- change the comment's "a stop's details" to "an object's details".

- [ ] **Step 5: The workspace opens objects, and its meta line opens the anchor**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

- import `hasDetail` with `SectionView` from `#features/registry`;
- change the `open` case to:

```tsx
      case 'open':
        router.push({ pathname: '/object', params: { intentId: id, objectId: action.objectId } });

        return;
```

In `renderBody`, replace the meta `Text` with:

```tsx
{
  meta && hasDetail(meta.kind) ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meta.text}. Show details`}
      onPress={() => handleAction({ type: 'open', objectId: meta.objectId })}
      style={({ pressed }) => [styles.metaButton, pressed && styles.pressed]}
    >
      <Text style={styles.meta}>{meta.text} ›</Text>
    </Pressable>
  ) : null;
}
{
  meta && !hasDetail(meta.kind) ? <Text style={styles.meta}>{meta.text}</Text> : null;
}
```

and add to its styles:

```ts
  metaButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
```

- [ ] **Step 6: Typecheck against fresh routes**

If `apps/mobile/.expo/types/` exists, delete it (it lists `/place`). Typecheck then reads routes loosely until the next `expo start` regenerates them.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (706). There are no new Node tests: the bodies are React components; the pure pieces they use are tested.

Smoke on Expo web: restart Metro (port 8091), then on a trip check:

- tapping a stop opens `/object` with its photo, About, days and Done;
- days ± apply at once with Undo;
- Next stop swaps in place and scrolls to the top;
- Find a stay closes onto + with `Find a stay in <stop>`;
- Read more on Wikipedia opens a tab;
- `/object?intentId=<id>&objectId=00000000-0000-4000-8000-000000000000` shows "This is no longer in your plan." with Done.

The trip's meta line stays plain text (no trip body).

- [ ] **Step 7: Commit**

Message: `Open objects in one /object sheet, picked by kind from DETAIL_REGISTRY`

```bash
git add -A apps/mobile/src
git commit -F <message file>
```

---

### Task 9: Home draws a search's companies as chips

Carried item 1, spec section 3.2 (`stripStyle`).

- Home's card reads `summary.stripStyle`: `chips` draws one chip per company, on the highlighter while a role there waits in New. Anything else draws the route as today.
- The photo band counts only strip entries with a media `key` as stops, so chips never become "+N".

**Files:**

- Modify: `apps/mobile/src/features/home/photo-band.ts`, `apps/mobile/src/features/home/intent-card.tsx`
- Modify: `tests/mobile-photo-band.test.mjs`

**Interfaces:**

- Changes: `photoBand` counts `summary.strip` entries with `key`.

- [ ] **Step 1: Write the failing test**

In `tests/mobile-photo-band.test.mjs`, give the helper's stops a media key and add a chips case:

```js
const stops = (count) =>
  Array.from({ length: count }, (_, index) => ({
    label: `Stop ${index + 1}`,
    ai: false,
    key: `place:stop-${index + 1}`,
  }));
```

```js
test("a job search's company chips are not stops, so they never add a +N", () => {
  const chips = [
    { label: 'Ledgerly', ai: true },
    { label: 'Halyard', ai: false },
  ];

  assert.deepEqual(
    photoBand({ photos: ['a'], summary: { line: '', strip: chips, stripStyle: 'chips' } }),
    { photos: ['a'], more: 0 },
  );
});
```

Run: `node --experimental-strip-types --test tests/mobile-photo-band.test.mjs`
Expected: FAIL on the new test (`more: 1`).

- [ ] **Step 2: Count only stops**

In `apps/mobile/src/features/home/photo-band.ts`, replace the body after the no-photos guard:

```ts
// A stop carries its media key (`placeMediaKey`); a job search's company chips carry none.
const stops = (item.summary.strip ?? []).filter((entry) => entry.key !== undefined).length;

return { photos: item.photos, more: Math.max(0, stops - item.photos.length) };
```

and change the doc comment's second sentence to "A stop is a strip entry with a media `key`."

- [ ] **Step 3: Draw chips**

In `apps/mobile/src/features/home/intent-card.tsx`:

- import `type IntentSummary` with `IntentListItem`;
- replace the strip block in the card with:

```tsx
{
  strip.length > 0 && summary.stripStyle === 'chips' ? <Chips strip={strip} /> : null;
}
{
  strip.length > 0 && summary.stripStyle !== 'chips' ? <RouteStrip strip={strip} /> : null;
}
```

and add, above `IntentCard`:

```tsx
type Strip = NonNullable<IntentSummary['strip']>;

/** A trip's stops as a mini route. */
function RouteStrip({ strip }: { strip: Strip }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.strip}>
      {strip.map((stop, index) => (
        <Fragment key={`${stop.label}-${index}`}>
          {index > 0 ? <View style={styles.connector} /> : null}
          <AiText text={stop.label} highlight={stop.ai} tag={false} style={styles.stop} />
        </Fragment>
      ))}
    </View>
  );
}

/** A job search's companies, one chip each, on the highlighter while a role there waits in New. */
function Chips({ strip }: { strip: Strip }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.chips}>
      {strip.map((chip, index) => (
        <View key={`${chip.label}-${index}`} style={[styles.chip, chip.ai && styles.chipNew]}>
          <Text style={styles.chipText}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}
```

Add to `useStyles`:

```ts
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.soft,
  },
  chipNew: { backgroundColor: colors.aiMark, borderColor: colors.aiMark },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
```

Update the card's doc comment: "…then its goal, badge, summary line and strip: a trip's stops as a mini route, a job search's companies as chips."

- [ ] **Step 4: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (707).

Smoke on Expo web: a trip's card is unchanged. A job search with roles (Task 17's smoke builds one) shows company chips, the ones with New roles on the highlighter.

- [ ] **Step 5: Commit**

Message: `Draw a job search's companies as chips on Home, and count only stops in the photo band`

```bash
git add apps/mobile/src/features/home tests/mobile-photo-band.test.mjs
git commit -F <message file>
```

---

### Task 10: Uploads, and the Open band's `upload`, `start` and `copy`

Spec section 4 and carried items 3 and 4 (Decisions 1 and 13). The resume card's buttons draw:

- **Add resume** picks a PDF and sends it to `start` or `resume`, whichever `intakeRoute` says;
- **Start without** calls `start` with no file;
- **Copy** copies text.

`expo-document-picker` and `expo-clipboard` arrive here. Both screens (workspace and object) handle the new actions explicitly.

**Files:**

- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml` (the two modules)
- Create: `apps/mobile/src/data/upload-form.ts`, `apps/mobile/src/data/pick-pdf.ts`
- Modify: `apps/mobile/src/data/{api,queries,index}.ts`
- Modify: `apps/mobile/src/features/workspace/workspace-actions.ts`, `apps/mobile/src/features/workspace/sections/insight-section.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`, `apps/mobile/src/app/(app)/object.tsx`
- Create: `tests/mobile-upload-form.test.mjs`
- Modify: `tests/mobile-workspace-actions.test.mjs`

**Interfaces:**

- Produces, from `#data`:
  - `interface PickedPdf { uri: string; name: string; size: number | null; file: Blob | null }`
  - `type PdfChoice = { pdf: PickedPdf } | { problem: string } | null`
  - `choosePdf(): Promise<PdfChoice>`
  - `useStartPlan()`: a mutation of `{ intentId: string; pdf: PickedPdf | null }` answering `StartResponse`
  - `useReplaceResume()`: a mutation of `{ intentId: string; pdf: PickedPdf }` answering `CommitResponse`
- Produces, from `data/upload-form.ts` (pure):
  - `TOO_LARGE`
  - `checkPdf(pdf: Pick<PickedPdf, 'size'>): string | null`
  - `appendPdf(form: Pick<FormData, 'append'>, pdf: PickedPdf): void`
- `WorkspaceAction` gains `{ type: 'upload'; docType: 'resume' }`, `{ type: 'start' }` and `{ type: 'copy'; text: string }`. `fromInsightAction` returns a `WorkspaceAction` for every insight action (no longer null).

- [ ] **Step 1: Add the native modules**

Run: `pnpm --filter @nexui/mobile exec expo install expo-document-picker expo-clipboard`
Expected: `apps/mobile/package.json` gains both at the SDK 57 versions (`~57.0.x`), and `pnpm-lock.yaml` changes.

If `expo install` can't drive pnpm here:

1. Run `pnpm --filter @nexui/mobile exec expo install --check` to read the versions it wants.
2. Add them with `pnpm --filter @nexui/mobile add expo-document-picker@<version> expo-clipboard@<version>`.

Neither needs a config plugin: the picker needs one only for an app's own iCloud container, which Nexui doesn't use. Both are native, so iOS needs a new dev client (`pnpm --filter @nexui/mobile exec expo run:ios`) before a device or simulator check, and the founder's preview build in Task 17. Web works now.

- [ ] **Step 2: Write the failing tests**

Create `tests/mobile-upload-form.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { appendPdf, checkPdf, TOO_LARGE } from '../apps/mobile/src/data/upload-form.ts';

const recorder = () => {
  const calls = [];

  return { calls, append: (...args) => calls.push(args) };
};

test('a PDF over 4 MB is refused before it is sent; one of unknown size goes', () => {
  assert.equal(TOO_LARGE, 'That file is over 4 MB.');
  assert.equal(checkPdf({ size: 4 * 1024 * 1024 + 1 }), TOO_LARGE);
  assert.equal(checkPdf({ size: 4 * 1024 * 1024 }), null);
  assert.equal(checkPdf({ size: null }), null);
});

test('on web the File itself is the upload, under its name', () => {
  const file = new File(['%PDF-1.7'], 'Jordan-Lee-CV.pdf', { type: 'application/pdf' });
  const form = recorder();

  appendPdf(form, { uri: 'blob:cv', name: 'Jordan-Lee-CV.pdf', size: file.size, file });
  assert.deepEqual(form.calls, [['file', file, 'Jordan-Lee-CV.pdf']]);
});

test('on a phone the file part points at its uri, as a PDF', () => {
  const form = recorder();

  appendPdf(form, { uri: 'file:///cache/cv.pdf', name: 'cv.pdf', size: 1200, file: null });
  assert.deepEqual(form.calls, [
    ['file', { uri: 'file:///cache/cv.pdf', name: 'cv.pdf', type: 'application/pdf' }],
  ]);
});
```

In `tests/mobile-workspace-actions.test.mjs`, replace the last assertion of the final test (`fromInsightAction({ type: 'start', … })` is null) with:

```js
assert.deepEqual(fromInsightAction({ type: 'start', label: 'Start without' }), {
  type: 'start',
});
assert.deepEqual(fromInsightAction({ type: 'upload', label: 'Add resume', docType: 'resume' }), {
  type: 'upload',
  docType: 'resume',
});
assert.deepEqual(
  fromInsightAction({ type: 'copy', label: 'Copy address', text: 'me@in.nexui.app' }),
  { type: 'copy', text: 'me@in.nexui.app' },
);
```

Run: `node --experimental-strip-types --test tests/mobile-upload-form.test.mjs tests/mobile-workspace-actions.test.mjs`
Expected: FAIL. There is no `upload-form.ts` yet, and `start` maps to null.

- [ ] **Step 3: The upload's form, and the picker**

Create `apps/mobile/src/data/upload-form.ts`:

```ts
import { MAX_UPLOAD_BYTES } from '@nexui/types';

/**
 * A PDF the user picked (job search spec, section 4). On web the picker hands over the `File`
 * itself; on iOS and Android, a `uri` the upload streams from, with its name and usually its
 * size.
 */
export interface PickedPdf {
  uri: string;
  name: string;
  size: number | null;
  file: Blob | null;
}

/** The API's own refusal for a file over 4 MB, so the app can say it before sending. */
export const TOO_LARGE = 'That file is over 4 MB.';

/** Why a picked PDF can't be sent, or null to send it. */
export function checkPdf(pdf: Pick<PickedPdf, 'size'>): string | null {
  return pdf.size !== null && pdf.size > MAX_UPLOAD_BYTES ? TOO_LARGE : null;
}

/**
 * Adds the PDF as the `file` field `start` and `resume` read. React Native's FormData takes a
 * `{ uri, name, type }` part for a file on the device; a browser takes the `File`.
 */
export function appendPdf(form: Pick<FormData, 'append'>, pdf: PickedPdf): void {
  if (pdf.file) {
    form.append('file', pdf.file, pdf.name);

    return;
  }

  // React Native's own file part, which the DOM's FormData typing doesn't know.
  form.append('file', {
    uri: pdf.uri,
    name: pdf.name,
    type: 'application/pdf',
  } as unknown as Blob);
}
```

Create `apps/mobile/src/data/pick-pdf.ts`:

```ts
import * as DocumentPicker from 'expo-document-picker';

import { checkPdf, type PickedPdf } from './upload-form';

/** What picking ended with: the PDF, why it can't be sent, or null when the user cancelled. */
export type PdfChoice = { pdf: PickedPdf } | { problem: string } | null;

/**
 * Opens the system's document picker for one PDF and checks it can be sent (job search spec,
 * section 4). The API checks again, and reads the file's first bytes to be sure it's a PDF.
 */
export async function choosePdf(): Promise<PdfChoice> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];

  if (!asset) {
    return null;
  }

  const pdf: PickedPdf = {
    uri: asset.uri,
    name: asset.name,
    size: asset.size ?? null,
    file: asset.file ?? null,
  };
  const problem = checkPdf(pdf);

  return problem ? { problem } : { pdf };
}
```

- [ ] **Step 4: The two calls and their mutations**

In `apps/mobile/src/data/api.ts`:

- add `startResponseSchema` and `type StartResponse` to the `@nexui/types` import;
- import `{ appendPdf, type PickedPdf }` from `./upload-form`;
- add:

```ts
// Reading a resume takes up to 60 seconds on the server, so these allow 90.
const INTAKE_TIMEOUT_MS = 90_000;

// A POST with the PDF as multipart, or with no body to start without one. Fetch sets the
// multipart boundary itself, so no Content-Type is given.
function postPdf(pdf: PickedPdf | null): RequestInit {
  if (!pdf) {
    return { method: 'POST' };
  }

  const form = new FormData();

  appendPdf(form, pdf);

  return { method: 'POST', body: form };
}

/**
 * Starts a plan that waits for its intake (job search spec, section 4), with the resume or
 * without. Answers once the file is read and the build run queued.
 */
export function startPlan(intentId: string, pdf: PickedPdf | null): Promise<StartResponse> {
  return callApi(
    `/api/intents/${intentId}/start`,
    startResponseSchema,
    postPdf(pdf),
    INTAKE_TIMEOUT_MS,
  );
}

/** Replaces a started plan's resume, as one change with Undo. */
export function replaceResume(intentId: string, pdf: PickedPdf): Promise<CommitResponse> {
  return callApi(
    `/api/intents/${intentId}/resume`,
    commitResponseSchema,
    postPdf(pdf),
    INTAKE_TIMEOUT_MS,
  );
}
```

In `apps/mobile/src/data/queries.ts`:

- add `type StartResponse` to the type import;
- add `replaceResume` and `startPlan` to the `./api` import;
- import `type PickedPdf` from `./upload-form`;
- after `useCreateIntent`, add:

```ts
/**
 * Starts a plan waiting for its resume, with one or without. The answer's snapshot replaces the
 * cached plan, and Home learns it's Drafting.
 */
export function useStartPlan(): UseMutationResult<
  StartResponse,
  Error,
  { intentId: string; pdf: PickedPdf | null }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ intentId, pdf }) => startPlan(intentId, pdf),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.intent(result.snapshot.intent.id), result.snapshot);
      refreshLists(client);
    },
  });
}

/** Replaces a started plan's resume. The answer is a change, so it can be undone. */
export function useReplaceResume(): UseMutationResult<
  CommitResponse,
  Error,
  { intentId: string; pdf: PickedPdf }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ intentId, pdf }) => replaceResume(intentId, pdf),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.intent(result.snapshot.intent.id), result.snapshot);
      refreshLists(client);
    },
  });
}
```

In `apps/mobile/src/data/index.ts`, add `useReplaceResume` and `useStartPlan` to the `./queries` export, and:

```ts
export { choosePdf } from './pick-pdf';
export type { PdfChoice } from './pick-pdf';
export type { PickedPdf } from './upload-form';
```

- [ ] **Step 5: The actions, and the insight's buttons**

In `apps/mobile/src/features/workspace/workspace-actions.ts`, add three members to `WorkspaceAction`:

```ts
  | { type: 'upload'; docType: 'resume' }
  | { type: 'start' }
  | { type: 'copy'; text: string };
```

Replace `fromInsightAction`:

```ts
/** An insight's button as an action. */
export function fromInsightAction(action: InsightAction): WorkspaceAction {
  switch (action.type) {
    case 'ask':
      return { type: 'ask', prompt: action.prompt };
    case 'capability':
      return {
        type: 'capability',
        request: { name: action.name, input: action.input },
        optimistic: [],
      };
    case 'upload':
      return { type: 'upload', docType: action.docType };
    case 'start':
      return { type: 'start' };
    case 'copy':
      return { type: 'copy', text: action.text };
  }
}
```

In `sections/insight-section.tsx`:

- delete the comment Task 6 left about undrawn buttons;
- change `buttons` to `data.actions.map((action) => ({ label: action.label, next: fromInsightAction(action) }))`;
- change each button's `disabled` to `busy && next.type !== 'ask' && next.type !== 'copy'`.

- [ ] **Step 6: The workspace screen sends files, starts and copies**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

- import `* as Clipboard from 'expo-clipboard';`;
- import `{ anchorMeta, intakeRoute, TEMPLATE_INTAKES }` from `@nexui/types`;
- add `choosePdf`, `useReplaceResume`, `useStartPlan` and `type PickedPdf` to the `#data` import.

After `const undo = useUndo();`, add:

```tsx
const start = useStartPlan();
const replace = useReplaceResume();
const [notice, setNotice] = useState<string | null>(null);
```

After `const band = useRevealOpenBand(…);`, add:

```tsx
const busy = edit.isPending || start.isPending || replace.isPending;

// A picked PDF goes where the plan's intake takes it: `start` before its first run, `resume`
// after (job search spec, section 4).
const sendPdf = (pdf: PickedPdf): void => {
  if (!snapshot) {
    return;
  }

  if (intakeRoute(snapshot.intent) === 'resume') {
    replace.mutate({ intentId: id, pdf }, { onSuccess: (result) => setUndoable(result.event.id) });

    return;
  }

  start.mutate({ intentId: id, pdf });
};

const addFile = async (): Promise<void> => {
  setNotice(null);

  try {
    const choice = await choosePdf();

    if (!choice) {
      return;
    }

    if ('problem' in choice) {
      setNotice(choice.problem);

      return;
    }

    sendPdf(choice.pdf);
  } catch {
    setNotice("Couldn't open your files. Try again.");
  }
};

const copy = async (text: string): Promise<void> => {
  try {
    await Clipboard.setStringAsync(text);
    setNotice('Copied.');
  } catch {
    setNotice("Couldn't copy that.");
  }
};
```

Add three cases to `handleAction`'s switch, before `link`:

```tsx
      case 'upload':
        void addFile();

        return;
      case 'start':
        start.mutate({ intentId: id, pdf: null });

        return;
      case 'copy':
        void copy(action.text);

        return;
```

In `renderBody`, after `const meta = anchorMeta(data);`, add:

```tsx
const intake = data.intent.template ? TEMPLATE_INTAKES[data.intent.template] : null;
const reading =
  intake !== null && (replace.isPending || (start.isPending && Boolean(start.variables?.pdf)));
```

After the `RefetchNotice` line, add:

```tsx
{
  reading ? (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {intake?.reading}
    </Text>
  ) : null;
}
{
  notice ? (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {notice}
    </Text>
  ) : null;
}
{
  start.isError ? (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      Couldn&apos;t start this plan. {start.error.message}
    </Text>
  ) : null;
}
{
  replace.isError ? (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      Couldn&apos;t add that resume. {replace.error.message}
    </Text>
  ) : null;
}
```

Change every `busy={edit.isPending}` on `SectionView` to `busy={busy}`, and add the style `notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },`.

- [ ] **Step 7: The object screen does the same**

In `apps/mobile/src/app/(app)/object.tsx`, add the same imports, `start`, `replace`, `notice`, `busy`, `sendPdf`, `addFile` and `copy`, and the same three switch cases. Two differences:

- `snapshot` is `intent.data`;
- `id` is `intentId`.

Show the reading line, `notice` and the two errors above `renderBody()` exactly as in Step 6 (with `intake` read from `intent.data`), and pass `busy={busy}` to `DetailView`. Task 15's **Replace** and Task 14's **Copy** report these actions from a sheet.

- [ ] **Step 8: Run the tests**

Run: `node --experimental-strip-types --test tests/mobile-upload-form.test.mjs tests/mobile-workspace-actions.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (710).

Smoke on Expo web, against the dev API with `AI_PROVIDER=mock` and `JOB_SEARCH=on` (the API on 3010, Expo web on 8091):

1. Make a fictional resume PDF:

   ```bash
   node --experimental-strip-types -e "import('./scripts/eval-jobs/resumes.mjs').then(({ RESUMES, resumePdf }) => require('node:fs').writeFileSync(process.argv[1], resumePdf(Object.keys(RESUMES)[0])))" <session tmp>/cv.pdf
   ```

2. Start a job search from + with `Find a Staff PM role in London` (the mock fixture routes "staff pm"). The sheet still opens the plan at once (Task 16 draws the step). Check:
   - the Open band shows `Add your resume to start` with **Add resume** and **Start without**;
   - **Add resume** with `cv.pdf` shows `Reading your resume…`, then the plan reads Drafting;
   - after the build, the card is gone or reads `Couldn't read that PDF. Try another file.`, as the mock read answers.
3. Start a second plan, and **Start without** starts it with no file. A later **Add resume** replaces the resume with Undo.

Delete the smoke plans afterwards.

- [ ] **Step 9: Commit**

Message: `Draw the resume card's buttons: pick a PDF, start or replace, and copy`

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/src tests/mobile-upload-form.test.mjs tests/mobile-workspace-actions.test.mjs
git commit -F <message file>
```

---

### Task 11: `features/jobs/` and the timeline

Spec section 3.2 item 5. `features/jobs/` starts with its link helpers and the "Coming up" timeline:

- interviews by `data.at`, soonest first;
- split into upcoming and past by the device clock, for display only;
- the past folded to a count;
- a row opens the role its interview is `for` (Departure 8).

The import-direction test gains the jobs folder.

**Files:**

- Create: `apps/mobile/src/features/jobs/{job-parts.ts,timeline.ts,index.ts}`, `apps/mobile/src/features/jobs/sections/timeline-section.tsx`
- Modify: `apps/mobile/src/features/registry/section-registry.tsx`
- Create: `tests/mobile-jobs-timeline.test.mjs`
- Modify: `tests/mobile-import-direction.test.mjs`

**Interfaces:**

- Produces, from `features/jobs/job-parts.ts` (pure):
  - `linkedTo(snapshot, objectId: string, type: string): GraphObject | null`
  - `linkedFrom(snapshot, objectId: string, type: string, kind: string): GraphObject[]`
  - `companyName(snapshot, roleId: string): string | null`
  - `isUpcoming(at: string, now: Date): boolean`
  - `interviewsFor(snapshot, roleId: string): GraphObject[]` (soonest first)
  - `nextInterview(snapshot, roleId: string, now: Date): InterviewData | null`
- Produces, from `features/jobs/timeline.ts` (pure):
  - `interface TimelineRow { id; weekday; day; title; detail: string; opens: string | null }`
  - `timelineRows(section, objects, snapshot, now: Date, timeZone?: string): { upcoming: TimelineRow[]; past: TimelineRow[] }`
- Produces, from `#features/jobs`: `TimelineSection`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-jobs-timeline.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import { timelineRows } from '../apps/mobile/src/features/jobs/timeline.ts';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  ROLE_ID,
  roleData,
  SEARCH_ID,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z'); // a Thursday
const ZONE = 'Europe/London';
const PAST_ID = 'f2000000-0000-4000-8000-000000000010';
const DATE_ID = 'f2000000-0000-4000-8000-000000000011';
const LOOSE_ID = 'f2000000-0000-4000-8000-000000000012';
const section = jobSearchWorkspace(SEARCH_ID).sections.find((entry) => entry.type === 'timeline');
const interview = (id, data) => jobObject(id, 'interview', data, { title: data.label });

// Corvid's Staff PM role, the given interviews, and `for` links from those named.
function rowsOf(interviews, forRole) {
  const snapshot = jobSnapshot({
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Corvid', target: false }, { title: 'Corvid' }),
      jobObject(ROLE_ID, 'opportunity', roleData({ stage: 'interviewing' }), { title: 'Staff PM' }),
      ...interviews,
    ],
    links: [
      jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
      ...forRole.map((id, n) => jobLink(10 + n, id, ROLE_ID, 'for')),
    ],
  });

  return timelineRows(section, interviews, snapshot, NOW, ZONE);
}

test('interviews coming up show soonest first, and the past folds away newest first', () => {
  const rows = rowsOf(
    [
      interview(INTERVIEW_ID, {
        at: '2026-10-09T13:00:00Z',
        label: 'Phone screen',
        with: 'Maya Chen',
      }),
      interview(PAST_ID, { at: '2026-10-01T09:00:00Z', label: 'Recruiter screen' }),
      interview(DATE_ID, { at: '2026-10-08', label: 'Panel' }),
    ],
    [INTERVIEW_ID, PAST_ID, DATE_ID],
  );

  assert.deepEqual(rows.upcoming, [
    { id: DATE_ID, weekday: 'THU', day: '8', title: 'Panel · Corvid', detail: '', opens: ROLE_ID },
    {
      id: INTERVIEW_ID,
      weekday: 'FRI',
      day: '9',
      title: 'Phone screen · Corvid',
      detail: '2:00 PM · with Maya Chen',
      opens: ROLE_ID,
    },
  ]);
  assert.deepEqual(
    rows.past.map((row) => [row.id, row.weekday, row.day, row.detail]),
    [[PAST_ID, 'THU', '1', '10:00 AM']],
  );
});

test('a time near midnight reads in the zone; an interview with no role opens nothing', () => {
  const rows = rowsOf(
    [interview(LOOSE_ID, { at: '2026-10-09T23:30:00-07:00', label: 'Panel' })],
    [],
  );

  assert.deepEqual(rows.upcoming, [
    { id: LOOSE_ID, weekday: 'SAT', day: '10', title: 'Panel', detail: '7:30 AM', opens: null },
  ]);
  assert.deepEqual(rows.past, []);
});
```

In `tests/mobile-import-direction.test.mjs`, append:

```js
test('the template folders never import each other', { timeout: 120_000 }, async () => {
  assert.equal(
    await refusals('src/features/jobs/probe.ts', probe('#features/travel', 'RouteSection')),
    1,
  );
  assert.equal(
    await refusals('src/features/travel/probe.ts', probe('#features/jobs', 'TimelineSection')),
    1,
  );
  assert.equal(
    await refusals('src/features/workspace/probe.ts', probe('#features/jobs', 'TimelineSection')),
    1,
  );
});
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-timeline.test.mjs`
Expected: FAIL, `Cannot find module '…/features/jobs/timeline.ts'`.

- [ ] **Step 2: The jobs folder's link helpers**

Create `apps/mobile/src/features/jobs/job-parts.ts`:

```ts
import {
  interviewTime,
  type GraphObject,
  type GraphSnapshot,
  type InterviewData,
} from '@nexui/types';

import { isDateOnly } from '#lib';

/**
 * The object `objectId` links to by `type`: a role's company is `at`, an interview's role is
 * `for` (job search spec, section 3.1).
 *
 * @example linkedTo(snapshot, roleId, 'at') // the role's company
 */
export function linkedTo(
  snapshot: GraphSnapshot,
  objectId: string,
  type: string,
): GraphObject | null {
  const edge = snapshot.relationships.find(
    (relationship) => relationship.sourceId === objectId && relationship.type === type,
  );

  return edge ? (snapshot.objects.find((object) => object.id === edge.targetId) ?? null) : null;
}

/** The objects of `kind` that link to `objectId` by `type`: a role's drafts are `for` it. */
export function linkedFrom(
  snapshot: GraphSnapshot,
  objectId: string,
  type: string,
  kind: string,
): GraphObject[] {
  const sources = new Set(
    snapshot.relationships
      .filter((relationship) => relationship.targetId === objectId && relationship.type === type)
      .map((relationship) => relationship.sourceId),
  );

  return snapshot.objects.filter((object) => object.kind === kind && sources.has(object.id));
}

/** The name of the company a role is `at`, or null. */
export function companyName(snapshot: GraphSnapshot, roleId: string): string | null {
  const name = linkedTo(snapshot, roleId, 'at')?.data.name;

  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * True while an interview is still ahead by the device clock (spec section 3.2: for display
 * only). One on a date with no time counts as ahead all that day.
 */
export function isUpcoming(at: string, now: Date): boolean {
  const end = isDateOnly(at) ? Date.parse(`${at}T23:59:59Z`) : interviewTime(at);

  return end >= now.getTime();
}

/** A role's interviews, soonest first. */
export function interviewsFor(snapshot: GraphSnapshot, roleId: string): GraphObject[] {
  const at = (object: GraphObject): number => interviewTime((object.data as InterviewData).at);

  return linkedFrom(snapshot, roleId, 'for', 'interview').sort((a, b) => at(a) - at(b));
}

/** A role's next interview by the device clock, or null. */
export function nextInterview(
  snapshot: GraphSnapshot,
  roleId: string,
  now: Date,
): InterviewData | null {
  const next = interviewsFor(snapshot, roleId).find((interview) =>
    isUpcoming((interview.data as InterviewData).at, now),
  );

  return next ? (next.data as InterviewData) : null;
}
```

- [ ] **Step 3: The timeline's rows**

Create `apps/mobile/src/features/jobs/timeline.ts`:

```ts
import {
  interviewTime,
  readField,
  type GraphObject,
  type GraphSnapshot,
  type Section,
} from '@nexui/types';

import { formatTime, isDateOnly } from '#lib';

import { companyName, isUpcoming, linkedTo } from './job-parts.ts';

type TimelineSection = Extract<Section, { type: 'timeline' }>;

/** One row: the day block, what and with whom, and what a tap opens. */
export interface TimelineRow {
  id: string;
  /** The day block: "THU" over "9". */
  weekday: string;
  day: string;
  /** "Phone screen · Corvid". */
  title: string;
  /** "2:00 PM · with Maya Chen"; a date with no time has no time here. */
  detail: string;
  /** The role the interview is for, which a tap opens, or null. */
  opens: string | null;
}

export interface Timeline {
  /** Soonest first. */
  upcoming: TimelineRow[];
  /** Most recent first; the primitive folds them to a count. */
  past: TimelineRow[];
}

// The day block in the given zone (the device's when none), or in UTC for a date alone.
function dayBlock(at: string, timeZone?: string): { weekday: string; day: string } {
  const zone = isDateOnly(at) ? 'UTC' : timeZone;
  const date = new Date(interviewTime(at));

  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone })
      .format(date)
      .toUpperCase(),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: zone }).format(date),
  };
}

const joined = (parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0).join(' · ');

/**
 * The timeline's rows (spec section 3.2): each object by its date field, split into upcoming and
 * past by the device clock, for display only. A row reads the label field, the company of the
 * role the object is `for`, and who it's with. Objects with no readable date are left out.
 */
export function timelineRows(
  section: TimelineSection,
  objects: readonly GraphObject[],
  snapshot: GraphSnapshot,
  now: Date,
  timeZone?: string,
): Timeline {
  const dated = objects.flatMap((object) => {
    const at = readField(object, section.dateField);

    if (typeof at !== 'string' || Number.isNaN(interviewTime(at))) {
      return [];
    }

    const label = readField(object, section.labelField);
    const role = linkedTo(snapshot, object.id, 'for');
    const whom = object.data.with;
    const row: TimelineRow = {
      id: object.id,
      ...dayBlock(at, timeZone),
      title: joined([
        typeof label === 'string' ? label : '',
        role ? (companyName(snapshot, role.id) ?? '') : '',
      ]),
      detail: joined([
        formatTime(at, timeZone),
        typeof whom === 'string' && whom.length > 0 ? `with ${whom}` : '',
      ]),
      opens: role?.id ?? null,
    };

    return [{ row, at, time: interviewTime(at) }];
  });
  const byTime = dated.sort((a, b) => a.time - b.time);

  return {
    upcoming: byTime.filter((entry) => isUpcoming(entry.at, now)).map((entry) => entry.row),
    past: byTime
      .filter((entry) => !isUpcoming(entry.at, now))
      .reverse()
      .map((entry) => entry.row),
  };
}
```

- [ ] **Step 4: The primitive**

Create `apps/mobile/src/features/jobs/sections/timeline-section.tsx`:

```tsx
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { SectionFrame, type SectionProps } from '#features/workspace';

import { timelineRows, type TimelineRow } from '../timeline';

function Row({
  row,
  past,
  onOpen,
}: {
  row: TimelineRow;
  past: boolean;
  onOpen: (objectId: string) => void;
}): ReactElement {
  const styles = useStyles();
  const label = [row.weekday, row.day, row.title, row.detail].filter(Boolean).join(', ');
  const opens = row.opens;
  const body = (
    <>
      <View style={[styles.day, past && styles.dim]}>
        <Text style={styles.weekday}>{row.weekday}</Text>
        <Text style={styles.date}>{row.day}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{row.title}</Text>
        {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
      </View>
    </>
  );

  if (!opens) {
    return (
      <View accessible accessibilityLabel={label} style={styles.row}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show the role`}
      onPress={() => onOpen(opens)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * What's coming up (spec section 3.2): interviews soonest first, with the past folded to a
 * count. A row opens the role its interview is for. "Now" is read when the plan's data changes,
 * so an interview that passes while the plan stays open moves to the past on the next change.
 */
export function TimelineSection({
  section,
  data,
  snapshot,
  onAction,
}: SectionProps<'timeline'>): ReactElement {
  const styles = useStyles();
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = useMemo(
    () => timelineRows(section, data.objects, snapshot, new Date()),
    [section, data.objects, snapshot],
  );
  const open = (objectId: string): void => onAction({ type: 'open', objectId });

  return (
    <SectionFrame title={section.title}>
      {upcoming.length === 0 ? (
        <Text style={styles.empty}>{section.empty ?? 'Nothing coming up.'}</Text>
      ) : null}
      {upcoming.map((row) => (
        <Row key={row.id} row={row} past={false} onOpen={open} />
      ))}
      {past.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showPast }}
          onPress={() => setShowPast((shown) => !shown)}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            Past · {past.length} {showPast ? '▴' : '▾'}
          </Text>
        </Pressable>
      ) : null}
      {showPast ? past.map((row) => <Row key={row.id} row={row} past onOpen={open} />) : null}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  pressed: { opacity: 0.7 },
  day: { minWidth: 40, alignItems: 'center' },
  dim: { opacity: 0.6 },
  weekday: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.faint },
  date: { fontFamily: fonts.display, fontSize: 22, lineHeight: 24, color: colors.ink },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
}));
```

Create `apps/mobile/src/features/jobs/index.ts`:

```ts
export { TimelineSection } from './sections/timeline-section';
```

In `features/registry/section-registry.tsx`:

- import `{ TimelineSection } from '#features/jobs';`;
- set `timeline: TimelineSection,`.

- [ ] **Step 5: Run the tests**

Run: `node --experimental-strip-types --test tests/mobile-jobs-timeline.test.mjs tests/mobile-import-direction.test.mjs`
Expected: PASS.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (713).

- [ ] **Step 6: Commit**

Message: `Draw a job search's interviews coming up`

```bash
git add apps/mobile/src/features tests/mobile-jobs-timeline.test.mjs tests/mobile-import-direction.test.mjs
git commit -F <message file>
```

---

### Task 12: The pipeline, and Pass with a reason

Spec section 3.2 items 6 and the card actions, and spikes note 3.4 item 4 (Decision 11).

- **Roles by stage.** New always shows first, with the AI disclosure; any other stage shows only with roles in it; Closed folds to a count row.
- **New cards** are AI-marked: highlighter and dashed outline, why each fits, then **Interested** and **Pass**.
- **Pass** opens the reason picker inside the card; **Skip, just pass** passes with none.
- **Interested and Pass move the card at once.**
- **Every card opens the role.**

**Files:**

- Modify: `packages/types/src/kinds/jobs/schemas.ts` (`WORK_MODES`)
- Create: `apps/mobile/src/features/jobs/{job-format.ts,role-actions.ts,pipeline.ts}`, `apps/mobile/src/features/jobs/sections/{pipeline-section.tsx,pass-picker.tsx}`
- Modify: `apps/mobile/src/features/jobs/index.ts`, `apps/mobile/src/features/registry/section-registry.tsx`, `apps/mobile/src/features/workspace/workspace-layout.ts`
- Create: `tests/mobile-jobs-pipeline.test.mjs`
- Modify: `tests/mobile-workspace-layout.test.mjs`

**Interfaces:**

- Produces, from `@nexui/types`: `WORK_MODES: readonly { value: WorkMode; label: string }[]` (`Remote`, `Hybrid`, `On-site`).
- Produces, from `features/jobs/job-format.ts` (pure):
  - `workModeLabel(mode: WorkMode): string`
  - `salaryText(salary?: Salary): string`
  - `placeLine(role: Pick<OpportunityData, 'location' | 'workMode'>): string`
  - `roleLine(role: OpportunityData, company: string | null): string`
  - `outcomeLabel(outcome: Outcome): string`
- Produces, from `features/jobs/role-actions.ts` (pure):
  - `stageAction(role: GraphObject, stage: Stage, outcome?: Outcome): CapabilityAction`
  - `passAction(role: GraphObject, reason: PassReason | null): CapabilityAction`
  - `cardAction(role: GraphObject, action: CardAction, reason: PassReason | null): CapabilityAction`
- Produces, from `features/jobs/pipeline.ts` (pure):
  - `interface PipelineCard { role; title; line; fit: { reasons; gaps } | null; note; ai; actions: CardAction[] }`
  - `interface PipelineGroup { stage; label; collapsed: boolean; cards: PipelineCard[] }`
  - `pipelineGroups(section, roles, snapshot, now?: Date, timeZone?: string): PipelineGroup[]`
- Produces, from `#features/jobs`: `PipelineSection`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-jobs-pipeline.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { jobSearchWorkspace } from '../apps/api/src/lib/jobs/seed.ts';
import {
  outcomeLabel,
  placeLine,
  roleLine,
  salaryText,
} from '../apps/mobile/src/features/jobs/job-format.ts';
import { pipelineGroups } from '../apps/mobile/src/features/jobs/pipeline.ts';
import { cardAction, stageAction } from '../apps/mobile/src/features/jobs/role-actions.ts';
import { applyOps } from '../packages/types/src/apply-ops.ts';
import { RUN_ID, STAMP } from './support/graph.mjs';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  OTHER_ROLE_ID,
  ROLE_ID,
  roleData,
  SEARCH_ID,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const ZONE = 'Europe/London';
const APPLIED_ID = 'f2000000-0000-4000-8000-000000000020';
const CLOSED_ID = 'f2000000-0000-4000-8000-000000000021';
const BARE_ID = 'f2000000-0000-4000-8000-000000000022';
const section = jobSearchWorkspace(SEARCH_ID).sections.find((entry) => entry.type === 'pipeline');
const [interested, pass] = section.cardActions[0].actions;
const role = (id, data, extra = {}) =>
  jobObject(id, 'opportunity', data, { title: data.title, ...extra });

const found = role(
  ROLE_ID,
  roleData({
    salary: { min: 130_000, max: 150_000, currency: 'GBP' },
    fit: { score: 0.91, reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
  }),
  { source: { type: 'ai', runId: RUN_ID } },
);
const roles = [
  found,
  role(OTHER_ROLE_ID, roleData({ title: 'Staff PM, Lending', stage: 'interviewing' })),
  role(
    APPLIED_ID,
    roleData({
      title: 'Senior PM',
      stage: 'applied',
      appliedAt: '2026-09-26T09:00:00.000Z',
    }),
  ),
  role(CLOSED_ID, roleData({ title: 'Lead PM, Risk', stage: 'closed', outcome: 'passed' })),
];
const snapshot = jobSnapshot({
  objects: [
    jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
    ...roles,
    jobObject(INTERVIEW_ID, 'interview', { at: '2026-10-09T13:00:00Z', label: 'Phone screen' }),
  ],
  links: roles
    .map((entry, n) => jobLink(1 + n, entry.id, COMPANY_ID, 'at'))
    .concat([jobLink(9, INTERVIEW_ID, OTHER_ROLE_ID, 'for')]),
});

test('roles group by stage: New first and AI-marked with its fit, Closed folded', () => {
  const groups = pipelineGroups(section, roles, snapshot, NOW, ZONE);

  assert.deepEqual(
    groups.map((group) => [group.label, group.collapsed, group.cards.length]),
    [
      ['New', false, 1],
      ['Applied', false, 1],
      ['Interviewing', false, 1],
      ['Closed', true, 1],
    ],
  );

  const [newCard] = groups[0].cards;

  assert.deepEqual(
    [newCard.title, newCard.line, newCard.ai, newCard.fit, newCard.actions.map((a) => a.label)],
    [
      'Staff Product Manager, Payments',
      'Halyard · London, hybrid · £130k–£150k',
      true,
      { reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
      ['Interested', 'Pass'],
    ],
  );
  assert.equal(groups[1].cards[0].note, 'Applied Sep 26 · follow-up due');
  assert.equal(groups[2].cards[0].note, 'Phone screen Fri, Oct 9, 2:00 PM');
  assert.equal(groups[3].cards[0].note, 'Passed');
});

test('New shows even when empty, and a role with almost nothing still draws', () => {
  const bare = role(BARE_ID, { title: 'Role', stage: 'interviewing', followUps: 0 });
  const groups = pipelineGroups(section, [bare], jobSnapshot({ objects: [bare] }), NOW, ZONE);

  assert.deepEqual(
    groups.map((group) => [group.label, group.cards.length]),
    [
      ['New', 0],
      ['Interviewing', 1],
    ],
  );
  assert.deepEqual(
    [groups[1].cards[0].title, groups[1].cards[0].line, groups[1].cards[0].note],
    ['Role', '', 'Interviewing'],
  );
});

test('Interested and Pass call the doc’s capability with the role, and move it at once', () => {
  const keen = cardAction(found, interested, null);
  const passed = cardAction(found, pass, 'wrong_location');
  const skipped = cardAction(found, pass, null);
  const after = (action) =>
    applyOps(snapshot, action.optimistic, STAMP).objects.find((o) => o.id === ROLE_ID).data;

  assert.deepEqual(keen.request, {
    name: 'jobs.setStage',
    input: { objectId: ROLE_ID, stage: 'interested' },
  });
  assert.equal(after(keen).stage, 'interested');
  assert.deepEqual(passed.request, {
    name: 'jobs.pass',
    input: { objectId: ROLE_ID, reason: 'wrong_location' },
  });
  assert.deepEqual([after(passed).stage, after(passed).outcome], ['closed', 'passed']);
  assert.deepEqual(skipped.request.input, { objectId: ROLE_ID });
  assert.deepEqual(
    cardAction(found, { label: 'Hm', capability: 'jobs.other', tone: 'secondary' }, null),
    {
      type: 'capability',
      request: { name: 'jobs.other', input: { objectId: ROLE_ID } },
      optimistic: [],
    },
  );
});

test('moving a closed role drops its outcome; closing one sets it', () => {
  const closed = roles[3];

  assert.equal('outcome' in stageAction(closed, 'interested').optimistic[0].patch.data, false);
  assert.deepEqual(stageAction(found, 'closed', 'rejected').request.input, {
    objectId: ROLE_ID,
    stage: 'closed',
    outcome: 'rejected',
  });
});

test('pay, place and outcome read as the cards show them', () => {
  assert.equal(salaryText({ min: 90_000, currency: 'USD' }), 'from $90k');
  assert.equal(salaryText({ max: 90_000, currency: 'USD' }), 'up to $90k');
  assert.equal(salaryText({ min: 90_000, max: 90_000, currency: 'USD' }), '$90k');
  assert.equal(salaryText(undefined), '');
  assert.equal(placeLine({ workMode: 'onsite' }), 'On-site');
  assert.equal(placeLine({ location: 'Leeds' }), 'Leeds');
  assert.equal(roleLine({ title: 'x', stage: 'new', followUps: 0 }, null), '');
  assert.equal(outcomeLabel('no_reply'), 'No reply');
});
```

In `tests/mobile-workspace-layout.test.mjs`, rename the test `'a pinned pipeline or timeline never makes an Open band: they draw nothing yet'` to `'a pinned pipeline or timeline never makes an Open band: they list, they never wait on the user'`. Its assertion stays.

Run: `node --experimental-strip-types --test tests/mobile-jobs-pipeline.test.mjs`
Expected: FAIL, `Cannot find module '…/features/jobs/job-format.ts'`.

- [ ] **Step 2: Work modes, and the formatters**

In `packages/types/src/kinds/jobs/schemas.ts`, after `workModeSchema`, add:

```ts
/** Work modes in the order the search sheet offers them. */
export const WORK_MODES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
] as const satisfies readonly { value: z.infer<typeof workModeSchema>; label: string }[];
```

Create `apps/mobile/src/features/jobs/job-format.ts`:

```ts
import {
  OUTCOME_LABELS,
  WORK_MODES,
  type OpportunityData,
  type Outcome,
  type Salary,
  type WorkMode,
} from '@nexui/types';

import { capitalize, formatMoney } from '#lib';

/** @example workModeLabel('onsite') // 'On-site' */
export function workModeLabel(mode: WorkMode): string {
  return WORK_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

/**
 * A role's pay as the board gave it.
 *
 * @example
 * salaryText({ min: 130000, max: 150000, currency: 'GBP' }) // '£130k–£150k'
 * salaryText({ min: 90000, currency: 'USD' }) // 'from $90k'
 */
export function salaryText(salary: Salary | undefined): string {
  if (!salary) {
    return '';
  }

  const money = (amount: number): string => formatMoney({ amount, currency: salary.currency });

  if (salary.min !== undefined && salary.max !== undefined) {
    return salary.min === salary.max
      ? money(salary.min)
      : `${money(salary.min)}–${money(salary.max)}`;
  }

  if (salary.min !== undefined) {
    return `from ${money(salary.min)}`;
  }

  return salary.max === undefined ? '' : `up to ${money(salary.max)}`;
}

/** Where a role is and how it's worked: "London, hybrid", "On-site", or ''. */
export function placeLine(role: Pick<OpportunityData, 'location' | 'workMode'>): string {
  const mode = role.workMode ? workModeLabel(role.workMode) : '';

  if (role.location && mode) {
    return `${role.location}, ${mode.toLowerCase()}`;
  }

  return role.location ?? mode;
}

/** A role's card line, leaving out what it lacks: "Halyard · London, hybrid · £130k–£150k". */
export function roleLine(role: OpportunityData, company: string | null): string {
  return [company ?? '', placeLine(role), salaryText(role.salary)]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/** @example outcomeLabel('no_reply') // 'No reply' */
export function outcomeLabel(outcome: Outcome): string {
  return capitalize(OUTCOME_LABELS[outcome]);
}
```

- [ ] **Step 3: The role's actions**

Create `apps/mobile/src/features/jobs/role-actions.ts`:

```ts
import {
  stageSchema,
  type CardAction,
  type ChangesetOp,
  type GraphObject,
  type OpportunityData,
  type Outcome,
  type PassReason,
  type Stage,
} from '@nexui/types';

import type { CapabilityAction } from '#features/workspace';

// The role as it shows at once: its new stage, with an outcome only while closed.
function moved(role: GraphObject, stage: Stage, outcome?: Outcome): ChangesetOp[] {
  const data: OpportunityData = { ...(role.data as OpportunityData), stage };

  if (stage === 'closed' && outcome) {
    data.outcome = outcome;
  } else {
    delete data.outcome;
  }

  return [{ op: 'update_object', id: role.id, patch: { data }, origin: 'direct' }];
}

/**
 * Moves a role to a stage, or closes it with an outcome, through `jobs.setStage`, shown at once.
 *
 * @example stageAction(role, 'closed', 'rejected')
 */
export function stageAction(role: GraphObject, stage: Stage, outcome?: Outcome): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'jobs.setStage',
      input: outcome ? { objectId: role.id, stage, outcome } : { objectId: role.id, stage },
    },
    optimistic: moved(role, stage, outcome),
  };
}

/** Passes on a role through `jobs.pass`, with the picker's reason or none, shown at once. */
export function passAction(role: GraphObject, reason: PassReason | null): CapabilityAction {
  return {
    type: 'capability',
    request: {
      name: 'jobs.pass',
      input: reason ? { objectId: role.id, reason } : { objectId: role.id },
    },
    optimistic: moved(role, 'closed', 'passed'),
  };
}

/**
 * A pipeline card's button (spec section 3.2): the doc's capability with `{ objectId, ...input }`.
 * The two job search knows, `jobs.setStage` and `jobs.pass`, show at once; any other waits for
 * the server.
 */
export function cardAction(
  role: GraphObject,
  action: CardAction,
  reason: PassReason | null,
): CapabilityAction {
  const input = { ...action.input, objectId: role.id };
  const stage = stageSchema.safeParse(input.stage);

  if (action.capability === 'jobs.pass') {
    return passAction(role, reason);
  }

  if (action.capability === 'jobs.setStage' && stage.success) {
    return stageAction(role, stage.data);
  }

  return { type: 'capability', request: { name: action.capability, input }, optimistic: [] };
}
```

- [ ] **Step 4: The pipeline's groups**

Create `apps/mobile/src/features/jobs/pipeline.ts`:

```ts
import {
  followUpState,
  readField,
  type CardAction,
  type GraphObject,
  type GraphSnapshot,
  type OpportunityData,
  type Section,
} from '@nexui/types';

import { aiMarkFor, formatDate, formatDateTime } from '#lib';

import { outcomeLabel, roleLine } from './job-format.ts';
import { companyName, nextInterview } from './job-parts.ts';

type PipelineSection = Extract<Section, { type: 'pipeline' }>;

/** One role's card. */
export interface PipelineCard {
  role: GraphObject;
  title: string;
  /** "Halyard · London, hybrid · £130k–£150k". */
  line: string;
  /** Why it fits and its gaps, on a role still in New. */
  fit: { reasons: string[]; gaps: string[] } | null;
  /** Where it stands past New: "Applied Sep 26 · follow-up due", "Phone screen Fri, Oct 9, 2:00 PM". */
  note: string;
  /** Nexui found it and the user hasn't touched it: the highlighter and a dashed outline. */
  ai: boolean;
  /** The stage's buttons (New's Interested and Pass), or none. */
  actions: CardAction[];
}

export interface PipelineGroup {
  stage: string;
  label: string;
  /** Shown as one count row, opened on tap (closed roles). */
  collapsed: boolean;
  cards: PipelineCard[];
}

// Where a role stands, past New.
function noteFor(role: GraphObject, snapshot: GraphSnapshot, now: Date, timeZone?: string): string {
  const data = role.data as OpportunityData;

  switch (data.stage) {
    case 'applied': {
      const applied = data.appliedAt
        ? `Applied ${formatDate(data.appliedAt, timeZone)}`
        : 'Applied';
      const nudge = followUpState(data, now);

      if (nudge === 'due') {
        return `${applied} · follow-up due`;
      }

      return nudge === 'close' ? `${applied} · no reply` : applied;
    }

    case 'interviewing': {
      const next = nextInterview(snapshot, role.id, now);

      return next ? `${next.label} ${formatDateTime(next.at, timeZone)}` : 'Interviewing';
    }

    case 'closed':
      return data.outcome ? outcomeLabel(data.outcome) : '';
    default:
      return '';
  }
}

/**
 * The pipeline's groups in the doc's stage order (spec section 3.2). The first stage (New) always
 * shows, even empty, since it carries the AI disclosure; any other shows only with roles in it.
 * A collapsed stage (Closed) is one count row.
 */
export function pipelineGroups(
  section: PipelineSection,
  roles: readonly GraphObject[],
  snapshot: GraphSnapshot,
  now: Date = new Date(),
  timeZone?: string,
): PipelineGroup[] {
  return section.stages.flatMap((stage, index) => {
    const inStage = roles.filter((role) => readField(role, section.stageField) === stage.value);

    if (inStage.length === 0 && index > 0) {
      return [];
    }

    const actions =
      section.cardActions?.find((entry) => entry.stage === stage.value)?.actions ?? [];

    return [
      {
        stage: stage.value,
        label: stage.label,
        collapsed: section.collapsedStages.includes(stage.value),
        cards: inStage.map((role) => {
          const data = role.data as OpportunityData;

          return {
            role,
            title: data.title,
            line: roleLine(data, companyName(snapshot, role.id)),
            fit:
              data.stage === 'new' && data.fit
                ? { reasons: data.fit.reasons, gaps: data.fit.gaps }
                : null,
            note: noteFor(role, snapshot, now, timeZone),
            ai: aiMarkFor(role).highlight,
            actions,
          };
        }),
      },
    ];
  });
}
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: The reason picker**

Create `apps/mobile/src/features/jobs/sections/pass-picker.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { PASS_REASONS, type PassReason } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

/**
 * Why the user passes on a role (spec section 3.2): one tap on a reason, or Skip to pass with
 * none. It sits inside the role's card rather than over the page.
 */
export function PassPicker({
  title,
  busy,
  onPick,
  onCancel,
}: {
  title: string;
  busy: boolean;
  onPick: (reason: PassReason | null) => void;
  onCancel: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.picker}>
      <Text
        accessibilityRole="header"
        accessibilityLabel={`Why pass on ${title}?`}
        style={styles.title}
      >
        Why pass?
      </Text>
      <View style={styles.reasons}>
        {PASS_REASONS.map((reason) => (
          <Button
            key={reason.value}
            label={reason.label}
            disabled={busy}
            onPress={() => onPick(reason.value)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        One tap. Nexui uses it to tune the roles it picks, and you can remove it from your search
        later.
      </Text>
      <View style={styles.footer}>
        <Button
          label="Skip, just pass"
          variant="text"
          disabled={busy}
          onPress={() => onPick(null)}
        />
        <Button label="Cancel" variant="text" onPress={onCancel} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  picker: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  title: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
}));
```

- [ ] **Step 6: The primitive**

Create `apps/mobile/src/features/jobs/sections/pipeline-section.tsx`:

```tsx
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CardAction, PassReason } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { AiText, Button } from '#ui';
import { SectionFrame, type SectionProps, type WorkspaceAction } from '#features/workspace';

import { pipelineGroups, type PipelineCard, type PipelineGroup } from '../pipeline';
import { cardAction } from '../role-actions';
import { PassPicker } from './pass-picker';

const DISCLOSURE = "Picked by Nexui's AI from employers' own job boards.";

function Fit({ fit }: { fit: NonNullable<PipelineCard['fit']> }): ReactElement {
  const styles = useStyles();

  return (
    <Text style={styles.fit}>
      <Text style={styles.strong}>Fits: </Text>
      {fit.reasons.join('; ')}.
      {fit.gaps.length > 0 ? (
        <>
          {' '}
          <Text style={styles.strong}>Gaps: </Text>
          {fit.gaps.join('; ')}.
        </>
      ) : null}
    </Text>
  );
}

function RoleCard({
  card,
  busy,
  onAction,
}: {
  card: PipelineCard;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const [passing, setPassing] = useState(false);

  const press = (action: CardAction): void => {
    if (action.pick === 'passReason') {
      setPassing(true);

      return;
    }

    onAction(cardAction(card.role, action, null));
  };

  const pass = (reason: PassReason | null): void => {
    const action = card.actions.find((entry) => entry.pick === 'passReason');

    setPassing(false);

    if (action) {
      onAction(cardAction(card.role, action, reason));
    }
  };

  return (
    <View style={[styles.card, card.ai && styles.suggested]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${[card.title, card.line, card.note].filter(Boolean).join(', ')}. Show details`}
        onPress={() => onAction({ type: 'open', objectId: card.role.id })}
        style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
      >
        <AiText text={card.title} highlight={card.ai} tag={false} style={styles.title} />
        {card.line ? <Text style={styles.line}>{card.line}</Text> : null}
        {card.fit ? <Fit fit={card.fit} /> : null}
        {card.note ? <Text style={styles.note}>{card.note}</Text> : null}
      </Pressable>
      {passing ? (
        <PassPicker
          title={card.title}
          busy={busy}
          onPick={pass}
          onCancel={() => setPassing(false)}
        />
      ) : null}
      {!passing && card.actions.length > 0 ? (
        <View style={styles.buttons}>
          {card.actions.map((action) => (
            <View key={`${action.capability}-${action.label}`} style={styles.buttonSlot}>
              <Button
                label={action.label}
                accessibilityLabel={`${action.label}: ${card.title}`}
                variant={action.tone === 'primary' ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => press(action)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Group({
  group,
  first,
  busy,
  onAction,
}: {
  group: PipelineGroup;
  first: boolean;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const shown = !group.collapsed || open;

  return (
    <View style={styles.group}>
      {group.collapsed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.foldRow}
        >
          <Text style={styles.foldText}>
            {group.label} · {group.cards.length} {open ? '▴' : '▾'}
          </Text>
        </Pressable>
      ) : (
        <Text accessibilityRole="header" style={styles.groupLabel}>
          {group.label} · {group.cards.length}
        </Text>
      )}
      {first ? <Text style={styles.disclosure}>{DISCLOSURE}</Text> : null}
      {first && group.cards.length === 0 ? (
        <Text style={styles.empty}>No new roles yet. Nexui adds its best matches here.</Text>
      ) : null}
      {shown
        ? group.cards.map((card) => (
            <RoleCard key={card.role.id} card={card} busy={busy} onAction={onAction} />
          ))
        : null}
    </View>
  );
}

/**
 * Roles by stage (spec section 3.2): New first, with Nexui's picks AI-marked and Interested and
 * Pass on each; later stages only with roles in them; Closed folded to a count. Every card opens
 * its role. "Now" is read when the plan's data changes, so a follow-up note that falls due while
 * the plan stays open shows on the next change.
 */
export function PipelineSection({
  section,
  data,
  snapshot,
  onAction,
  busy,
}: SectionProps<'pipeline'>): ReactElement {
  const groups = useMemo(
    () => pipelineGroups(section, data.objects, snapshot),
    [section, data.objects, snapshot],
  );

  return (
    <SectionFrame title={section.title}>
      {groups.map((group, index) => (
        <Group
          key={group.stage}
          group={group}
          first={index === 0}
          busy={busy}
          onAction={onAction}
        />
      ))}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  group: { gap: 10 },
  groupLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  disclosure: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  foldRow: { minHeight: 44, justifyContent: 'center' },
  foldText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  card: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.soft },
  suggested: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.faint },
  cardBody: { gap: 4 },
  pressed: { opacity: 0.7 },
  title: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 21, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  fit: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  strong: { fontFamily: fonts.bodyBold },
  note: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.ink },
  buttons: { flexDirection: 'row', gap: 8 },
  buttonSlot: { flex: 1 },
}));
```

In `apps/mobile/src/features/jobs/index.ts`, add `export { PipelineSection } from './sections/pipeline-section';`.

In the section registry:

- import `PipelineSection` with `TimelineSection` from `#features/jobs`;
- set `pipeline: PipelineSection,`;
- drop `PendingSection` from the `#features/workspace` import: nothing maps to it any more.

Delete `features/workspace/sections/pending-section.tsx` and its line in `features/workspace/index.ts`.

In `features/workspace/workspace-layout.ts`'s `isUnresolved`, change the pipeline and timeline comment to `// Lists, not questions: they never wait on the user, so never open the band.`

- [ ] **Step 7: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (718).

Smoke on Expo web, a started job search. Add two roles as the QA user so there is something to triage: `POST /api/intents/<id>/capabilities` with `jobs.addRole`, through `qaApi(readSession()).call` in `scripts/lib/qa-api.mjs`. Use `{ company: { name: 'Halyard' }, title: 'Staff PM, Payments', location: 'London', workMode: 'hybrid', fit: { score: 0.9, reasons: ['Payments platform work'], gaps: [] } }` and a second at `Ledgerly`. The user path fetches nothing. Then check:

- New shows both with the disclosure;
- **Interested** moves one to Interested at once;
- **Pass** opens the picker; `Wrong location` closes the role at once, and Closed · 1 unfolds to it;
- the pass reason appears later in the search sheet (Task 15).

- [ ] **Step 8: Commit**

Message: `Draw the job search pipeline, with Interested and Pass with a reason`

```bash
git add -A packages/types/src/kinds/jobs/schemas.ts apps/mobile/src tests/mobile-jobs-pipeline.test.mjs tests/mobile-workspace-layout.test.mjs
git commit -F <message file>
```

---

### Task 13: The role sheet

Spec section 6 ("Role"), carried items 2 and 5 (Decision 2). A role opens in `/object`. The sheet shows:

- **What it is:** the title (AI-marked until edited, with **Rename**), company, place and pay.
- **Where it stands:** a stage picker. Offer adds **Accept offer** and **Decline**, and **Close this role** offers its outcomes.
- **Why it fits and its gaps.**
- **View posting**, with the host it opens and when it was last seen live (Departure 12's wording).
- **Its dates, drafts, people and interviews.**
- **I applied** and **Ask about this role.**

A draft opens in place.

**Files:**

- Modify: `apps/mobile/src/features/jobs/job-format.ts` (`linkHost`), `apps/mobile/src/features/jobs/role-actions.ts` (`renameAction`)
- Create: `apps/mobile/src/features/jobs/{role-details.ts,sheet-parts.tsx,role-body.tsx}`
- Modify: `apps/mobile/src/features/jobs/index.ts`, `apps/mobile/src/features/registry/detail-registry.tsx`
- Create: `tests/mobile-jobs-role.test.mjs`

**Interfaces:**

- Produces, from `job-format.ts`: `linkHost(url: string): string | null`.
- Produces, from `role-actions.ts`: `renameAction(role: GraphObject, title: string): CapabilityAction | null`.
- Produces, from `role-details.ts` (pure):
  - `DOC_LABELS: Record<DocumentData['docType'], string>`
  - `interface RoleDetails` (fields below)
  - `roleDetails(snapshot, roleId: string, now?: Date, timeZone?: string): RoleDetails | null`
  - `askAbout(details: RoleDetails): string`
- Produces, from `sheet-parts.tsx`: `SheetHeader({ kicker, onDone })`, `SheetSection({ title, children })`.
- Produces, from `#features/jobs`: `RoleBody`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-jobs-role.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { linkHost } from '../apps/mobile/src/features/jobs/job-format.ts';
import { renameAction } from '../apps/mobile/src/features/jobs/role-actions.ts';
import { askAbout, roleDetails } from '../apps/mobile/src/features/jobs/role-details.ts';
import { RUN_ID } from './support/graph.mjs';
import {
  COMPANY_ID,
  INTERVIEW_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  ROLE_ID,
  roleData,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const ZONE = 'Europe/London';
const DRAFT_ID = 'f2000000-0000-4000-8000-000000000030';
const PERSON_ID = 'f2000000-0000-4000-8000-000000000031';
const role = (data) => jobObject(ROLE_ID, 'opportunity', data, { title: data.title });

function planWith(roleObject, extra = []) {
  return jobSnapshot({
    objects: [
      jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
      roleObject,
      ...extra,
    ],
    links: [
      jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
      ...extra.map((object, n) => jobLink(10 + n, object.id, ROLE_ID, 'for')),
    ],
  });
}

test("a role's sheet shows where it is, why it fits, its posting and what's for it", () => {
  const applied = role(
    roleData({
      stage: 'applied',
      appliedAt: '2026-09-26T09:00:00.000Z',
      postedAt: '2026-10-02T09:00:00.000Z',
      lastSeenLiveAt: '2026-10-08T07:04:00.000Z',
      salary: { min: 130_000, max: 150_000, currency: 'GBP' },
      fit: { score: 0.9, reasons: ['Payments platform work'], gaps: ['No B2B sales'] },
    }),
  );
  const extra = [
    jobObject(
      DRAFT_ID,
      'document',
      { docType: 'cover_letter', body: 'Dear Halyard team, I am writing' },
      { source: { type: 'ai', runId: RUN_ID } },
    ),
    jobObject(PERSON_ID, 'person', { name: 'Priya Shah', role: 'recruiter' }),
    jobObject(INTERVIEW_ID, 'interview', { at: '2026-10-09T13:00:00Z', label: 'Phone screen' }),
  ];
  const details = roleDetails(planWith(applied, extra), ROLE_ID, NOW, ZONE);

  assert.deepEqual(
    {
      company: details.company,
      line: details.line,
      posting: details.posting,
      current: details.stages.filter((stage) => stage.current).map((stage) => stage.value),
      dates: details.dates,
      drafts: details.drafts,
      people: details.people,
      interviews: details.interviews,
      closed: details.closed,
    },
    {
      company: 'Halyard',
      line: 'London, hybrid · £130k–£150k',
      posting: {
        url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
        host: 'job-boards.greenhouse.io',
        note: 'Posted Oct 2 · still live today on its job board',
      },
      current: ['applied'],
      dates: ['Applied Sep 26'],
      drafts: [{ id: DRAFT_ID, label: 'Cover letter · 6 words', ai: true }],
      people: [{ name: 'Priya Shah', role: 'recruiter' }],
      interviews: [{ label: 'Phone screen', when: 'Fri, Oct 9, 2:00 PM' }],
      closed: null,
    },
  );
  assert.deepEqual(details.fit, { reasons: ['Payments platform work'], gaps: ['No B2B sales'] });
  assert.equal(askAbout(details), 'About Staff Product Manager, Payments at Halyard: ');
});

test('a role with almost nothing has no posting, fit or company, and still opens', () => {
  const bare = jobObject(ROLE_ID, 'opportunity', { title: 'Role', stage: 'new', followUps: 0 });
  const details = roleDetails(jobSnapshot({ objects: [bare] }), ROLE_ID, NOW, ZONE);

  assert.deepEqual(
    [details.company, details.line, details.posting, details.fit, details.people, details.drafts],
    [null, '', null, null, [], []],
  );
  assert.equal(askAbout(details), 'About Role: ');
  assert.equal(roleDetails(jobSnapshot(), ROLE_ID, NOW), null);
});

test("a model's link names the host it opens; one that isn't https names none", () => {
  const modelRole = role(
    roleData({ url: 'https://apply.example.net/jobs/1?ref=x', source: undefined }),
  );

  assert.equal(
    roleDetails(planWith(modelRole), ROLE_ID, NOW, ZONE).posting.host,
    'apply.example.net',
  );
  assert.equal(linkHost('http://apply.example.net/jobs/1'), null);
  assert.equal(linkHost('not a url'), null);
});

test('a closed role says how, and offers its outcomes to close by; Offer offers the offer', () => {
  const closed = roleDetails(
    planWith(role(roleData({ stage: 'closed', outcome: 'no_reply' }))),
    ROLE_ID,
    NOW,
  );

  assert.equal(closed.closed, 'Closed · No reply');
  assert.deepEqual(
    closed.closeWith.map((outcome) => outcome.label),
    ['Rejected', 'Withdrew', 'No reply', 'Posting closed'],
  );
  assert.deepEqual(
    closed.stages.map((stage) => stage.label),
    ['New', 'Interested', 'Applied', 'Interviewing', 'Offer'],
  );
  assert.equal(
    closed.stages.some((stage) => stage.current),
    false,
  );
});

test('renaming trims the title, shows it at once, and sends nothing for no change', () => {
  const named = role(roleData({ title: 'Role' }));
  const action = renameAction(named, '  Staff PM, Lending ');

  assert.deepEqual(action.request, {
    name: 'object.update',
    input: { ref: ROLE_ID, data: { title: 'Staff PM, Lending' } },
  });
  assert.deepEqual(
    [action.optimistic[0].patch.title, action.optimistic[0].patch.data.title],
    ['Staff PM, Lending', 'Staff PM, Lending'],
  );
  assert.equal(renameAction(named, '   '), null);
  assert.equal(renameAction(named, 'Role'), null);
  assert.equal(renameAction(named, 'x'.repeat(201)), null);
});
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-role.test.mjs`
Expected: FAIL, `Cannot find module '…/role-details.ts'`.

- [ ] **Step 2: `linkHost` and `renameAction`**

Append to `apps/mobile/src/features/jobs/job-format.ts`:

```ts
/**
 * The host a role's link opens, shown before the user leaves the app: a role a model added may
 * link to any https page (PR #43). Null for a link that isn't https or doesn't parse.
 *
 * @example linkHost('https://apply.example.net/jobs/1?ref=x') // 'apply.example.net'
 */
export function linkHost(url: string): string | null {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}
```

Append to `apps/mobile/src/features/jobs/role-actions.ts`:

```ts
/**
 * Renames a role through `object.update` (Decision 2), shown at once: its object title follows
 * `data.title` on the server too. Null for an empty, too long or unchanged title.
 */
export function renameAction(role: GraphObject, title: string): CapabilityAction | null {
  const next = title.trim();
  const data = role.data as OpportunityData;

  if (next.length === 0 || next.length > 200 || next === data.title) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'object.update', input: { ref: role.id, data: { title: next } } },
    optimistic: [
      {
        op: 'update_object',
        id: role.id,
        patch: { title: next, data: { ...data, title: next } },
        origin: 'direct',
      },
    ],
  };
}
```

- [ ] **Step 3: What the sheet shows**

Create `apps/mobile/src/features/jobs/role-details.ts`:

```ts
import {
  STAGES,
  type DocumentData,
  type GraphObject,
  type GraphSnapshot,
  type InterviewData,
  type OpportunityData,
  type Outcome,
  type PersonData,
  type Stage,
} from '@nexui/types';

import { aiMarkFor, capitalize, formatDate, formatDateTime } from '#lib';

import { linkHost, outcomeLabel, placeLine, salaryText } from './job-format.ts';
import { companyName, interviewsFor, linkedFrom } from './job-parts.ts';

/** What each draft is, as a list row names it. */
export const DOC_LABELS: Record<DocumentData['docType'], string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  brief: 'Application brief',
  follow_up: 'Follow-up',
  withdrawal: 'Withdrawal note',
};

const PERSON_ROLES: Record<PersonData['role'], string> = {
  recruiter: 'recruiter',
  hiring_manager: 'hiring manager',
  referral: 'referral',
  interviewer: 'interviewer',
  other: '',
};

// What the user may close a role as from its sheet. Pass, Accept offer and Decline have their
// own buttons.
const CLOSE_WITH: readonly Outcome[] = ['rejected', 'withdrew', 'no_reply', 'posting_closed'];

/** What a role's sheet shows (job search spec, section 6). */
export interface RoleDetails {
  role: GraphObject;
  data: OpportunityData;
  company: string | null;
  /** "London, hybrid · £130k–£150k". */
  line: string;
  ai: boolean;
  fit: { reasons: string[]; gaps: string[] } | null;
  /** The posting's link, the host it opens and what's known of it, or null with no link. */
  posting: { url: string; host: string; note: string } | null;
  /** The stage picker: every stage but Closed, the current one marked. */
  stages: { value: Stage; label: string; current: boolean }[];
  /** "Closed · No reply" while closed, else null. */
  closed: string | null;
  closeWith: { value: Outcome; label: string }[];
  /** "Applied Sep 26", "Last contact Oct 2". */
  dates: string[];
  drafts: { id: string; label: string; ai: boolean }[];
  people: { name: string; role: string }[];
  interviews: { label: string; when: string }[];
}

function words(body: string): number {
  const trimmed = body.trim();

  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// When the posting went up and when a board last listed it: "Posted Oct 2 · still live today on
// its job board" (Departure 12).
function postingNote(data: OpportunityData, now: Date, timeZone?: string): string {
  const parts: string[] = [];

  if (data.postedAt) {
    parts.push(`Posted ${formatDate(data.postedAt, timeZone)}`);
  }

  if (data.lastSeenLiveAt) {
    const today =
      formatDate(data.lastSeenLiveAt, timeZone) === formatDate(now.toISOString(), timeZone);

    parts.push(
      today
        ? 'still live today on its job board'
        : `last seen live ${formatDate(data.lastSeenLiveAt, timeZone)}`,
    );
  }

  return capitalize(parts.join(' · '));
}

/** A role's sheet, or null when the plan no longer holds it. */
export function roleDetails(
  snapshot: GraphSnapshot,
  roleId: string,
  now: Date = new Date(),
  timeZone?: string,
): RoleDetails | null {
  const role = snapshot.objects.find(
    (object) => object.id === roleId && object.kind === 'opportunity',
  );

  if (!role) {
    return null;
  }

  const data = role.data as OpportunityData;
  const host = data.url ? linkHost(data.url) : null;
  const dates: string[] = [];

  if (data.appliedAt) {
    dates.push(`Applied ${formatDate(data.appliedAt, timeZone)}`);
  }

  if (data.lastContactAt) {
    dates.push(`Last contact ${formatDate(data.lastContactAt, timeZone)}`);
  }

  return {
    role,
    data,
    company: companyName(snapshot, role.id),
    line: [placeLine(data), salaryText(data.salary)].filter((part) => part.length > 0).join(' · '),
    ai: aiMarkFor(role).highlight,
    fit: data.fit ? { reasons: data.fit.reasons, gaps: data.fit.gaps } : null,
    posting:
      data.url && host ? { url: data.url, host, note: postingNote(data, now, timeZone) } : null,
    stages: STAGES.filter((stage) => stage.value !== 'closed').map((stage) => ({
      value: stage.value,
      label: stage.label,
      current: stage.value === data.stage,
    })),
    closed:
      data.stage === 'closed' && data.outcome ? `Closed · ${outcomeLabel(data.outcome)}` : null,
    closeWith: CLOSE_WITH.map((value) => ({ value, label: outcomeLabel(value) })),
    dates,
    drafts: linkedFrom(snapshot, role.id, 'for', 'document')
      .filter((draft) => (draft.data as DocumentData).docType !== 'resume')
      .map((draft) => {
        const doc = draft.data as DocumentData;

        return {
          id: draft.id,
          label: `${DOC_LABELS[doc.docType]} · ${words(doc.body)} words`,
          ai: aiMarkFor(draft).highlight,
        };
      }),
    people: linkedFrom(snapshot, role.id, 'for', 'person').map((person) => {
      const who = person.data as PersonData;

      return { name: who.name, role: PERSON_ROLES[who.role] };
    }),
    interviews: interviewsFor(snapshot, role.id).map((interview) => {
      const when = interview.data as InterviewData;

      return { label: when.label, when: formatDateTime(when.at, timeZone) };
    }),
  };
}

/** The + sheet's prompt for Ask about this role: the role named, ready for the question. */
export function askAbout(details: RoleDetails): string {
  return details.company
    ? `About ${details.data.title} at ${details.company}: `
    : `About ${details.data.title}: `;
}
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-role.test.mjs`
Expected: PASS.

- [ ] **Step 4: A sheet's header and sections**

Create `apps/mobile/src/features/jobs/sheet-parts.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

/** A job search sheet's top line: what it is, and Done, which stays in view (spec section 6). */
export function SheetHeader({
  kicker,
  onDone,
}: {
  kicker: string;
  onDone: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <Text numberOfLines={1} style={styles.kicker}>
        {kicker}
      </Text>
      <Button label="Done" onPress={onDone} />
    </View>
  );
}

/** One titled part of a sheet. */
export function SheetSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kicker: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  section: { gap: 8, paddingTop: 22 },
  title: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.ink },
}));
```

- [ ] **Step 5: The body**

Create `apps/mobile/src/features/jobs/role-body.tsx`:

```tsx
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { fonts, createThemedStyles, useColors } from '#theme';
import { AiText, Button, ListEmpty, NexuiTag } from '#ui';
import type { DetailProps } from '#features/workspace';

import { renameAction, stageAction } from './role-actions';
import { askAbout, roleDetails } from './role-details';
import { SheetHeader, SheetSection } from './sheet-parts';

/**
 * A role in the object sheet (job search spec, section 6): what it is and where it stands, why
 * it fits, its posting, and what's for it. Moving it, renaming it and the buttons all report
 * capability actions; a draft opens in place.
 */
export function RoleBody({ object, snapshot, onAction, onDone, busy }: DetailProps): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [closing, setClosing] = useState(false);
  const details = roleDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="This role is no longer in your search." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { data, role, posting } = details;
  const subtitle = [details.company, details.line].filter(Boolean).join(' · ');

  const saveName = (): void => {
    const action = renameAction(role, name);

    setRenaming(false);

    if (action) {
      onAction(action);
    }
  };

  return (
    <View>
      <SheetHeader kicker="Role" onDone={onDone} />
      {renaming ? (
        <View style={styles.rename}>
          <TextInput
            accessibilityLabel="Role title"
            autoFocus
            maxLength={200}
            value={name}
            onChangeText={setName}
            onSubmitEditing={saveName}
            returnKeyType="done"
            selectionColor={colors.ink}
            style={styles.input}
          />
          <View style={styles.row}>
            <Button label="Save" variant="primary" disabled={busy} onPress={saveName} />
            <Button label="Cancel" variant="text" onPress={() => setRenaming(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.titleRow}>
          <AiText text={data.title} highlight={details.ai} style={styles.title} />
          <Button
            label="Rename"
            variant="text"
            accessibilityLabel={`Rename ${data.title}`}
            onPress={() => {
              setName(data.title);
              setRenaming(true);
            }}
          />
        </View>
      )}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View accessibilityRole="radiogroup" accessibilityLabel="Stage" style={styles.stages}>
        {details.stages.map((stage) => (
          <Pressable
            key={stage.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: stage.current, disabled: busy || stage.current }}
            disabled={busy || stage.current}
            onPress={() => onAction(stageAction(role, stage.value))}
            style={[styles.stage, stage.current && styles.stageOn]}
          >
            <Text style={[styles.stageText, stage.current && styles.stageTextOn]}>
              {stage.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {details.closed ? <Text style={styles.strong}>{details.closed}</Text> : null}
      {data.stage === 'offer' ? (
        <View style={styles.row}>
          <Button
            label="Accept offer"
            variant="primary"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'closed', 'accepted'))}
          />
          <Button
            label="Decline"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'closed', 'declined'))}
          />
        </View>
      ) : null}
      {data.stage !== 'closed' && !closing ? (
        <Button
          label="Close this role"
          variant="text"
          onPress={() => setClosing(true)}
          style={styles.start}
        />
      ) : null}
      {data.stage !== 'closed' && closing ? (
        <View style={styles.wrap}>
          {details.closeWith.map((outcome) => (
            <Button
              key={outcome.value}
              label={outcome.label}
              disabled={busy}
              onPress={() => {
                setClosing(false);
                onAction(stageAction(role, 'closed', outcome.value));
              }}
            />
          ))}
          <Button label="Cancel" variant="text" onPress={() => setClosing(false)} />
        </View>
      ) : null}

      {details.fit ? (
        <SheetSection title="Why it fits">
          {details.fit.reasons.map((reason) => (
            <Text key={reason} style={styles.bullet}>
              • {reason}
            </Text>
          ))}
        </SheetSection>
      ) : null}
      {details.fit && details.fit.gaps.length > 0 ? (
        <SheetSection title="Gaps">
          {details.fit.gaps.map((gap) => (
            <Text key={gap} style={styles.bullet}>
              • {gap}
            </Text>
          ))}
        </SheetSection>
      ) : null}

      {posting ? (
        <View style={styles.posting}>
          <Button
            label="View posting"
            variant="primary"
            accessibilityLabel={`View posting on ${posting.host}`}
            onPress={() => onAction({ type: 'link', url: posting.url })}
            style={styles.start}
          />
          <Text style={styles.quiet}>Opens {posting.host}</Text>
          {posting.note ? <Text style={styles.quiet}>{posting.note}</Text> : null}
        </View>
      ) : null}
      {details.dates.length > 0 ? (
        <Text style={styles.quiet}>{details.dates.join(' · ')}</Text>
      ) : null}

      {details.drafts.length > 0 ? (
        <SheetSection title="Drafts">
          {details.drafts.map((draft) => (
            <Pressable
              key={draft.id}
              accessibilityRole="button"
              accessibilityLabel={`${draft.label}. Open`}
              onPress={() => onAction({ type: 'open', objectId: draft.id })}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
            >
              <Text style={styles.listTitle}>{draft.label}</Text>
              {draft.ai ? <NexuiTag /> : null}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </SheetSection>
      ) : null}
      <SheetSection title="People">
        {details.people.length === 0 ? (
          <Text style={styles.quiet}>
            No contacts yet. Tell Nexui who you&apos;re talking to and it adds them here.
          </Text>
        ) : null}
        {details.people.map((person) => (
          <Text key={person.name} style={styles.bullet}>
            {person.role ? `${person.name} · ${person.role}` : person.name}
          </Text>
        ))}
      </SheetSection>
      {details.interviews.length > 0 ? (
        <SheetSection title="Interviews">
          {details.interviews.map((interview) => (
            <Text key={`${interview.label}-${interview.when}`} style={styles.bullet}>
              {interview.label} · {interview.when}
            </Text>
          ))}
        </SheetSection>
      ) : null}

      <View style={styles.footer}>
        {data.stage === 'new' || data.stage === 'interested' ? (
          <Button
            label="I applied"
            variant="primary"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'applied'))}
          />
        ) : null}
        <Button
          label="Ask about this role"
          onPress={() => onAction({ type: 'ask', prompt: askAbout(details) })}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.muted },
  rename: { gap: 8, paddingTop: 8 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 16 },
  stage: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  stageOn: { backgroundColor: colors.ink },
  stageText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  stageTextOn: { color: colors.card },
  strong: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, paddingTop: 8 },
  start: { alignSelf: 'flex-start' },
  bullet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  posting: { gap: 4, paddingTop: 22 },
  quiet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  listTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  pressed: { opacity: 0.7 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 24 },
}));
```

In `apps/mobile/src/features/jobs/index.ts`, add `export { RoleBody } from './role-body';`. In `features/registry/detail-registry.tsx`:

- import `RoleBody` from `#features/jobs`;
- add `opportunity: RoleBody,` to `DETAIL_REGISTRY`.

- [ ] **Step 6: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (723).

Smoke on Expo web, the triage plan from Task 12:

- a card opens its role with the stage picker on New;
- **Rename** to `Staff PM, Payments (London)` changes the title at once and in the pipeline, with Undo;
- **Interviewing** moves the role, and Coming up shows nothing new (no interview yet);
- **View posting** names its host;
- **Ask about this role** closes onto + with `About Staff PM, Payments (London) at Halyard: `;
- **Close this role** → `Rejected` closes it.

- [ ] **Step 7: Commit**

Message: `Open a role in the object sheet: stage, fit, posting, rename, and what's for it`

```bash
git add apps/mobile/src/features tests/mobile-jobs-role.test.mjs
git commit -F <message file>
```

---

### Task 14: The draft sheet

Spec section 6 ("Draft") and "Nothing leaves Nexui". A draft opens in `/object`. It shows:

- the text, AI-marked until edited;
- **Copy**;
- for an email (a follow-up or withdrawal note), its To and Subject lines and **Open in Mail** (`mailto:` with recipient, subject and body);
- for a follow-up, **I sent it**, which logs the contact on its role.

Editing in place is a Should this plan leaves out. Drafts appear once PR 4 writes them (Departure 4).

**Files:**

- Create: `apps/mobile/src/features/jobs/{draft-details.ts,draft-body.tsx}`
- Modify: `apps/mobile/src/features/jobs/index.ts`, `apps/mobile/src/features/registry/detail-registry.tsx`
- Create: `tests/mobile-jobs-draft.test.mjs`

**Interfaces:**

- Produces, from `draft-details.ts` (pure):
  - `interface DraftDetails { draft; data: DocumentData; title: string; kicker: string; role: GraphObject | null; ai: boolean; email: { to: string | null; subject: string | null; mailto: string } | null; canLogSent: boolean }`
  - `draftDetails(snapshot, draftId: string): DraftDetails | null` (null for a resume or a missing draft)
  - `mailtoUrl(email: { to?: string; subject?: string; body: string }): string`
  - `sentAction(role: GraphObject): CapabilityAction`
- Produces, from `#features/jobs`: `DraftBody`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-jobs-draft.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftDetails,
  mailtoUrl,
  sentAction,
} from '../apps/mobile/src/features/jobs/draft-details.ts';
import { RUN_ID } from './support/graph.mjs';
import {
  COMPANY_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  RESUME_ID,
  ROLE_ID,
  roleData,
} from './support/jobs.mjs';

const FOLLOW_UP_ID = 'f2000000-0000-4000-8000-000000000040';
const LETTER_ID = 'f2000000-0000-4000-8000-000000000041';
const followUp = {
  docType: 'follow_up',
  to: 'priya@halyard.example',
  subject: 'Following up: Senior PM, Payments',
  body: 'Hi Priya,\nStill keen.',
};
const snapshot = jobSnapshot({
  objects: [
    jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
    jobObject(
      ROLE_ID,
      'opportunity',
      roleData({ title: 'Senior PM, Payments', stage: 'applied' }),
      {
        title: 'Senior PM, Payments',
      },
    ),
    jobObject(FOLLOW_UP_ID, 'document', followUp, { source: { type: 'ai', runId: RUN_ID } }),
    jobObject(LETTER_ID, 'document', { docType: 'cover_letter', body: 'Dear Halyard team,' }),
    jobObject(RESUME_ID, 'document', {
      docType: 'resume',
      body: 'Priya Rao',
      profile: { skills: [], pastRoles: [] },
    }),
  ],
  links: [
    jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
    jobLink(2, FOLLOW_UP_ID, ROLE_ID, 'for'),
    jobLink(3, LETTER_ID, ROLE_ID, 'for'),
  ],
});

test('a follow-up opens in Mail, filled in, and I sent it logs the contact on its role', () => {
  const details = draftDetails(snapshot, FOLLOW_UP_ID);

  assert.deepEqual(
    [details.title, details.kicker, details.ai, details.canLogSent],
    ['Follow-up to Halyard', 'Senior PM, Payments', true, true],
  );
  assert.deepEqual(details.email, {
    to: 'priya@halyard.example',
    subject: 'Following up: Senior PM, Payments',
    mailto:
      'mailto:priya@halyard.example?subject=Following%20up%3A%20Senior%20PM%2C%20Payments&body=Hi%20Priya%2C%0D%0AStill%20keen.',
  });
  assert.deepEqual(sentAction(details.role), {
    type: 'capability',
    request: { name: 'jobs.logContact', input: { objectId: ROLE_ID, direction: 'sent' } },
    optimistic: [],
  });
});

test('a cover letter is copied, not mailed; a resume opens no draft sheet', () => {
  const letter = draftDetails(snapshot, LETTER_ID);

  assert.deepEqual(
    [letter.title, letter.email, letter.canLogSent, letter.ai],
    ['Cover letter', null, false, false],
  );
  assert.equal(draftDetails(snapshot, RESUME_ID), null);
  assert.equal(draftDetails(snapshot, ROLE_ID), null);
});

test('a mailto link leaves the address readable and needs none', () => {
  assert.equal(mailtoUrl({ body: 'Hi' }), 'mailto:?body=Hi');
  assert.equal(
    mailtoUrl({ to: 'a@b.example', subject: 'Re: 50% & more', body: 'x' }),
    'mailto:a@b.example?subject=Re%3A%2050%25%20%26%20more&body=x',
  );
});
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-draft.test.mjs`
Expected: FAIL, `Cannot find module '…/draft-details.ts'`.

- [ ] **Step 2: What the sheet shows**

Create `apps/mobile/src/features/jobs/draft-details.ts`:

```ts
import type { DocumentData, GraphObject, GraphSnapshot, OpportunityData } from '@nexui/types';

import { aiMarkFor } from '#lib';
import type { CapabilityAction } from '#features/workspace';

import { companyName, linkedTo } from './job-parts.ts';
import { DOC_LABELS } from './role-details.ts';

// Drafts that are emails, which Open in Mail fills in.
const EMAILS: readonly DocumentData['docType'][] = ['follow_up', 'withdrawal'];

/** What a draft's sheet shows (job search spec, section 6). */
export interface DraftDetails {
  draft: GraphObject;
  data: DocumentData;
  /** "Follow-up to Halyard", "Cover letter", "Interview brief". */
  title: string;
  /** The sheet's top line: what the draft is for, or "Draft". */
  kicker: string;
  /** The role it's for, which I sent it logs contact on, or null. */
  role: GraphObject | null;
  ai: boolean;
  /** An email's address, subject and the `mailto:` link Open in Mail opens; null otherwise. */
  email: { to: string | null; subject: string | null; mailto: string } | null;
  /** A follow-up for a role: I sent it logs the contact. */
  canLogSent: boolean;
}

/**
 * A `mailto:` link the user's own mail app fills in (spec section 6: Nexui never sends). The
 * address is a validated email and stays readable; subject and body are encoded, with line
 * breaks as CRLF (RFC 6068).
 *
 * @example mailtoUrl({ to: 'a@b.example', subject: 'Hi', body: 'x' }) // 'mailto:a@b.example?subject=Hi&body=x'
 */
export function mailtoUrl(email: { to?: string; subject?: string; body: string }): string {
  const params: string[] = [];

  if (email.subject) {
    params.push(`subject=${encodeURIComponent(email.subject)}`);
  }

  params.push(`body=${encodeURIComponent(email.body.replace(/\r?\n/g, '\r\n'))}`);

  return `mailto:${email.to ?? ''}?${params.join('&')}`;
}

/** A draft's sheet, or null for a resume, a missing object or another kind. */
export function draftDetails(snapshot: GraphSnapshot, draftId: string): DraftDetails | null {
  const draft = snapshot.objects.find(
    (object) => object.id === draftId && object.kind === 'document',
  );
  const data = draft?.data as DocumentData | undefined;

  if (!draft || !data || data.docType === 'resume') {
    return null;
  }

  const target = linkedTo(snapshot, draft.id, 'for');
  const role = target?.kind === 'opportunity' ? target : null;
  const company = role ? companyName(snapshot, role.id) : null;
  const isEmail = EMAILS.includes(data.docType);
  const forInterview = target?.kind === 'interview';
  let title = DOC_LABELS[data.docType];

  if (forInterview && data.docType === 'brief') {
    title = 'Interview brief';
  } else if (isEmail && company) {
    title = `${title} to ${company}`;
  }

  return {
    draft,
    data,
    title,
    kicker: role ? (role.data as OpportunityData).title : (target?.title ?? 'Draft'),
    role,
    ai: aiMarkFor(draft).highlight,
    email: isEmail
      ? { to: data.to ?? null, subject: data.subject ?? null, mailto: mailtoUrl(data) }
      : null,
    canLogSent: data.docType === 'follow_up' && role !== null,
  };
}

/** I sent it: the follow-up went out, so its role's last contact and follow-ups move. */
export function sentAction(role: GraphObject): CapabilityAction {
  return {
    type: 'capability',
    request: { name: 'jobs.logContact', input: { objectId: role.id, direction: 'sent' } },
    optimistic: [],
  };
}
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-draft.test.mjs`
Expected: PASS.

- [ ] **Step 3: The body**

Create `apps/mobile/src/features/jobs/draft-body.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { AiText, Button, ListEmpty, NexuiTag } from '#ui';
import type { DetailProps } from '#features/workspace';

import { draftDetails, sentAction } from './draft-details';
import { SheetHeader } from './sheet-parts';

/**
 * A draft in the object sheet (job search spec, section 6): its text, Copy, and for an email
 * Open in Mail, which fills in a message the user sends from their own mail app. Nothing leaves
 * Nexui. I sent it, on a follow-up, records the contact on its role.
 */
export function DraftBody({ object, snapshot, onAction, onDone, busy }: DetailProps): ReactElement {
  const styles = useStyles();
  const details = draftDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="There's nothing more to show for this." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { data, email, role } = details;

  return (
    <View>
      <SheetHeader kicker={details.kicker} onDone={onDone} />
      <View style={styles.head}>
        <AiText text={details.title} highlight={details.ai} tag={false} style={styles.title} />
        {details.ai ? <NexuiTag label="Nexui draft" /> : null}
      </View>
      {email?.to ? (
        <Text style={styles.meta}>
          <Text style={styles.label}>To </Text>
          {email.to}
        </Text>
      ) : null}
      {email?.subject ? (
        <Text style={styles.meta}>
          <Text style={styles.label}>Subject </Text>
          {email.subject}
        </Text>
      ) : null}
      <Text selectable style={styles.body}>
        {data.body}
      </Text>
      <View style={styles.actions}>
        {email ? (
          <Button
            label="Open in Mail"
            variant="primary"
            onPress={() => onAction({ type: 'link', url: email.mailto })}
          />
        ) : null}
        <Button label="Copy" onPress={() => onAction({ type: 'copy', text: data.body })} />
        {details.canLogSent && role ? (
          <Button label="I sent it" disabled={busy} onPress={() => onAction(sentAction(role))} />
        ) : null}
      </View>
      {email ? (
        <Text style={styles.note}>
          Nexui never sends email. Open in Mail fills in a message in your own mail app.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  head: { gap: 6, paddingTop: 8 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink, paddingTop: 6 },
  label: { fontFamily: fonts.bodyBold, color: colors.muted },
  body: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 16 },
  note: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.faint,
    paddingTop: 10,
  },
}));
```

In `apps/mobile/src/features/jobs/index.ts`, add `export { DraftBody } from './draft-body';`. In `features/registry/detail-registry.tsx`:

- import `DraftBody`;
- add `document: DraftBody,`.

- [ ] **Step 4: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (726).

There are no drafts to smoke until PR 4. Optionally, insert one with a raw changeset as the QA user (`POST /api/intents/<id>/changesets`):

- an `insert_object` of a `document` (`follow_up`, `to`, `subject`, `body`);
- an `insert_relationship` `for` a role.

Then open it from the role's Drafts:

- **Copy** puts the body on the clipboard (`Copied.` shows);
- **Open in Mail** opens the browser's mail handler with the fields filled in;
- **I sent it** moves the role's last contact, with Undo.

Delete the plan afterwards.

- [ ] **Step 5: Commit**

Message: `Open a draft in the object sheet: Copy, Open in Mail, and I sent it`

```bash
git add apps/mobile/src/features tests/mobile-jobs-draft.test.mjs
git commit -F <message file>
```

---

### Task 15: The search sheet

Spec section 6 ("Search"), Decisions 2 and 3, Departures 2 and 11. The search opens in `/object` from the plan's meta line. It shows:

- the criteria as chips that remove with ✕ and add with **+ Add**;
- work modes as toggles;
- the salary floor (changed inline, or set through + when there's none);
- never-show companies (the current employer stays, marked `your current employer`);
- pass reasons, removable;
- the resume's profile, with **Replace**;
- `The search ends when you accept an offer.`

Criteria go through `object.update`; a pass reason through `jobs.forgetPass`.

**Files:**

- Create: `apps/mobile/src/features/jobs/{search-details.ts,chip-list.tsx,search-body.tsx}`
- Modify: `apps/mobile/src/features/jobs/index.ts`, `apps/mobile/src/features/registry/detail-registry.tsx`
- Create: `tests/mobile-jobs-search.test.mjs`

**Interfaces:**

- Produces, from `search-details.ts` (pure):
  - `LISTS`: per-list `{ max, length, min }` for `roles`, `locations`, `industries` and `excludeCompanies`
  - `type ListField`
  - `interface SearchDetails { search; data: SearchData; workModes: { value; label; on }[]; salaryFloor: string | null; neverShow: { name; employer }[]; passes: { at; text }[]; resume: { read; profile } | null }`
  - `searchDetails(snapshot, searchId: string, timeZone?: string): SearchDetails | null`
  - `addTo(search: GraphObject, field: ListField, value: string): CapabilityAction | null`
  - `removeFrom(search: GraphObject, field: ListField, value: string): CapabilityAction | null`
  - `toggleWorkMode(search: GraphObject, mode: WorkMode): CapabilityAction | null`
  - `salaryFloorAction(search: GraphObject, typed: string): CapabilityAction | null`
  - `forgetPassAction(search: GraphObject, at: string): CapabilityAction`
- Produces, from `#features/jobs`: `SearchBody`. Registering it makes the plan's meta line open the sheet (Task 8's `hasDetail`).

- [ ] **Step 1: Write the failing tests**

Create `tests/mobile-jobs-search.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addTo,
  forgetPassAction,
  removeFrom,
  salaryFloorAction,
  searchDetails,
  toggleWorkMode,
} from '../apps/mobile/src/features/jobs/search-details.ts';
import { jobObject, jobSnapshot, RESUME_ID, SEARCH_ID, searchData } from './support/jobs.mjs';

const passes = [
  { reason: 'too_junior', company: 'Northbeam', title: 'Lead PM', at: '2026-10-12T09:00:00.000Z' },
  { reason: 'not_this_company', company: 'Pennant', title: 'PM', at: '2026-10-13T09:00:00.000Z' },
];
const data = {
  ...searchData,
  salaryFloor: { amount: 120_000, currency: 'GBP' },
  excludeCompanies: ['Brightbank', 'Quayside'],
  passReasons: passes,
};
const resume = jobObject(
  RESUME_ID,
  'document',
  {
    docType: 'resume',
    body: 'Jordan Lee',
    profile: {
      currentTitle: 'Senior PM',
      currentEmployer: 'Brightbank',
      years: 8,
      skills: ['payments', 'risk', 'lending', 'pricing'],
      pastRoles: [],
    },
  },
  { updatedAt: '2026-10-12T09:00:00.000Z' },
);
const snapshot = jobSnapshot({ search: data, objects: [resume] });
const search = snapshot.objects.find((object) => object.id === SEARCH_ID);
const sent = (action) => action.request.input.data;

test('the search sheet shows its criteria, never-show list, passes and resume', () => {
  const details = searchDetails(snapshot, SEARCH_ID, 'Europe/London');

  assert.deepEqual(
    details.workModes.map((mode) => [mode.label, mode.on]),
    [
      ['Remote', true],
      ['Hybrid', true],
      ['On-site', false],
    ],
  );
  assert.equal(details.salaryFloor, '£120k');
  assert.deepEqual(details.neverShow, [
    { name: 'Brightbank', employer: true },
    { name: 'Quayside', employer: false },
  ]);
  assert.deepEqual(
    details.passes.map((pass) => pass.text),
    ['Not this company · Pennant', 'Too junior · Northbeam'],
  );
  assert.deepEqual(details.resume, {
    read: 'Oct 12',
    profile: 'Senior PM at Brightbank · 8 years · payments, risk, lending',
  });
  assert.equal(searchDetails(snapshot, RESUME_ID), null);
});

test('lists take a new entry once, within their limits, and keep one role', () => {
  assert.deepEqual(sent(addTo(search, 'locations', '  Leeds ')), {
    locations: ['London', 'Leeds'],
  });
  assert.equal(addTo(search, 'locations', 'london'), null);
  assert.equal(addTo(search, 'roles', '   '), null);
  assert.equal(addTo(search, 'industries', 'x'.repeat(61)), null);
  assert.equal(
    addTo({ ...search, data: { ...data, roles: ['a', 'b', 'c', 'd', 'e'] } }, 'roles', 'f'),
    null,
  );
  assert.equal(removeFrom(search, 'roles', 'Staff Product Manager'), null);
  assert.deepEqual(sent(removeFrom(search, 'excludeCompanies', 'Quayside')), {
    excludeCompanies: ['Brightbank'],
  });

  const edit = addTo(search, 'industries', 'payments');

  assert.equal(edit.request.name, 'object.update');
  assert.equal(edit.request.input.ref, SEARCH_ID);
  assert.deepEqual(edit.optimistic[0].patch.data.industries, ['fintech', 'payments']);
});

test('work modes never all turn off, and the floor changes in its own currency', () => {
  assert.deepEqual(sent(toggleWorkMode(search, 'onsite')), {
    workModes: ['remote', 'hybrid', 'onsite'],
  });
  assert.deepEqual(sent(toggleWorkMode(search, 'hybrid')), { workModes: ['remote'] });

  const remoteOnly = { ...search, data: { ...data, workModes: ['remote'] } };

  assert.equal(toggleWorkMode(remoteOnly, 'remote'), null);
  assert.deepEqual(sent(salaryFloorAction(search, '£130,000')), {
    salaryFloor: { amount: 130_000, currency: 'GBP' },
  });
  assert.deepEqual(sent(salaryFloorAction(search, '135k')).salaryFloor.amount, 135_000);
  assert.equal(salaryFloorAction(search, 'lots'), null);
  assert.equal(salaryFloorAction(search, '120000'), null);
  assert.equal(salaryFloorAction({ ...search, data: { ...searchData } }, '100000'), null);
});

test('forgetting a pass removes it at once and asks the server to', () => {
  const action = forgetPassAction(search, passes[0].at);

  assert.deepEqual(action.request, { name: 'jobs.forgetPass', input: { at: passes[0].at } });
  assert.deepEqual(action.optimistic[0].patch.data.passReasons, [passes[1]]);
});
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-search.test.mjs`
Expected: FAIL, `Cannot find module '…/search-details.ts'`.

- [ ] **Step 2: What the sheet shows, and its edits**

Create `apps/mobile/src/features/jobs/search-details.ts`:

```ts
import {
  PASS_REASONS,
  WORK_MODES,
  type DocumentData,
  type GraphObject,
  type GraphSnapshot,
  type Money,
  type ResumeProfile,
  type SearchData,
  type WorkMode,
} from '@nexui/types';

import { formatDate, formatMoney } from '#lib';
import type { CapabilityAction } from '#features/workspace';

/** The criteria lists the sheet edits: most entries, longest entry, fewest entries (`searchDataSchema`). */
export const LISTS = {
  roles: { max: 5, length: 80, min: 1 },
  locations: { max: 5, length: 80, min: 0 },
  industries: { max: 5, length: 60, min: 0 },
  excludeCompanies: { max: 20, length: 100, min: 0 },
} as const;

export type ListField = keyof typeof LISTS;

/** What the search sheet shows (job search spec, section 6). */
export interface SearchDetails {
  search: GraphObject;
  data: SearchData;
  workModes: { value: WorkMode; label: string; on: boolean }[];
  /** "£120k", or null with no floor. */
  salaryFloor: string | null;
  /** The never-show list; the resume's current employer is marked and stays. */
  neverShow: { name: string; employer: boolean }[];
  /** "Too junior · Northbeam", newest first, keyed by when each was given. */
  passes: { at: string; text: string }[];
  /** When the resume was read, and what Nexui took from it. */
  resume: { read: string; profile: string } | null;
}

// "Senior PM at Brightbank · 8 years · payments, risk, lending".
function profileLine(profile: ResumeProfile | undefined): string {
  if (!profile) {
    return '';
  }

  const now =
    profile.currentTitle && profile.currentEmployer
      ? `${profile.currentTitle} at ${profile.currentEmployer}`
      : (profile.currentTitle ?? profile.currentEmployer ?? profile.headline ?? '');
  const years =
    profile.years === undefined ? '' : `${profile.years} ${profile.years === 1 ? 'year' : 'years'}`;

  return [now, years, profile.skills.slice(0, 3).join(', ')]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/** The search's sheet, or null when `searchId` isn't a search. */
export function searchDetails(
  snapshot: GraphSnapshot,
  searchId: string,
  timeZone?: string,
): SearchDetails | null {
  const search = snapshot.objects.find(
    (object) => object.id === searchId && object.kind === 'search',
  );

  if (!search) {
    return null;
  }

  const data = search.data as SearchData;
  const resume = snapshot.objects.find(
    (object) => object.kind === 'document' && (object.data as DocumentData).docType === 'resume',
  );
  const profile = (resume?.data as DocumentData | undefined)?.profile;
  const employer = profile?.currentEmployer?.toLowerCase();

  return {
    search,
    data,
    workModes: WORK_MODES.map((mode) => ({
      value: mode.value,
      label: mode.label,
      on: data.workModes.includes(mode.value),
    })),
    salaryFloor: data.salaryFloor ? formatMoney(data.salaryFloor) : null,
    neverShow: data.excludeCompanies.map((name) => ({
      name,
      employer: employer !== undefined && name.toLowerCase() === employer,
    })),
    passes: [...data.passReasons].reverse().map((pass) => ({
      at: pass.at,
      text: `${PASS_REASONS.find((reason) => reason.value === pass.reason)?.label ?? pass.reason} · ${pass.company}`,
    })),
    resume: resume
      ? { read: formatDate(resume.updatedAt, timeZone), profile: profileLine(profile) }
      : null,
  };
}

// One criteria change through `object.update` (Decision 2), shown at once.
function edit(search: GraphObject, field: string, value: string[] | Money): CapabilityAction {
  return {
    type: 'capability',
    request: { name: 'object.update', input: { ref: search.id, data: { [field]: value } } },
    optimistic: [
      {
        op: 'update_object',
        id: search.id,
        patch: { data: { ...search.data, [field]: value } },
        origin: 'direct',
      },
    ],
  };
}

/** Adds a trimmed entry to a list; null for one that's empty, too long, repeated, or a full list. */
export function addTo(
  search: GraphObject,
  field: ListField,
  value: string,
): CapabilityAction | null {
  const list = (search.data as SearchData)[field];
  const entry = value.trim();
  const limit = LISTS[field];
  const repeated = list.some((item) => item.toLowerCase() === entry.toLowerCase());

  if (entry.length === 0 || entry.length > limit.length || list.length >= limit.max || repeated) {
    return null;
  }

  return edit(search, field, [...list, entry]);
}

/** Removes an entry; null when it isn't there or the list would drop below its minimum. */
export function removeFrom(
  search: GraphObject,
  field: ListField,
  value: string,
): CapabilityAction | null {
  const list = (search.data as SearchData)[field];
  const next = list.filter((item) => item !== value);

  if (next.length === list.length || next.length < LISTS[field].min) {
    return null;
  }

  return edit(search, field, next);
}

/** Turns a work mode on or off, kept in the sheet's order; null when it would leave none. */
export function toggleWorkMode(search: GraphObject, mode: WorkMode): CapabilityAction | null {
  const modes = (search.data as SearchData).workModes;
  const on = modes.includes(mode);
  const next = WORK_MODES.map((entry) => entry.value).filter((value) =>
    value === mode ? !on : modes.includes(value),
  );

  return next.length === 0 ? null : edit(search, 'workModes', next);
}

/**
 * A new pay floor in the floor's own currency, from what was typed ("£130,000", "135k"). Null
 * with no floor to change (adding one is an ask, since the app can't know its currency), or for
 * text that isn't a new, positive amount.
 */
export function salaryFloorAction(search: GraphObject, typed: string): CapabilityAction | null {
  const floor = (search.data as SearchData).salaryFloor;
  const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(typed.toLowerCase().replace(/[^0-9.k]/g, ''));

  if (!floor || !match) {
    return null;
  }

  const amount = Math.round(Number(match[1]) * (match[2] === 'k' ? 1000 : 1));

  if (amount <= 0 || amount === floor.amount) {
    return null;
  }

  return edit(search, 'salaryFloor', { amount, currency: floor.currency });
}

/** Forgets one pass reason (`jobs.forgetPass`, Decision 3), shown at once. */
export function forgetPassAction(search: GraphObject, at: string): CapabilityAction {
  const data = search.data as SearchData;

  return {
    type: 'capability',
    request: { name: 'jobs.forgetPass', input: { at } },
    optimistic: [
      {
        op: 'update_object',
        id: search.id,
        patch: {
          data: { ...data, passReasons: data.passReasons.filter((pass) => pass.at !== at) },
        },
        origin: 'direct',
      },
    ],
  };
}
```

Run: `node --experimental-strip-types --test tests/mobile-jobs-search.test.mjs`
Expected: PASS.

- [ ] **Step 3: An editable chip list**

Create `apps/mobile/src/features/jobs/chip-list.tsx`:

```tsx
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { fonts, createThemedStyles, useColors } from '#theme';
import { Button } from '#ui';

import { SheetSection } from './sheet-parts';

export interface Chip {
  key: string;
  label: string;
  /** Said after the label: "your current employer". */
  note: string | null;
  removable: boolean;
}

/**
 * A titled row of chips, each removable with ✕, and + Add, which opens a field below. With no
 * `onAdd` there is no + Add (pass reasons).
 */
export function ChipList({
  title,
  chips,
  busy,
  onRemove,
  onAdd,
  addLabel = '',
  maxLength = 100,
}: {
  title: string;
  chips: readonly Chip[];
  busy: boolean;
  onRemove: (key: string) => void;
  onAdd?: (value: string) => void;
  /** The field's accessible name: "Add a role". */
  addLabel?: string;
  maxLength?: number;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const close = (): void => {
    setValue('');
    setAdding(false);
  };

  const submit = (): void => {
    onAdd?.(value);
    close();
  };

  return (
    <SheetSection title={title}>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip.key} style={styles.chip}>
            <Text style={styles.chipText}>
              {chip.note ? `${chip.label} · ${chip.note}` : chip.label}
            </Text>
            {chip.removable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${chip.label}`}
                disabled={busy}
                hitSlop={8}
                onPress={() => onRemove(chip.key)}
                style={styles.remove}
              >
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {onAdd && !adding ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            onPress={() => setAdding(true)}
            style={[styles.chip, styles.add]}
          >
            <Text style={styles.chipText}>+ Add</Text>
          </Pressable>
        ) : null}
      </View>
      {adding ? (
        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel={addLabel}
            autoFocus
            maxLength={maxLength}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            returnKeyType="done"
            selectionColor={colors.ink}
            style={styles.input}
          />
          <Button
            label="Add"
            variant="primary"
            disabled={busy || value.trim().length === 0}
            onPress={submit}
          />
          <Button label="Cancel" variant="text" onPress={close} />
        </View>
      ) : null}
    </SheetSection>
  );
}

const useStyles = createThemedStyles((colors) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
  },
  add: { paddingRight: 12 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  addRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  input: {
    flexGrow: 1,
    minWidth: 160,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
}));
```

- [ ] **Step 4: The body**

Create `apps/mobile/src/features/jobs/search-body.tsx`:

```tsx
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { GraphObject } from '@nexui/types';

import { fonts, createThemedStyles, useColors } from '#theme';
import { Button, ListEmpty } from '#ui';
import type { CapabilityAction, DetailProps, WorkspaceAction } from '#features/workspace';

import { ChipList, type Chip } from './chip-list';
import {
  addTo,
  forgetPassAction,
  LISTS,
  removeFrom,
  salaryFloorAction,
  searchDetails,
  toggleWorkMode,
  type ListField,
} from './search-details';
import { SheetHeader, SheetSection } from './sheet-parts';

// The floor, Change to type a new one, or Set in + when there's none to change.
function SalaryFloor({
  search,
  floor,
  busy,
  onAction,
}: {
  search: GraphObject;
  floor: string | null;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [typed, setTyped] = useState<string | null>(null);

  if (typed === null) {
    return (
      <View style={styles.floor}>
        <Text style={styles.value}>{floor ?? 'None'}</Text>
        {floor ? (
          <Button label="Change" variant="text" onPress={() => setTyped('')} />
        ) : (
          <Button
            label="Set in +"
            variant="text"
            onPress={() => onAction({ type: 'ask', prompt: 'Set my salary floor to ' })}
          />
        )}
      </View>
    );
  }

  const save = (): void => {
    const action = salaryFloorAction(search, typed);

    setTyped(null);

    if (action) {
      onAction(action);
    }
  };

  return (
    <View style={styles.floor}>
      <TextInput
        accessibilityLabel="New salary floor"
        autoFocus
        keyboardType="numeric"
        placeholder="e.g. 130,000"
        placeholderTextColor={colors.faint}
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={save}
        selectionColor={colors.ink}
        style={styles.input}
      />
      <Button label="Save" variant="primary" disabled={busy} onPress={save} />
      <Button label="Cancel" variant="text" onPress={() => setTyped(null)} />
    </View>
  );
}

/**
 * The search in the object sheet (job search spec, section 6): its criteria as editable chips,
 * the never-show list, why the user passed, and the resume. Criteria go through `object.update`
 * and a pass reason through `jobs.forgetPass`; Replace reports an upload.
 */
export function SearchBody({
  object,
  snapshot,
  onAction,
  onDone,
  busy,
}: DetailProps): ReactElement {
  const styles = useStyles();
  const details = searchDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="This search is no longer here." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { search, data } = details;
  const send = (action: CapabilityAction | null): void => {
    if (action) {
      onAction(action);
    }
  };
  const chipsOf = (field: ListField): Chip[] =>
    data[field].map((label) => ({ key: label, label, note: null, removable: true }));
  const listProps = (field: ListField, addLabel: string) => ({
    chips: chipsOf(field),
    busy,
    addLabel,
    maxLength: LISTS[field].length,
    onRemove: (value: string) => send(removeFrom(search, field, value)),
    onAdd: (value: string) => send(addTo(search, field, value)),
  });

  return (
    <View>
      <SheetHeader kicker="Your search" onDone={onDone} />
      <Text accessibilityRole="header" style={styles.title}>
        Your search
      </Text>
      <ChipList title="Roles" {...listProps('roles', 'Add a role')} />
      <ChipList title="Where" {...listProps('locations', 'Add a place')} />
      <SheetSection title="How you work">
        <View style={styles.modes}>
          {details.workModes.map((mode) => (
            <Pressable
              key={mode.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: mode.on, disabled: busy }}
              disabled={busy}
              onPress={() => send(toggleWorkMode(search, mode.value))}
              style={[styles.mode, mode.on && styles.modeOn]}
            >
              <Text style={[styles.modeText, mode.on && styles.modeTextOn]}>{mode.label}</Text>
            </Pressable>
          ))}
        </View>
      </SheetSection>
      <SheetSection title="Salary floor">
        <SalaryFloor search={search} floor={details.salaryFloor} busy={busy} onAction={onAction} />
      </SheetSection>
      <ChipList title="Industries" {...listProps('industries', 'Add an industry')} />
      <ChipList
        title="Never show"
        {...listProps('excludeCompanies', 'Add a company never to show')}
        chips={details.neverShow.map((entry) => ({
          key: entry.name,
          label: entry.name,
          note: entry.employer ? 'your current employer' : null,
          removable: !entry.employer,
        }))}
      />
      {details.passes.length > 0 ? (
        <ChipList
          title="You passed because"
          busy={busy}
          chips={details.passes.map((pass) => ({
            key: pass.at,
            label: pass.text,
            note: null,
            removable: true,
          }))}
          onRemove={(at) => onAction(forgetPassAction(search, at))}
        />
      ) : null}
      <SheetSection title="Resume">
        {details.resume ? (
          <>
            <Text style={styles.value}>Read {details.resume.read}</Text>
            {details.resume.profile ? (
              <Text style={styles.quiet}>{details.resume.profile}</Text>
            ) : null}
            <Button
              label="Replace"
              disabled={busy}
              onPress={() => onAction({ type: 'upload', docType: 'resume' })}
              style={styles.start}
            />
          </>
        ) : (
          <>
            <Text style={styles.quiet}>No resume yet. Nexui screens roles on your goal alone.</Text>
            <Button
              label="Add resume"
              variant="primary"
              disabled={busy}
              onPress={() => onAction({ type: 'upload', docType: 'resume' })}
              style={styles.start}
            />
          </>
        )}
      </SheetSection>
      <Text style={styles.footnote}>The search ends when you accept an offer.</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 31,
    color: colors.ink,
    paddingTop: 8,
  },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mode: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  modeOn: { backgroundColor: colors.ink },
  modeText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  modeTextOn: { color: colors.card },
  floor: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  quiet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  input: {
    flexGrow: 1,
    minWidth: 140,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  start: { alignSelf: 'flex-start' },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.faint,
    paddingTop: 24,
  },
}));
```

In `apps/mobile/src/features/jobs/index.ts`, add `export { SearchBody } from './search-body';`. In `features/registry/detail-registry.tsx`:

- import `SearchBody`;
- add `search: SearchBody,`.

- [ ] **Step 5: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (730).

Smoke on Expo web, the triage plan. The meta line now ends in › and opens `Your search`. Check:

- adding `Leeds` to Where and removing it, each with Undo;
- On-site toggles; the last mode on can't turn off;
- **Change** the floor to `135k`;
- `Wrong location · Halyard` (from Task 12's Pass) removes with ✕;
- **Replace** with `cv.pdf` reads it (`Reading your resume…`, then Undo in the toast).

Each edit's label shows in Changes.

- [ ] **Step 6: Commit**

Message: `Open the search in the object sheet: editable criteria, passes and the resume`

```bash
git add apps/mobile/src/features tests/mobile-jobs-search.test.mjs
git commit -F <message file>
```

---

### Task 16: The + sheet: the resume step, a second search, and the PDF button

Spec sections 2, 4 and 8 (Decision 13). After a new goal, the + sheet now shows one of four replies:

- **A trip:** its run, as before.
- **A saved goal:** the saved-goal reply, as before.
- **A job search:** the resume step. **Add resume (PDF)** reads the file and starts the build; **Continue without** starts it with none. Either way the build run streams in.
- **A second job search:** `You already have a job search. Add this to it?` with **Open my search**, which puts the goal back in the composer to send to that plan.
  - The sheet reads that plan's template from Home's cached list first, then from the plan itself, so the reply shows at once.
  - If neither has loaded (no list, and the plan's fetch failed), it still shows, as `You already have a plan like this. Add this to it?` with **Open my plan**.

On a plan that takes a document, a **PDF** button beside the composer adds or replaces it. A failed build's Try again starts the build again.

**Files:**

- Create: `apps/mobile/src/features/compose/{compose-reply.ts,resume-step.tsx,existing-plan-reply.tsx}`
- Modify: `apps/mobile/src/features/compose/index.ts`, `apps/mobile/src/app/(app)/compose.tsx`
- Create: `tests/mobile-compose-reply.test.mjs`

**Interfaces:**

- Produces, from `compose-reply.ts` (pure):
  - `type Reply = { type: 'run'; runId: string; restart: boolean } | { type: 'saved' } | { type: 'resume' } | { type: 'existing' }`
  - `replyFor(result: CreateIntentResponse): Reply`
  - `targetOf(result: CreateIntentResponse): string | null`
- Produces, from `#features/compose`:
  - `ResumeStep({ intake, reading, busy, onAdd, onSkip })`
  - `ExistingPlanReply({ example, onOpen })`
  - `replyFor`, `targetOf`, `type Reply`

- [ ] **Step 1: Write the failing test**

Create `tests/mobile-compose-reply.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { replyFor, targetOf } from '../apps/mobile/src/features/compose/compose-reply.ts';

const snapshot = { intent: { id: 'plan-1' } };

test('each create outcome gets its reply', () => {
  assert.deepEqual(replyFor({ outcome: 'started', snapshot, runId: 'run-1' }), {
    type: 'run',
    runId: 'run-1',
    restart: false,
  });
  assert.deepEqual(replyFor({ outcome: 'awaiting_resume', snapshot }), { type: 'resume' });
  assert.deepEqual(replyFor({ outcome: 'unsupported' }), { type: 'saved' });
  assert.deepEqual(replyFor({ outcome: 'existing_search', intentId: 'plan-2' }), {
    type: 'existing',
  });
});

test('the sheet then acts on the new plan, the one already going, or none', () => {
  assert.equal(targetOf({ outcome: 'started', snapshot, runId: 'run-1' }), 'plan-1');
  assert.equal(targetOf({ outcome: 'awaiting_resume', snapshot }), 'plan-1');
  assert.equal(targetOf({ outcome: 'existing_search', intentId: 'plan-2' }), 'plan-2');
  assert.equal(targetOf({ outcome: 'unsupported' }), null);
});
```

Run: `node --experimental-strip-types --test tests/mobile-compose-reply.test.mjs`
Expected: FAIL, `Cannot find module '…/compose-reply.ts'`.

- [ ] **Step 2: The reply each outcome gets**

Create `apps/mobile/src/features/compose/compose-reply.ts`:

```ts
import type { CreateIntentResponse } from '@nexui/types';

/**
 * What the + sheet shows under a sent message. A run started by `start` (`restart`) retries by
 * starting again; any other retries by sending the text again.
 */
export type Reply =
  | { type: 'run'; runId: string; restart: boolean }
  | { type: 'saved' }
  | { type: 'resume' }
  | { type: 'existing' };

/**
 * The sheet's next step after a new goal (job search spec, sections 2 and 4): stream the plan's
 * run, say the goal was saved, ask for the plan's resume, or offer the plan already going.
 */
export function replyFor(result: CreateIntentResponse): Reply {
  switch (result.outcome) {
    case 'started':
      return { type: 'run', runId: result.runId, restart: false };
    case 'unsupported':
      return { type: 'saved' };
    case 'awaiting_resume':
      return { type: 'resume' };
    case 'existing_search':
      return { type: 'existing' };
  }
}

/** The plan the sheet acts on next, or null after a saved goal: the next send starts a new plan. */
export function targetOf(result: CreateIntentResponse): string | null {
  switch (result.outcome) {
    case 'started':
    case 'awaiting_resume':
      return result.snapshot.intent.id;
    case 'existing_search':
      return result.intentId;
    case 'unsupported':
      return null;
  }
}
```

Run: `node --experimental-strip-types --test tests/mobile-compose-reply.test.mjs`
Expected: PASS.

- [ ] **Step 3: The two replies**

Create `apps/mobile/src/features/compose/resume-step.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { TemplateIntake } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

/**
 * The step after a goal whose plan reads a document first (job search spec, section 4): what
 * Nexui is planning, why it asks, then Add or Continue without; either starts the plan. Closing
 * the sheet here leaves the plan on Home as Ready to start.
 */
export function ResumeStep({
  intake,
  reading,
  busy,
  onAdd,
  onSkip,
}: {
  intake: TemplateIntake;
  /** The file is being read: 10 to 20 seconds. */
  reading: boolean;
  /** A start is in flight, with a file or without. */
  busy: boolean;
  onAdd: () => void;
  onSkip: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <View style={styles.tagRow}>
        <NexuiTag />
        <Text style={styles.planning}>{intake.planning}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {intake.title}
      </Text>
      <Text style={styles.body}>{intake.detail}</Text>
      {reading ? (
        <Text accessibilityLiveRegion="polite" style={styles.reading}>
          {intake.reading}
        </Text>
      ) : null}
      <Button label={intake.add} variant="primary" busy={reading} disabled={busy} onPress={onAdd} />
      <Button label={intake.skip} busy={busy && !reading} disabled={busy} onPress={onSkip} />
      <Text style={styles.note}>{intake.note}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planning: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.faint },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  reading: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
}));
```

Create `apps/mobile/src/features/compose/existing-plan-reply.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { TemplateExample } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

/**
 * The answer to a second plan of a kind a user keeps one of at a time (job search spec, section
 * 8): it offers the plan already going, and Open puts the goal back in the composer to add to it.
 * With no `example` (the sheet couldn't learn the plan's template) it names no kind.
 */
export function ExistingPlanReply({
  example,
  onOpen,
}: {
  example: TemplateExample | null;
  onOpen: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <NexuiTag />
      <Text accessibilityRole="header" style={styles.title}>
        You already have {example ? example.one : 'a plan like this'}. Add this to it?
      </Text>
      <Button
        label={example ? `Open my ${example.short}` : 'Open my plan'}
        variant="primary"
        onPress={onOpen}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
}));
```

Replace `apps/mobile/src/features/compose/index.ts` with:

```ts
export { replyFor, targetOf } from './compose-reply';
export type { Reply } from './compose-reply';
export { ExistingPlanReply } from './existing-plan-reply';
export { nextGoalPlaceholder } from './goal-examples';
export { ResumeStep } from './resume-step';
export { RunCard } from './run-card';
export { afterAsk } from './run-outcome';
export { SavedGoalReply } from './saved-goal-reply';
export { useKeyboardOverlap } from './use-keyboard-overlap';
```

- [ ] **Step 4: The sheet**

In `apps/mobile/src/app/(app)/compose.tsx`, make these changes. The view tree, `openPlan`, `seeChanges`, `seeChoice` and every style keep their code unless listed.

**Imports.**

- Add `import { intakeRoute, TEMPLATE_EXAMPLES, TEMPLATE_INTAKES } from '@nexui/types';`.
- Add `choosePdf`, `useIntents`, `useReplaceResume`, `useStartPlan` and `type PickedPdf` to the `#data` import.
- Add `ExistingPlanReply`, `ResumeStep`, `replyFor`, `targetOf` and `type Reply` to the `#features/compose` import.

**`Sent`.** Replace the interface:

```tsx
interface Sent {
  /** What the user typed; empty when they only sent a file. */
  text: string;
  /** The PDF sent with it, by name. */
  file: string | null;
  reply: Reply;
}
```

**The component's doc comment.** Replace it with: "The + sheet. Opened on a workspace it asks about that plan; opened anywhere else it starts a new plan, then keeps acting on it. A trip's run streams in as a card; a job search first asks for its resume (spec section 4), and a second job search offers the first. On a plan that takes a document, the PDF button adds or replaces it. Closing the sheet doesn't stop a run. After an ask about the plan underneath, it offers See the choice (when Nexui proposed one) or Back to plan."

**State.** After `const cancel = useCancelRun();`, add:

```tsx
const intents = useIntents();
const start = useStartPlan();
const replace = useReplaceResume();
const [notice, setNotice] = useState<string | null>(null);
```

Change `useRun(sent?.runId ?? null)` to `useRun(sent?.reply.type === 'run' ? sent.reply.runId : null)`.

**Derived values.** Replace the block from `const working = …` to `const next = …` with:

```tsx
const plan = context.data?.intent;
// Home's list is almost always cached, so a second search's reply needn't wait on its plan.
const template =
  intents.data?.find((item) => item.id === target)?.template ?? plan?.template ?? null;
const intake = template ? TEMPLATE_INTAKES[template] : null;
const example = template ? TEMPLATE_EXAMPLES[template] : null;
const reading = replace.isPending || (start.isPending && Boolean(start.variables?.pdf));
const working =
  isRunActive(run.data) ||
  create.isPending ||
  ask.isPending ||
  start.isPending ||
  replace.isPending;
const canSend = text.trim().length >= (target ? 2 : 3) && !working;
const canAttach = intake !== null && sent?.reply.type !== 'resume' && !working;
const error = create.error ?? ask.error ?? cancel.error ?? start.error ?? replace.error;
const next = params.intentId ? afterAsk(run.data) : null;
```

Change `const goal = context.data?.intent.goal;` to read `plan?.goal`, and rename `tryExample`'s parameter to `goal` to avoid shadowing `example`.

**`send`.** Replace it with:

```tsx
const send = (message: string): void => {
  const trimmed = message.trim();

  setNotice(null);

  if (target) {
    ask.mutate(
      { intentId: target, text: trimmed },
      {
        onSuccess: (result) => {
          setSent({
            text: trimmed,
            file: null,
            reply: { type: 'run', runId: result.runId, restart: false },
          });
          setText('');
        },
      },
    );

    return;
  }

  create.mutate(trimmed, {
    onSuccess: (result) => {
      setText('');
      setTarget(targetOf(result));
      setSent({ text: trimmed, file: null, reply: replyFor(result) });
    },
  });
};

// Starts the plan waiting for its document, with the file or without, then streams its build.
// A failed build starts again the same way (job search PR 2, Decision 20).
const startPlan = (pdf: PickedPdf | null): void => {
  if (!target) {
    return;
  }

  start.mutate(
    { intentId: target, pdf },
    {
      onSuccess: (result) => {
        setSent((current) => ({
          text: current?.text ?? '',
          file: pdf?.name ?? current?.file ?? null,
          reply: { type: 'run', runId: result.runId, restart: true },
        }));

        if (result.intake === 'unreadable' && intake) {
          setNotice(intake.unreadable);
        }
      },
    },
  );
};

// Picks a PDF and sends it where the plan's intake takes it (spec section 4).
const attach = async (): Promise<void> => {
  if (!plan) {
    return;
  }

  setNotice(null);

  try {
    const choice = await choosePdf();

    if (!choice) {
      return;
    }

    if ('problem' in choice) {
      setNotice(choice.problem);

      return;
    }

    if (intakeRoute(plan) === 'resume') {
      replace.mutate(
        { intentId: plan.id, pdf: choice.pdf },
        { onSuccess: () => setNotice('Replaced your resume.') },
      );

      return;
    }

    startPlan(choice.pdf);
  } catch {
    setNotice("Couldn't open your files. Try again.");
  }
};

// Open my search: the goal goes back in the composer, to send to the plan already going.
const openExisting = (): void => {
  setText(sent?.text ?? '');
  setSent(null);
  inputRef.current?.focus();
};

const retry = (current: Sent): void => {
  if (current.reply.type === 'run' && current.reply.restart) {
    startPlan(null);

    return;
  }

  send(current.text);
};
```

**The scroll view's children after the chip.** Replace them with:

```tsx
{
  sent?.text ? <Text style={styles.bubble}>{sent.text}</Text> : null;
}
{
  sent?.file ? <Text style={styles.file}>{sent.file} · PDF</Text> : null;
}
{
  sent?.reply.type === 'saved' ? <SavedGoalReply onTry={tryExample} /> : null;
}
{
  sent?.reply.type === 'resume' && intake ? (
    <ResumeStep
      intake={intake}
      reading={reading}
      busy={start.isPending}
      onAdd={() => void attach()}
      onSkip={() => startPlan(null)}
    />
  ) : null;
}
{
  sent?.reply.type === 'existing' ? (
    <ExistingPlanReply example={example} onOpen={openExisting} />
  ) : null;
}
{
  sent?.reply.type === 'run' ? (
    <RunCard
      run={run.data}
      stopping={cancel.isPending}
      onStop={(runId) => cancel.mutate(runId)}
      onRetry={() => retry(sent)}
      retrying={ask.isPending || create.isPending || start.isPending}
      onSeeChanges={seeChanges}
    />
  ) : null;
}
{
  sent?.reply.type === 'run' && target && !params.intentId ? (
    <Button label="Open plan" variant="primary" onPress={openPlan} />
  ) : null;
}
```

**The composer.** Above the `error` line, add:

```tsx
{
  reading && sent?.reply.type !== 'resume' && intake ? (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {intake.reading}
    </Text>
  ) : null;
}
{
  notice ? (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {notice}
    </Text>
  ) : null;
}
```

and as the first child of `inputRow`:

```tsx
{
  canAttach && intake ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={intake.add}
      onPress={() => void attach()}
      style={styles.attach}
    >
      <Text style={styles.attachText}>PDF</Text>
    </Pressable>
  ) : null;
}
```

**Styles.** Add:

```ts
  file: {
    alignSelf: 'flex-end',
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.muted,
  },
  notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  attach: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  attachText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
```

- [ ] **Step 5: Run the tests**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (732).

Smoke on Expo web (mock AI, `JOB_SEARCH=on`):

1. `+` → `Find a Staff PM role in London`. Check:
   - the resume step shows the canvas's copy;
   - **Add resume (PDF)** with `cv.pdf` shows `Reading your resume…`, then the file line and the build's RunCard streaming;
   - **Open plan** opens it.
2. A second goal, `Find a senior PM role in Leeds`, answers `You already have a job search. Add this to it?`. **Open my search** puts the goal back with the chip on that plan, and sending asks it.
3. A third run, closing the sheet at the resume step: Home shows `Ready to start`.
4. On a started job search, the **PDF** button replaces the resume (`Replaced your resume.`).
5. A trip goal still streams as before, with no PDF button.

Delete the smoke plans afterwards.

- [ ] **Step 6: Commit**

Message: `Ask for the resume in +, offer the search already going, and add a PDF button`

```bash
git add apps/mobile/src tests/mobile-compose-reply.test.mjs
git commit -F <message file>
```

---

### Task 17: Docs, reviews, the full smoke test, the PR and the preview build

Spec section 10's packaging: the reviewers and the docs keeper before handoff, then a draft PR. The founder's preview build closes it (Decision 1).

**Files:**

- Modify: `docs/architecture/mobile.md`, `docs/architecture/job-search.md`, and whatever the docs keeper finds stale (`docs/architecture/intent-graph.md`, root `AGENTS.md`'s mobile line)

- [ ] **Step 1: Update the docs**

Dispatch the `docs-keeper` agent with this list, then read its diff. It edits; check every claim against the code.

`docs/architecture/mobile.md`:

- **"Where code lives":**
  - `features/travel/` (the trip's primitives, stop details, place body, travel formatters);
  - `features/jobs/` (pipeline, timeline, role, draft and search bodies);
  - `features/registry/` (`SECTION_REGISTRY`, `DETAIL_REGISTRY`; only routes import it);
  - `features/place/` is gone;
  - `aiMarkFor` is in `lib/`;
  - the three new lint zones and `tests/mobile-import-direction.test.mjs`.
- **"The pure display layer":** the new files:
  - `lib/ai-mark.ts`;
  - `features/travel/{stop-details,trip-actions,travel-format}.ts` and `sections/map-region.ts`;
  - `features/jobs/{job-parts,job-format,role-actions,pipeline,timeline,role-details,draft-details,search-details}.ts`;
  - `data/upload-form.ts`;
  - `features/compose/compose-reply.ts`.

  `workspace-actions.ts` is now the type and two builders, and `change-feed.ts` reads labels.

- **"Sections":**
  - the registry's new home;
  - pipeline and timeline drawn (drop the `PendingSection` paragraph);
  - the insight's `upload`, `copy` and `start` buttons;
  - capability-shaped `WorkspaceAction`.
- **"Optimistic edits":** a primitive builds its own optimistic ops (trip days and order, a role's stage, criteria, a rename, a forgotten pass).
- **"The place sheet":** becomes "The object sheet" (`/object`, `DETAIL_REGISTRY`, `DetailProps`, `open` swaps in place, `hasDetail` and the meta line).
- **"The + sheet":**
  - the four replies (`compose-reply.ts`);
  - the resume step;
  - Open my search;
  - the PDF button;
  - Try again restarting a build;
  - drop the paragraph that says the sheet doesn't draw `awaiting_resume`.
- **"The map":** the note on native modules gains `expo-document-picker` and `expo-clipboard`, which need a new dev client and preview build.
- **A short "Changes" paragraph:** rows read `payload.label` and `payload.figures` and never kinds.

`docs/architecture/job-search.md`:

- **"Configuration and rollout":** the app side has shipped. Production turns `JOB_SEARCH` on after the preview build with the two native modules is installed. The gate stays for the next template.
- **A short "In the app" section:**
  - the + sheet's resume step;
  - the pipeline with Interested and Pass (reasons tune scoring);
  - the timeline;
  - the role, draft and search sheets;
  - renames and criteria through `object.update`;
  - `jobs.forgetPass`;
  - the AI disclosure line.

- [ ] **Step 2: Run the reviewers**

Dispatch, in parallel, each with the branch's diff from `main` (tell each to read long briefs in chunks with offset/limit):

- `mobile-reviewer`: everything under `apps/mobile`.
- `api-reviewer`: Task 4's API changes and their tests.
- `security-reviewer`:
  - `object.update` callable by users;
  - `jobs.forgetPass`;
  - multipart uploads from the app;
  - `mailto:` links built from draft fields;
  - `View posting` opening a model-written URL (host shown first);
  - nothing logged.

Fix every Critical and Important finding in its own commit. Note anything deferred, with its reason, for the PR body.

- [ ] **Step 3: The whole flow, on Expo web, as the QA user**

The API runs on 3010 with `AI_PROVIDER=mock` and `JOB_SEARCH=on` against dev, and Expo web on 8091. For the session, use `node scripts/qa-session.mjs > .qa/session.json`, served to the page from a one-off localhost server so the token never enters the session's context. Revoke it after (`--revoke`).

1. **Create the plan.** `+` → `Find a Staff PM role in London` → **Add resume (PDF)** (`cv.pdf`) → the build streams → **Open plan**. Check:
   - the meta line reads `Staff Product Manager · …` with ›;
   - the metrics show;
   - Coming up shows `No interviews yet`;
   - the Roles pipeline shows New with the disclosure.
2. **Add roles.** As the QA user, add two roles with `jobs.addRole` (Task 12's inputs), and one interview with a raw changeset (`insert_object` `interview` and `insert_relationship` `for` a role). Check:
   - Home's card shows company chips;
   - Coming up shows the interview with its day block and time;
   - Interested and Pass (with a reason) move cards at once;
   - Closed folds.
3. **The role sheet.** Rename, change stage, View posting (host shown), Ask about this role (closes onto + prefilled).
4. **The search sheet** (from the meta line). Add and remove a place, toggle a mode, change the floor, remove the pass reason, Replace the resume. Undo works each time, and Changes lists each label.
5. **A second goal.** It answers `You already have a job search…`.
6. **A trip still works.** Stops open in `/object`, days and order edit, Choose resolves, and Changes reads `Set Tokyo to 3 days`.
7. **Dark mode.** Repeat the plan and both sheets: the AI marks and dashed outlines read on dark.

Keep screenshots in the worktree's `.qa/` (git-ignored). Delete every plan the smoke created.

- [ ] **Step 4: Final checks**

Run each, expecting each to pass or print what it says:

```bash
pnpm fix
pnpm lint
pnpm typecheck
pnpm test          # 732 pass
pnpm format:check
pnpm build
```

Then run the seam grep from Global Constraints. Expected: only `apps/mobile/src/data/place-media.ts:10`.

- [ ] **Step 5: Push and open the draft PR**

Push the branch (`git push -u origin <branch>`; if the auto-mode check refuses it, ask the founder to say "push it" in chat), then:

```bash
gh pr create --draft --title "Draw job search in the app (job search PR 3)" --body-file <body file>
```

The body:

- What changed, in a few bullets per area: the + sheet, the plan, the sheets, Home, Changes, the architecture work, and the API.
- Validation: lint, typecheck, test count, format, build, the smoke steps with what each showed, and the reviewers' findings with what was fixed.
- Spec departures: link this plan's list.
- Rulings made during the build, each with its cost if wrong.
- Left for later.
- A merge checklist:
  - [ ] Merge after this plan's docs PR.
  - [ ] Founder: `pnpm build:preview`, install on the iPhone, and check the resume step (Files picker), Copy, Open in Mail and the dark theme on the device.
  - [ ] Then Vercel production: `JOB_SEARCH=on`.
  - [ ] `/update-roadmap` to mark PR 3 merged.
- End with the attribution line.

- [ ] **Step 6: Hand off**

Report:

- the PR link;
- the test count;
- the smoke results;
- the reviewers' outcomes;
- the two manual steps left: the preview build and device check, then the production switch.

---

## Self-review

Run against the spec and the handoff after writing:

- **Spec coverage, week 3's list:**
  - `pipeline` (Task 12), `timeline` (11), `/object` (8);
  - the role, draft and search bodies (13, 14, 15);
  - the resume step and paperclip (16; the paperclip is the **PDF** button);
  - pass reasons (12, 15), Home chips (9), the meta line (1, 8);
  - `upload` and `copy` (10).
- **PR 3's row:**
  - capability-shaped `WorkspaceAction` (6);
  - `KIND_META` (1), `DETAIL_REGISTRY` (8);
  - the `features/travel/` and `features/jobs/` split (7, 11);
  - the change feed reading labels (5);
  - the `format.ts` split (7).
- **The six carried items:** see "Carried from PR 2".
- **The scope cut:** kits, Add interview, Prep me, Pause/Resume and forwarding are named under "Not in this plan" and nowhere built. Turning `JOB_SEARCH` on is a merge-checklist line, not a task.
- **Review Focus:** each line names the task whose tests pin it.
