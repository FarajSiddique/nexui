# Job search: slice 2

**Status:** approved in conversation on 2026-10-04; awaiting review of this written spec.
Amended the same day: sections 0, 3.2, 5.5 and 10 fold in
[`2026-10-04-architecture-readiness.md`](./2026-10-04-architecture-readiness.md), the review of
what the code needs before a second template, so the plan schedules that work by PR.
**Adds to:** `2026-09-27-intent-graph-design.md`, section H "Slice 2: job search", and its lines on
`pipeline`, `timeline`, `web.search`, `jobs.*` and `ExternalEvent`. That spec's tests still hold:
no new tables, no new screens, no tasks or checkboxes.
**UX canvas:** [Job Search Experience](https://claude.ai/artifact/WKBn2WoC6QjKJkogjqZSAp), 17
screens drawn from sections 2–8 (private until shared). Where the canvas and this spec disagree,
this spec wins.

Job search is Nexui's second use case. It ships in the closed beta (Nov 23) and at launch (week
of Feb 1). The build runs Oct 12 → Nov 20, beside the web app work, and its eval must pass by
**Nov 13**. If it doesn't, the beta starts with trips and job search joins midway.

## 0. Decisions made while brainstorming

| Topic                 | Decision                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who it's for          | **The employed professional looking quietly.** Strict matching, at most 3 new roles a day, and discretion: Nexui never surfaces the current employer. Active high-volume seekers still work, capped.                    |
| Routing               | Jev picks `travel`, `job_search` or `unsupported`. If Jev fails, the create route answers 503 "try again" instead of guessing.                                                                                          |
| Unsupported goals     | This spec covers routing, the "can't plan this yet" reply and saving the request. Notify-later and the goal-first welcome screen are separate.                                                                          |
| Resume                | **Classify first, then ask.** A job search pauses before its build run for an optional resume PDF. The PDF is read once through Gateway; Nexui never stores the file.                                                   |
| Where roles come from | **Employer job boards are the source of truth** (Greenhouse, Lever, Ashby: public, free). One date-filtered web search per scan finds new roles and companies. Every role is confirmed live on its board.               |
| New roles             | ≥ 0.85 → the pipeline's **New** stage, top 3 a day, AI-marked with a dashed outline, **Interested** or **Pass** (one-tap reason). 0.6–0.85 → at most one partial-fit insight. Below 0.6 → dropped.                      |
| Role details          | `/place` becomes **`/object`**, one details sheet with a body per kind. A deliberate judgment call against "no new screens": a new body in an existing sheet.                                                           |
| Background work       | A daily **check-in** (code only, free) and a daily **scan** (new roles). One migration adds the run kinds.                                                                                                              |
| Free vs paid          | After launch, free gets the build and first matches, the daily check-in and on-request runs. Daily scans and automatic application kits are paid. Everything is on in the beta. (A flag for Cost & Pricing.)            |
| Application kit       | Marking a role Interested prepares a tailored cover letter and an application brief.                                                                                                                                    |
| Nothing leaves Nexui  | Drafts only. **Open in Mail** fills in a `mailto:` message the user sends. No `approval` policy in v1.                                                                                                                  |
| Connectors            | **Forward to Nexui** is a v1 **Should**: a personal address for recruiter emails and invites. Calendar and inbox connections come after launch.                                                                         |
| Ending                | Hired completes the plan and keeps it as a record. Pause is the user's. New-role checks pause on their own after **7 days** with no change by the user.                                                                 |
| One search            | At most one active job search per user.                                                                                                                                                                                 |
| Eval                  | `pnpm eval:jobs`: 24 routing goals, 8 live cases (build → scan → kit), zero dead links, a human rubric. Two live passes on different days by Nov 13.                                                                    |
| Architecture          | Trip-only seams are **replaced by registries, never branched**: no `if (template === 'job_search')` beside an existing `=== 'travel'`. The registries land in PR 1 before any `jobs.*` code (readiness doc, section 3). |
| Packaging             | This spec and its plan in one docs PR. The build in five PRs, routing first.                                                                                                                                            |

## 1. Who it's for, and what success looks like

The user is a busy professional who already has a job and is looking quietly. They're picky,
apply to a few roles a month, and care about discretion. They'd rather Nexui scouted and
screened than scroll job boards at night.

**The daily reason to open Nexui comes from Nexui.** Each morning it has checked for new roles,
screened them against the user's background, re-checked the roles already in play, and noticed
what's due: a follow-up, an interview tomorrow. The user's part is a few calls: Interested or
Pass, Choose, I applied. Without that, job search would be a manual tracker like Huntr or Teal.

Success for v1 means:

- a job search goal becomes a plan with criteria, first matches and at most two open questions;
- every role Nexui shows is live on the employer's own board;
- marking a role Interested produces drafts usable with light edits;
- follow-ups and interview prep surface on time without the user asking;
- the eval passes by Nov 13 (section 9).

Recruiting for the beta should look for people who are employed and looking, not only active
seekers, so the beta tests the user this spec designs for.

## 2. Routing and saved requests

**Perception.** `chooseTemplate` (`apps/api/src/lib/perception/perceive.ts`) answers one of
three choices:

- `travel`: as today.
- `job_search`: getting a job. A job search, a career move, roles at named companies, or one
  application or interview ("prep me for my Google interview").
- `unsupported`: anything else, such as a move, a wedding, buying a car or hiring for a team.

The prompt stops naming job search as an example of `none`. `TemplateChoice` becomes
`'travel' | 'job_search' | 'unsupported'`, and `RunInput.template` gains `job_search`.
`intents.template` already allows `job_search`, so no migration is needed here.

**If Jev fails, Nexui doesn't guess.** `POST /api/intents` answers 503 "Nexui couldn't read that
goal. Try again." The + sheet keeps the typed text, so retrying is one tap. A wrong guess builds
the wrong plan or wrongly says "can't plan this"; a retry costs less. Mock mode keeps answering
`travel` when no fixture matches, so existing fixtures keep working.

**The create response becomes a union** (`createIntentResponseSchema`, keyed by `outcome`):

| `outcome`         | When                                         | Body                  | Status |
| ----------------- | -------------------------------------------- | --------------------- | ------ |
| `started`         | A trip: seeded, and its run queued           | `{ snapshot, runId }` | 201    |
| `awaiting_resume` | A job search: seeded, no run yet (section 4) | `{ snapshot }`        | 201    |
| `unsupported`     | Anything else: saved                         | `{}`                  | 201    |
| `existing_search` | A job search while one is active (section 8) | `{ intentId }`        | 200    |

**Unsupported goals.**

- `startIntent` saves the goal as an intent with `template: null`: no workspace, no run, and no
  model call beyond Jev.
- The + sheet says "Nexui can't plan this yet. It's saved, and you'll hear when it can. Today
  Nexui plans trips and job searches." It offers two example chips (a trip, a job search) and
  opens no plan.
- **Home lists only intents with a template** (`listIntents` adds `template is not null`). The
  saved requests are the template-null rows: no new table, no status trick.
- An SQL query in `docs/architecture/` lists saved goals across users, to rank use case #3.
  Notifying people later is a one-off when that use case ships, and is not built now.
- Account deletion removes saved goals with everything else.

**Copy that assumes a trip.** "Nexui can plan trips so far" (`graph/commit.ts`, `compose.tsx`,
`intent/[id].tsx`) and "Nexui can only change trips so far" (`startAsk`, `stage.ts`) become
template-neutral, or go where they can no longer be reached. The + sheet's placeholder alternates
a trip example and a job example.

## 3. The job search plan

### 3.1 Kinds

New Zod kinds in `packages/types/src/kinds/jobs.ts`, registered at `version: 1` with
`KIND_CARDS` entries. No migration: `objects.kind` is only pattern-checked.

| Kind          | `data`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`      | The anchor, like `trip`. `roles` (1–5 titles), `locations` (0–5), `workModes` (`remote`, `hybrid`, `onsite`; at least one), `salaryFloor?` `{amount, currency}`, `industries` (0–5), `excludeCompanies` (0–20; the current employer is added from the resume), `passReasons` (last 30 of `{reason, company, title, at}`), `status` (`active`, `paused`, `hired`), `roleChecks` (`on`, `paused`), `forwardFrom?` (a second sending address, section 7), `forwarding` (`{firstAt?, hintDismissedAt?}`), `derived` (section 3.5) |
| `company`     | `name`, `domain?`, `board?` `{provider: 'greenhouse' \| 'lever' \| 'ashby', token}`, `target` (the user named it), `about?` (one or two sentences)                                                                                                                                                                                                                                                                                                                                                                            |
| `opportunity` | A role. `title`, `url`, `source?` `{provider, token, jobId}` (absent for a role added by hand without a board), `location?`, `workMode?`, `salary?` `{min?, max?, currency}`, `fit?` `{score, reasons (1–3), gaps (0–2)}`, `stage`, `outcome?`, `postedAt?`, `lastSeenLiveAt?`, `postingClosedAt?`, `appliedAt?`, `lastContactAt?`, `followUps` (follow-ups sent, 0–2)                                                                                                                                                        |
| `interview`   | `at` (date and time with offset), `label` ("Recruiter screen", "Panel"), `with?`, `link?`, `notes?`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `person`      | `name`, `role` (`recruiter`, `hiring_manager`, `referral`, `interviewer`, `other`), `email?`, `notes?`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `document`    | `docType` (`resume`, `cover_letter`, `brief`, `follow_up`, `withdrawal`), `body` (up to 20 000 characters for a resume, 8 000 otherwise), `subject?`, `to?`, `profile?` (resume only: headline, current title and employer, location, years, up to 20 skills, past roles), `fileName?` (resume only)                                                                                                                                                                                                                          |

`decision`, `option`, `insight` and `thing` are reused unchanged.

**Relationships:** every object in the search is `part_of` the search, as in travel. An
`opportunity` is `at` its `company`. A `document`, `interview` or `person` is `for` its
`opportunity`; an interview brief is `for` its `interview`.

**Stages:** `new` → `interested` → `applied` → `interviewing` → `offer`, plus `closed`. A closed
role has an `outcome`: `passed`, `rejected`, `withdrew`, `no_reply`, `posting_closed`,
`declined` or `accepted`. A stage records a fact about the role. Nothing is checked off.

**Bookkeeping lives outside the graph**, in `intents.context.jobs` (validated per template in
code): `{ timezone, nextCheckAt, scan: 'daily' | 'off', seen: string[] }`. `seen` holds the last
300 job keys (`provider:token:jobId`) the scans considered, so they aren't scored twice. None of
it is plan content, so clients and models never see it, and moving it never conflicts with an
edit.

### 3.2 Workspace

`seedJobSearchOps` creates the `search` and this doc, top to bottom:

1. **Meta line** from the anchor: "Staff PM · London or remote · £120k+". Tapping it opens the
   search's details sheet (section 6). `intent/[id].tsx` picks the meta by anchor kind
   (`tripMeta` or `searchMeta`).
2. **`metric`**: `search.new` (with `emphasis: 'whenPositive'`), `search.inPlay`,
   `search.interviewsThisWeek`, all `count`.
3. **`insight`**, pinned open: follow-ups, interviews coming up, the partial fit, "add your
   resume", paused checks, forwarding onboarding.
4. Decisions are added pinned open by `decision.propose`, as in travel.
5. **`timeline`** "Coming up": interviews by `data.at`. The primitive splits upcoming and past
   with the device clock, for display only, and collapses the past.
6. **`pipeline`**: opportunities by `data.stage`. On a phone, stages are groups with New open
   first. On a desktop browser, stages are columns. `closed` collapses to a count row.
7. **`objectList`** "Watching": target companies, compact (a Should).

**The two new primitives** (`packages/types/src/workspace.ts`, `SECTION_REGISTRY`):

```ts
| {
    type: 'pipeline';
    query: GraphQuery;
    stageField: string; // 'data.stage'
    stages: { value: string; label: string }[]; // shown in order
    collapsed: string[]; // stages shown as one count row, e.g. ['closed']
    cardActions?: { stage: string; actions: CardAction[] }[]; // New: Interested, Pass
  }
| {
    type: 'timeline';
    query: GraphQuery;
    dateField: string; // 'data.at'
    labelField: string;
    empty?: string;
  }

type CardAction = {
  label: string;
  capability: CapabilityName; // called with { objectId, ...input }
  input?: Json;
  tone: 'primary' | 'secondary';
  pick?: 'passReason'; // opens the primitive's reason picker before calling
};
```

The pipeline's New cards show **Interested** (`jobs.setStage` to `interested`) and **Pass**
(`jobs.pass`). Pass opens a small reason picker inside the primitive with `PASS_REASONS` from
`@nexui/types`: too junior, too senior, wrong location, not this company, pay too low, not the
work I want. **Skip** passes with no reason. Every other card opens `/object`.

**Other contract changes:**

- `DerivedKey` stops being an enum: it is the pattern `<anchorKind>.<key>`, read from the
  anchor's `data.derived`. The search's keys are `search.new`, `search.inPlay` and
  `search.interviewsThisWeek`. Mobile recomputes figures through `KIND_FIGURES`, a
  `Record<AnchorKind, …>` in `@nexui/types` that `tripFigures` joins as `KIND_FIGURES.trip`, so
  `workspace-layout.ts` stops assuming trip figures (readiness doc, section 3.3).
- `InsightAction` gains `{ type: 'upload'; label; docType: 'resume' }`, which opens the document
  picker, and `{ type: 'copy'; label; text }`, which copies text to the clipboard.
- `IntentSummary` gains `stripStyle?: 'route' | 'chips'`. Home draws a job search's strip as
  company chips, AI-marked for roles still in New.
- The kind lists in `capabilities/graph.ts` and `workspace.ts` (`CREATABLE`, `isEditable`,
  `LINK_TYPES`, `DATA_HELP`, the `leg` and `place` special cases, `dependents`) move onto the
  kinds as `KIND_BEHAVIOUR` (`apps/api/src/lib/kinds/behaviour.ts`), and `object.*` and
  `relationship.*` read it. Job search declares `company`, `opportunity`, `document`,
  `interview` and `person` there and adds no graph code (readiness doc, section 3.2).
- `events.payload` gains `label` (the capability's label, or a generic one for a raw changeset)
  and `figures` (what the derive changed). The change feed shows them instead of narrating ops
  by kind (readiness doc, section 3.4).
- `WorkspaceAction` becomes `ask`, `open` and `{ type: 'capability'; request; optimistic }`:
  the primitive that knows its capability builds the request. `pipeline`'s card actions use the
  same shape. A `KIND_META` registry, `Record<AnchorKind, …>`, replaces the `tripMeta` or
  `searchMeta` branch in `intent/[id].tsx` (readiness doc, section 3.5).
- Travel's primitives (`map`, `route`, `allocation`), stop details and the place body move to
  `features/travel/`; job search's go in `features/jobs/`; `features/workspace/` keeps the
  layout engine and the generic primitives. The import-direction lint keeps `features/workspace`
  from importing either.

### 3.3 `derive.jobSearch`

Code only. It runs in every changeset, like `derive.trip`, and in the daily check-in, with `now`
and the search's timezone passed in. It:

- recounts `search.derived`: `{ new, inPlay, applied, interviewing, offers, interviewsThisWeek,
followUpsDue }`;
- upserts a **follow-up** insight (`derivedKey: followup:<id>`) for a role in `applied` with
  `appliedAt` at least 7 days ago, no `lastContactAt` in the last 7 days, and fewer than 2
  follow-ups: "No reply from Halyard in 8 days." Actions: **Draft a follow-up** (`ask`) and
  **Heard back** (`jobs.logContact` received). After 2 follow-ups and 7 more quiet days it
  offers **Close it** (`jobs.setStage` to `closed` with outcome `no_reply`) instead;
- upserts an **interview** insight for an interview in the next 36 hours with no brief: "Phone
  screen with Corvid tomorrow at 2:00." Action: **Prep me** (`ask`);
- after an `accepted` outcome, sets the search `hired`, the intent `completed`, soft-deletes
  roles still in New, and adds one **Draft withdrawal notes** insight (`ask`) if roles remain in
  Applied or Interviewing (a Should);
- rebuilds `intent.summary`: the line ("3 new · 2 applied · interview Thu"), the strip, and a
  badge, first match wins: "Hired at Corvid" (ok), "Ready to start" (attention, before the
  build run is queued), "Paused" (no tone), "Follow-up due" (attention), "N new roles"
  (attention).

Every derived op rides in the changeset that caused it, so Undo reverts both.

## 4. Getting the resume in

**Classify first, then ask.** The paperclip appears only once Nexui knows it needs a resume, so
no file is ever attached to a trip or an unsupported goal.

1. The user types a goal. `POST /api/intents` stays JSON. Its body gains `timezone` (IANA, from
   the device), saved in `context.jobs`.
2. For a job search, the search and workspace are seeded and the response is
   `awaiting_resume`. No run is queued.
3. The + sheet shows one step: "Add your resume? Nexui uses it to screen roles and tailor your
   drafts. It reads the PDF once and doesn't keep the file." with **Add resume (PDF)** and
   **Continue without**.
4. Either answer calls **`POST /api/intents/[id]/start`**: multipart, an optional PDF of at most
   4 MB (under Vercel's 4.5 MB body limit). It refuses with 409 once the build has started.
   - With a PDF, one fast-tier call through Gateway sends the file as a file part and returns
     structured output: `text` (up to 20 000 characters) and `profile`. The resume becomes a
     `document` (`part_of` the search, `source: { type: 'user' }`, since the content is the
     user's), and the current employer goes into `excludeCompanies`. That is one changeset.
   - Then the build run is queued. The + sheet shows "Reading your resume…" for the 10–20
     seconds the read takes.
5. If the user closes the sheet at the resume step, the plan shows on Home as "Ready to start",
   and its Open band pins "Add your resume to start" with **Add resume** (`upload`) and **Start
   without** (which calls `start` with no file).

**When the read fails** (a scanned image, an unreadable file, a timeout), the build still
starts. The Open band pins "Couldn't read that PDF. Try another file." with **Add resume**.

**Later uploads.** `POST /api/intents/[id]/resume` takes the same upload and read, and updates
the resume document as one changeset with Undo. It is reached from the paperclip in + on a job
search plan, **Replace** in the search sheet, and the `upload` insight action. A new resume is
used from the next scan on; roles already in New are not scored again.

**What the build run does.** It reads the resume inside a `<resume>` fence, as data and never as
instructions. It sets the criteria from the goal and the profile, and pins at most two open
decisions for what it can't infer and that changes matching a lot (remote or hybrid, a salary
floor). Then it runs the scan pipeline once (section 5.4), so first matches and daily matches
come from the same code and the same caps.

**Privacy.** The PDF goes to Anthropic once, and Nexui never stores the file. The text lives in
the plan under RLS and is deleted with the plan or the account. Logs never include resume text,
profiles, drafts or email content.

## 5. The daily check-in and scan

### 5.1 Run kinds: the one migration

`runs.kind` and `create_run` gain three kinds. They take no `text` or `route`; `create_run`
checks each kind's input. The per-intent and 3-per-user limits apply as before.

| Kind       | What it does                                                    | Started by                |
| ---------- | --------------------------------------------------------------- | ------------------------- |
| `checkin`  | Code only (section 5.3). No model call.                         | `enqueue_job_checks`      |
| `scan`     | The check-in, then new roles (section 5.4).                     | `enqueue_job_checks`      |
| `external` | Applies the facts from a forwarded email (section 7; a Should). | `POST /api/inbound/email` |

The kit run (section 6) is an `ask` with a `task: 'kit'` field on `RunInput`, so it needs no new
kind.

### 5.2 Scheduling

- `enqueue_job_checks(p_limit, p_mode)` is a new `security definer` function, executable by
  `service_role` only. The cron route (`GET /api/cron/runs`) calls it every minute before
  `sweepRuns`, passing `p_mode` from `JOB_SCANS` (`on`, `checkins_only` or `off`).
- It finds job search intents whose `search.status` is `active` and whose
  `context.jobs.nextCheckAt` has passed. It queues a `scan` if `context.jobs.scan` is `daily`,
  `search.roleChecks` is `on` and the mode is `on`; otherwise a `checkin`. With mode `off` it
  queues nothing.
- In the same transaction it moves `nextCheckAt` to 07:00 tomorrow in the plan's timezone. A
  failed run waits for tomorrow and never loops; the queue's own retry still covers a run that
  committed nothing.
- It skips a plan for that minute if a run is already working on it, or the user is at the
  3-run cap.
- `context.jobs.scan` is set when the plan is created, from `scanCadence(user, env)`. In the
  beta it returns `daily` for everyone (`JOB_SCAN_CADENCE`). The paywall work replaces this one
  function.
- Background runs don't show "Drafting" on Home. Changes labels their rows "This morning's
  check" and, for `external`, "From your forwarded email".

### 5.3 The check-in

Code only, one changeset:

1. Re-check every role in `new` or `interested` that has a `source` on its board. If the posting
   is gone, the role closes with outcome `posting_closed`. That is certain and internal, so it
   is applied automatically, with Undo. For roles in `applied` or later, a gone posting is
   normal, so only `postingClosedAt` is set.
2. Roles still in `new` 7 days after they were added are soft-deleted.
3. If the user has made no change on the plan for 7 days (no `user` event on the intent),
   `search.roleChecks` becomes `paused`, and an insight says "Paused new-role checks. Nothing
   looked at in a week, so Nexui stopped searching. Follow-ups and interview reminders still
   come through." with **Resume**.
4. `derive.jobSearch` runs with `now`.

### 5.4 The scan

The check-in first, then:

1. **Find.** Check the boards of the plan's companies that have a `board`; this is free. Then
   one web search, limited to the board domains and the last 7 days, with a query built in code
   from the criteria.
2. **Confirm.** Map each hit's URL to its board API and fetch the posting, to confirm it is
   listed and get its details. Keep at most 25 candidates.
3. **Dedupe.** Skip roles already in the plan (any stage, including passed and closed) and keys
   in `context.jobs.seen`. Skip excluded companies.
4. **Score.** One Jev call (`experimental_evaluate`) with one `boolean` question per candidate:
   "Is this a strong fit for this person?", with the profile, criteria and recent pass reasons in
   `state`. The probability is the confidence.
5. **Explain.** One fast-tier call writes `fit.reasons` and `fit.gaps` for candidates at 0.6 or
   higher only.
6. **Surface.**
   - **0.85 or higher:** the top 3 go into `new`, with their `company` (created or reused), as
     `source: { type: 'ai', runId }`.
   - **0.6 to 0.85:** the best one becomes the partial-fit insight ("Also worth a look: Senior
     PM, Treasury at Tessera. Strong on payments, but on-site four days in Leeds."), replacing
     the last one. **Add it** is a `capability` action (`jobs.addRole`) carrying the role's
     data. **Ask about it** is an `ask`.
   - **Below 0.6:** dropped.
7. Every considered key is added to `seen`.

### 5.5 Lookups, capabilities and prompts

**Lookups are not capabilities.** Capabilities stay pure (input in, ops out), so step replay
never repeats a network call. Network reads become **lookup tools**: read-only, async, no ops.
The scan calls them as plain functions; job search runs also get them as model tools for asks
such as "find roles at climate startups" or "add this role: <url>".

- `web.search({ query, sinceDays })`: the search provider, limited to board domains.
- `jobs.lookup({ url } | { provider, token })`: one posting, or a company's open roles.

**Only board hosts are ever fetched** (the Greenhouse, Lever and Ashby job board APIs). A URL
from a user or a model is parsed to a board and token, or refused: "Nexui can add roles from
Greenhouse, Lever and Ashby job pages for now." No other URL is fetched, so lookups can't be
turned against internal hosts. Board requests send a `User-Agent` with a contact address and
are limited to a few at a time per host.

**Write capabilities** (`policy: 'internal'`):

| Capability             | Caller   | Does                                                                   |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| `jobs.addRole`         | AI, user | Creates or reuses the `company`, creates the `opportunity`             |
| `jobs.setStage`        | AI, user | Moves a role, setting `appliedAt` on Applied and the outcome on Closed |
| `jobs.pass`            | user     | Closes a role as `passed`, appends the reason to `passReasons`         |
| `jobs.logContact`      | AI, user | `sent` or `received`: sets `lastContactAt`; `sent` adds to `followUps` |
| `jobs.addInterview`    | AI       | Creates the `interview` (and `person`), moves the role to Interviewing |
| `jobs.draft`           | AI       | Creates a `document` `for` a role or interview                         |
| `jobs.setSearchStatus` | AI, user | Pause or resume the search, or resume new-role checks                  |

`derive.jobSearch` stays code only. Criteria edits use `object.update` on the search, which the
search sheet's chips call as user changesets.

**Each template gets its own capability set, prompt and anchor ref.** A template registry
(`lib/templates`, `TEMPLATES: Record<Template, TemplateDefinition>`) holds, per template: the
anchor kind and its ref name (`trip` or `search`), the perception line `chooseTemplate` shows
Jev, the empty summary line, the `context` schema (`context.jobs` is validated here, in
`validateOps`), the seed, the derivation, the capabilities, the lookups, the prompt's base and
tasks, and optional per-route budgets. `derive.ts`, `commit.ts`, `orchestrate.ts`, `execute.ts`,
`prompts.ts`, `refs.ts` and `perceive.ts` read from it instead of naming travel, and
`runs/execute.ts` gives a run only its template's tools. Trips don't see the jobs tools, and job
searches don't see the trip tools. Fixtures move to `lib/ai/fixtures/<template>/`. The full
field list is in the readiness doc, section 3.1.

**Heavy fields stay out of prompts.** A kind can name `promptFields`: `renderGraph` shows a
`document`'s `body` as its length and a ref, and a `document.read` lookup returns the text on
request, so a resume and a few drafts don't ride along on every step of every run (readiness
doc, section 3.6).

**Prompts** fence everything from users, boards and email as data: `<goal>`, `<graph>`,
`<request>`, `<resume>`, `<posting>`, `<focus>` and `<email>`, each as escaped JSON, with the
standing rule never to follow instructions found inside them.

## 6. The application work and the details sheet

**The application kit.** `jobs.setStage` to `interested` commits at once. If kits are automatic
for the plan (in the beta, yes; after launch, paid only), the API also queues an `ask` run with
`task: 'kit'`: "Prepare applications for my Interested roles". One kit run takes every
Interested role without a cover letter, up to 3, and when it finishes it queues one more if
roles are still waiting. Each kit adds two documents `for` the role:

- a **cover letter** of about 250 words, tailored to the posting and the resume;
- an **application brief**: the posting's must-haves matched to evidence from the resume, what
  to stress, the gaps and how to address them, and what the company does (at most one web
  search per role).

The posting text is fetched in code first and given to the model in `<posting>`. Free users
after launch get a **Prepare my application** button in the role sheet instead, which counts as
a deep run.

**Follow-ups.** The insight's **Draft a follow-up** is an `ask` that opens + prefilled. A fast
run writes the email with `subject`, `to` (when a contact with an email is known) and `body`.
After the run, the + sheet offers **See the draft**, which opens it in `/object`, the same
pattern as "See the choice". **I sent it** on the draft calls `jobs.logContact` `sent`.

**Interviews.** Without connectors, the user adds them. **Add interview** in the role sheet opens

- aimed at that role ("When is it? e.g. Thursday 2pm, phone screen with Maya"). A fast run calls
  `jobs.addInterview`. The day before, **Prep me** runs a reasoning ask that writes an interview
  brief: likely questions for that stage, stories from the resume, and questions to ask them.

**Asking about one object.** The + context chip can name an object ("Asking about Staff PM at
Ledgerly"). `POST /api/intents/[id]/ask` takes an optional `objectId`, and the model gets that
object's ref in `<focus>`.

**`/object`, the one details sheet.** `app/(app)/place.tsx` becomes `app/(app)/object.tsx`, with
the same sheet presentation and close behavior (Done stays visible). A `DETAIL_REGISTRY` keyed by
kind picks the body, the way `SECTION_REGISTRY` picks primitives:

- **Place:** today's body, unchanged.
- **Role:** title, company, location, salary, the fit and gaps, a stage picker with outcomes
  (**Accept offer** and **Decline** live here in Offer), applied and last-contact dates, **View
  posting** with "still live this morning", its drafts, people and interviews, and **I
  applied**, **Add interview** and **Ask about this role**. Tapping a draft swaps the body in
  place, like "Next stop".
- **Draft:** the text with the AI mark until edited, **Copy**, **Open in Mail** for emails
  (`mailto:` with recipient, subject and body), and **I sent it**. Editing the text in place is a
  Should.
- **Search:** criteria as editable chips, never-show companies, pass reasons (removable), the
  resume's profile with **Replace**, the check status ("Checks every morning at 7"), **Pause** or
  **Resume**, and the forwarding block (section 7).
- **Company** (a Should): name, board link, open roles.

**Nothing leaves Nexui.** Drafts are drafts. **Open in Mail** hands the user a filled-in message
in their own mail app, and they press send. No `approval` capability exists in v1.

## 7. Forward to Nexui (a Should)

A personal address the user forwards recruiter emails and invites to. Nexui updates the roles.
It is the first `ExternalEvent` input from the intent graph spec.

**The address** is `<user id, base32>.<mac>@in.nexui.app`, where the MAC is an HMAC of the user
id with `FORWARD_SECRET`. The webhook verifies it by recomputing the MAC, so no table maps
addresses to users. Mail goes to the user's active job search; with one search per user
(section 8) there is never a choice.

**Who may send.** Mail is accepted only from the account's email or the `forwardFrom` address the
user adds in the search sheet, and only when the provider's SPF and DKIM checks pass. The second
address matters for Sign in with Apple users who hid their email: their account address is an
Apple relay. Anything else is dropped. At most 20 emails per user per day.

**Inbound provider.** The same vendor as the custom-SMTP beta item, chosen there. It must deliver
a signed or authenticated webhook with parsed text, attachments and authentication results.
`POST /api/inbound/email` is server to server, like the cron routes: it verifies the provider,
sends `Cache-Control: no-store` and no CORS headers, and answers at once.

**Processing,** in `after()`:

1. A calendar invite (`.ics`) is parsed in code for the time, organizer and title. Anything else
   goes through one fast-tier call with structured output: type (`applied`, `invite`,
   `rejection`, `reply`, `other`), company, role title, date and time, contact, and a snippet of
   at most 200 characters.
2. It queues an `external` run with only those facts and the read's token usage, which the run
   records in `model_usage`. **The raw email is never stored**, not in the plan and not in
   `runs.input`.
3. The run matches the facts to a role and gets a confidence. Code first narrows by company
   (name, or the sender's or board's domain). With exactly one open role at that company whose
   title agrees, the confidence is 0.9. With several, one Jev call asks a `boolean` question per
   candidate ("Is this email about this role?") and the best probability is the confidence. With
   none, it is below 0.6. Then it applies the thresholds:
   - **0.85 or higher:** applied, with Undo. `applied` sets Applied; `invite` adds the
     interview and contact and moves the role to Interviewing; `rejection` closes the role as
     `rejected`; any reply calls `jobs.logContact` `received`.
   - **0.6 to 0.85:** an insight: "Is this email about Staff PM, Lending at Corvid?" with **Yes**
     and **Not this role**.
   - **Below 0.6:** unlike Nexui's own suggestions, the user sent this on purpose, so it isn't
     dropped silently. An insight says "Nexui couldn't tell which role this email is about" with
     **Ask about it**.

**Encouraging it over typing.** Telling Nexui always works; forwarding should feel easier and
visibly pay off.

- **At the moment it helps**, until the first forward: a line above the composer after **Add
  interview** ("Have the invite? Forward it to Nexui and it adds the exact time." with **Copy
  address**), on **Heard back**, in the **I applied** confirmation, and in the follow-up insight's
  detail ("Forwarded replies clear this automatically").
- **One onboarding insight** after the build run: "Keep this plan up to date without typing."
  with **Copy address** (`copy`) and **Not now** (sets `forwarding.hintDismissedAt`). It leaves
  once dismissed or after the first forward (`forwarding.firstAt`).
- **Add Nexui to contacts** in the search sheet shares a contact card (`.vcf`): the share sheet on
  iOS, a download on web, no permission needed. Forwarding then means typing "Nex" in To.
- **Credit:** Changes and Home's "What changed" say "from your forwarded email".
- **Beta measure:** the share of job searches with at least one forward in their first two weeks
  (`external` runs). It informs whether Gmail's yearly security assessment is worth paying for.

**Later, not v1:** calendar and inbox connections (Google Calendar read needs Google's
verification, reported at 4–6 weeks; Gmail read needs a yearly CASA Tier 2 assessment, 4–8 weeks
and a four-figure fee), and Gmail filters that auto-forward mail from the applicant tracking
systems' sender domains.

## 8. Ending, limits and cost guards

**Ending.**

- **Hired:** **Accept offer** in the role sheet closes the role as `accepted`, and
  `derive.jobSearch` completes the plan (section 3.3). Checks stop because they only run for
  active searches. One changeset, so Undo restores everything, including the checks.
- **Declined offer:** the role closes as `declined`; the search carries on.
- **Pause:** the user pauses in the search sheet or asks in +. Check-ins and scans stop, and
  Home shows "Paused". **Resume** sets the next check to the next 07:00.
- **Automatic pause:** after 7 days with no change by the user, only scans pause (section 5.3).
- **Delete:** unchanged. A background run in progress makes `delete_intent` answer 409 for up to
  a minute.

**One active job search per user.** It gives forwarding one target, bounds scan cost, and a
second track (another city, say) works better as more criteria in the same search. A second job
search goal while one is active gets `existing_search`, and the + sheet says "You already have a
job search. Add this to it?" with **Open my search**, which opens + on that plan with the goal
prefilled. A hired search doesn't count.

**Guards built into the design:**

- At most one background run per plan per day.
- Each scan: 1 web search, at most 25 candidates confirmed, 1 Jev call, 1 fast-tier call, then
  at most 3 New and 1 partial fit.
- Kits: up to 3 roles per run, and 6 kits per user per day.
- Asks: lookups capped at 3 web searches and 10 board lookups per run.
- Forwarding: 20 emails per user per day.
- **Kill switches:** `JOB_SCANS` (`on`, `checkins_only`, `off`) and `JOB_SCAN_CADENCE`.
- **Usage:** each run's `model_usage` also counts `webSearches` and `boardLookups`, for the
  per-user usage limits item to weight.

**Estimated cost per active job search** (estimates from the design, not measurements):

| Work                                 | When                | Cost        |
| ------------------------------------ | ------------------- | ----------- |
| Resume read                          | Once                | ~$0.005     |
| Build and first matches              | Once                | ~$0.10      |
| Check-in                             | Daily               | ~$0         |
| Scan                                 | Daily               | ~$0.03–0.08 |
| Application kit                      | Per Interested role | ~$0.05–0.10 |
| Follow-up draft, interview brief     | On request          | ~$0.01–0.10 |
| Forwarded email needing a model read | Per email           | ~$0.005     |

An active job seeker with everything on costs about **$2–4 a month**. Fifty beta testers all job
searching would cost about **$200 a month**.

## 9. The eval: `pnpm eval:jobs`

A manual live gate like `pnpm eval:travel`, not part of `pnpm test`. It has `--case <name>` and
`--clean`, and tags its plans in `context.eval = { suite: 'jobs', case, at }`. Openings change
daily, so its checks are about validity and fit, never particular roles.

**Part A: routing.** 24 goals, calling `chooseTemplate` directly with live Jev, so no plans or
runs are created. 20 clear cases must all be right ("Business trip to Berlin plus two free days"
→ travel; "Prep me for my Google interview Tuesday" → job search; "Hire a designer for my team"
→ unsupported; "Find an apartment in Lisbon" → unsupported). 4 ambiguous cases accept either of
two answers ("Move to Berlin for a new job": job search or unsupported).

**Part B: eight live cases** through the API as the QA user:

| Case                | Goal                                                    | Resume                     |
| ------------------- | ------------------------------------------------------- | -------------------------- |
| `pm-london`         | Find a Staff PM role in London, fintech                 | Fictional PDF              |
| `backend-remote-us` | Senior backend engineer, remote in the US               | Fictional PDF              |
| `designer-nyc`      | Product designer roles in New York, hybrid is fine      | Fictional PDF, two columns |
| `data-berlin`       | Data scientist jobs in Berlin, English-speaking         | None                       |
| `em-toronto`        | Engineering manager, Toronto or remote in Canada        | Fictional PDF              |
| `growth-sf`         | Head of growth at a Series B–C startup in San Francisco | Fictional PDF              |
| `named-companies`   | A PM role at Stripe, Figma or Notion                    | Fictional PDF              |
| `interview-prep`    | Prep me for my interview at Datadog next Tuesday        | Scanned image (unreadable) |

The fictional resumes live in `scripts/eval-jobs/resumes/`. Each case runs build → scan → kit:

1. **Build:** the run succeeds; every object passes `parseKindData`; the criteria fit the goal;
   the resume's employer is in `excludeCompanies`; 0–3 New roles, at least the case's `minNew`
   (1 for broad markets, 0 for niche ones); every fit has 1–3 reasons and at most 2 gaps; at most
   2 open decisions. `data-berlin` has the "add your resume" insight; `interview-prep` has
   "Couldn't read that PDF" and an interview.
2. **Liveness, the hard bar:** every New role is fetched again from its board and must still be
   listed. **Zero dead links, in every case and every run.**
3. **Fit:** each New role's location or work mode fits the criteria, its title shares a term
   with a target role, and its company isn't excluded.
4. **Scan:** the eval passes one New role, sets `nextCheckAt` in the past with the admin client,
   and calls the cron route. No duplicates, at most 3 added, and the passed role doesn't return.
5. **Kit:** the eval marks the top role Interested. A cover letter (150–400 words, naming the
   company, no `[placeholders]`) and a brief exist, both `for` the role.

If forwarding is built, three fixture emails (an invite, a rejection, "thanks for applying") each
change the right role.

**Part C: human judgment,** by the founder in Expo as the QA user. For each New role: would this
person plausibly consider it? At least two-thirds yes across cases. For each cover letter: usable
with light edits? At least 6 of 8.

**Passing by Nov 13:** Parts A and B all ✓ on two live runs on different days, and Part C meets
its bars. Results go in the PR.

Deterministic behavior (follow-ups, expiry, auto-pause, hired) is covered by unit tests, not the
eval. Two cases get recorded mock fixtures for the smoke test and route tests; board and search
calls are stubbed at the network boundary in tests. A full live run costs about $2–3.

## 10. Build order, cut line and packaging

**Day 1 spikes:** a PDF read through Gateway; Jev answering 25 `boolean` questions in one call;
Exa's and Parallel's storage and display terms, to pick one; live fetches from the three boards.

| Week          | Work                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Oct 12–16 | **Routing and saved requests, merged first** (the welcome screen waits on it). Contracts. The migration. The registries (below). Trip copy.                                                                    |
| 2 · Oct 19–23 | The resume start flow. Board connectors, web search, lookup tools. `derive.jobSearch` and `jobs.*`. The build run. **The eval script, Parts A and B (build).**                                                 |
| 3 · Oct 26–30 | Mobile: `pipeline`, `timeline`, `/object` (role, draft, search), the resume step and paperclip, pass reasons, Home chips, the meta line, `upload` and `copy`.                                                  |
| 4 · Nov 2–6   | Check-in and scan, the cron enqueue, auto-pause, expiry. Kits, follow-up drafts, Add interview, Prep me. Hired and pause. Guards. **First full live eval by Nov 6.** Forward to Nexui if the core is on track. |
| 5 · Nov 9–13  | Eval fixes, two live passes, Part C. Mock fixtures, the Expo smoke test (mock, then live), reviewers, docs. **Gate: Nov 13.**                                                                                  |
| Nov 16–20     | Buffer, remaining Shoulds, and a **new iOS preview build** for device checks: `expo-document-picker`, `expo-clipboard` and the contact-card share are native modules.                                          |

**If behind on Nov 6, cut these Shoulds in order:** Forward to Nexui and its nudges; the
partial-fit insight; the Watching list and company body; the withdrawal-notes insight; editing
drafts in place; desktop pipeline columns (web falls back to the phone layout). If the eval still
fails on Nov 13, the beta starts with trips and job search joins midway.

**Packaging.** This spec and its plan: one docs PR. The build: five PRs, (1) routing, saved
requests and the registries, (2) job search core API, (3) mobile, (4) background work, legwork
and eval, (5) forwarding. Each keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` green, and
the API, mobile and security reviewers and the docs keeper run before each handoff. The
migration is the founder's to push (`pnpm db:push:dev`, then prod).

**Architecture work folded into the build.** From the readiness doc, by PR. PR 1 is
travel-only on the outside (every trip test still passes) and template-driven on the inside, so
PR 2 adds job search by declaring it.

| PR    | Takes                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `TEMPLATES` and the thirteen seams it replaces (3.1); `KIND_BEHAVIOUR` behind `object.*` (3.2); `DerivedKey` as a pattern and `KIND_FIGURES` in types (3.3); `events.payload.label` and `figures` (3.4); `contextSchema` in `validateOps` (3.7); `upgradeWorkspace` as a no-op (3.8); the decision option payload behind the template (3.11); `kinds/travel/` and one `templateSchema` (3.12). |
| 2     | Job search's kinds, behaviour, template entry and `jobs.*` by declaration; `promptFields` and `document.read` (3.6); `withUser` and `parseBody` for the new routes (3.10).                                                                                                                                                                                                                     |
| 3     | Capability-shaped `WorkspaceAction`, `KIND_META`, `DETAIL_REGISTRY`, the `features/travel/` and `features/jobs/` split, the change feed reading labels (3.5, 3.4); `format.ts` split (3.12).                                                                                                                                                                                                   |
| 4     | `enqueue_job_checks` spreads due times; `maxDuration` on every run-queuing route; the sweep cap written down in `docs/architecture/` (3.9); one eval runner for `eval:travel` and `eval:jobs` (3.12).                                                                                                                                                                                          |
| Later | A worker outside the API function; the light snapshot and the changeset index (3.6, 3.9).                                                                                                                                                                                                                                                                                                      |

**The measure.** After PR 3, adding use case #3 touches one folder per workspace and one line
per registry (readiness doc, section 5). If a PR in this build changes `graph/`, `runs/`,
`cognition/`, `orchestrator/`, `features/workspace/`, `features/changes/` or `data/` for a job
search reason, a registry is missing a field; add the field, not the branch.

**Tests**, at the external boundaries:

- `chooseTemplate`'s three routes, and a Jev failure answering 503.
- The registries: `TEMPLATES` covers every `Template` and names only kinds `KIND_BEHAVIOUR`
  allows; `validateOps` refuses a `context` the template's schema rejects; `renderGraph` omits
  `promptFields`-excluded values; the change feed renders `payload.label` without reading kinds;
  `features/workspace` imports neither `features/travel` nor `features/jobs` (readiness doc,
  section 6).
- `startIntent`'s four outcomes, including the one-search rule.
- `start` and `resume` routes: with and without a PDF, an unreadable PDF, too large, already
  started.
- `derive.jobSearch`: counts, follow-up timing and its two-follow-up limit, interview insight,
  hired, summary and badge order.
- Each `jobs.*` capability, with Undo.
- Board connectors and URL parsing with stubbed `fetch`, including refusing a non-board URL.
- Check-in: posting gone, expiry, auto-pause. Scan: dedupe, thresholds, caps, `seen`.
- `supabase/tests/runs-smoke.sql`: the new kinds' input checks and `enqueue_job_checks` (due,
  skipped, mode, `nextCheckAt` moved in the same transaction).
- Forwarding (if built): address MAC, sender checks, the three thresholds, no raw email stored.

**Dependencies on other roadmap items.** Custom SMTP picks the email vendor forwarding uses.
Per-user usage limits consume the new usage counts. The web app work sets the desktop layout the
pipeline columns follow. Run-finished notifications could later carry the morning "3 new roles".

**New env vars:** `JOB_SCANS`, `JOB_SCAN_CADENCE`, the search provider's key (unless it runs
through Gateway), `FORWARD_SECRET` and the inbound webhook secret. Each goes in
`apps/api/.env.example` and is read through an injectable `env` parameter.

## 11. For the founder to update in Notion

Nothing here edits Notion. These are the changes this spec implies:

- **Roadmap, open questions:** "Where new job openings come from" is decided: employer job
  boards as the source of truth, with one date-filtered web search for discovery.
- **Roadmap, "Unsupported goals":** routing, the reply and saving are built with job search
  (PR 1). Notify-later stays a one-off when use case #3 ships.
- **Roadmap, "Recruit 20–50 beta testers":** look for people who are employed and looking.
- **Cost & Pricing:**
  1. Free job search is the build, the daily check-in and on-request runs; daily scans and
     automatic kits are paid.
  2. A paying job seeker costs about $2–4 a month, against about $1.50 for a typical payer. On
     the annual plan (about $4.25 a month net), a heavy job seeker is close to break-even.
  3. New costs: web search per call, Jev on every scan (price still unknown), and an inbound
     email plan (likely shared with custom SMTP).
  4. Suggested weights: a kit counts as a deep run (5); a forwarded email that needs a model
     read counts 1; a scan counts at its real cost.
  5. The "one-off pass per plan" idea fits job search, since searches end.
- **Later decision:** if Google Calendar should connect by launch, its verification takes weeks,
  so the paperwork would have to start in the beta.
