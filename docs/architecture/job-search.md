# Job search

A job search is the second template. A user says what they want, uploads a resume once, and Nexui reads the public job boards for roles that fit. The product design is in [`docs/superpowers/specs/`](../superpowers/specs/); the evidence behind the board and search choices is in `2026-10-10-job-search-spikes.md` there. This doc covers the flow across `apps/api/src/lib/jobs/` as it runs today, and what the app draws of it. The template's place in the registry is in [`intent-graph.md`](./intent-graph.md).

The flow:

```
POST /api/intents → awaiting_resume → POST /api/intents/[id]/start (resume read)
  → build run (model steps, then the scan) → roles in New
```

The model never writes a board fact. A role's source, date last seen live and fit come from code that read the board (see "What a model may say").

## The boards

Only three public job boards are read, through their JSON APIs (`boards.ts`). A board is `{ provider, token, region? }`; a role's source adds the board's own job id.

| Board      | Posting list                                                             | One posting                         | Posted date       |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------- | ----------------- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<token>/jobs`                        | `…/jobs/<id>?pay_transparency=true` | `first_published` |
| Lever      | `api.lever.co/v0/postings/<token>?mode=json&limit=300`                   | `…/<token>/<id>?mode=json`          | `createdAt`       |
| Ashby      | `api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true` | the list, searched by id            | `publishedAt`     |

- **Lever's EU host.** A board with `region: 'eu'` uses `api.eu.lever.co`. Greenhouse serves EU boards from its one API host, and Ashby has one.
- **Greenhouse's list** carries no description or pay, so a candidate is read one by one before it is scored. Greenhouse's `updated_at` is never used: it refreshes constantly.
- **Ashby is read whole.** It has no single-posting endpoint, so its board is read once per run (`BoardDeps.cache`) and the id looked up. An entry with `isListed: false` is dropped.
- **Liveness.** A role is live when its board still lists it: Greenhouse and Lever answer 404 for a posting that is gone, and Ashby's list no longer holds it. Code stamps `lastSeenLiveAt` only after reading the role from its board (the scan, or the button that carries what a scan found).
- **Posted dates** are when a role was first posted.
- **Finding a named company's board** (`findBoard`): the company's name as a token, probed on Greenhouse, Lever, Lever EU and Ashby in turn. The first board with open roles wins, since an empty board answers 200 too.

A posting's text is plain text cut to 4,000 characters (`text.ts`). Its `url` is whatever the board gives, often the employer's careers site, and Nexui never fetches it.

## The URL rules

`parseBoardUrl` (`board-urls.ts`) decides what a pasted or found URL means. Nexui never fetches the URL itself: it reads its token and job id and asks the board's API.

- **Only board hosts count:** `boards.greenhouse.io`, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `jobs.lever.co`, `jobs.eu.lever.co` and `jobs.ashbyhq.com`. The host must match exactly. A URL with credentials, a port or an IP host is refused.
- **A careers site** counts only with Greenhouse's `gh_jid`, and only once confirmed (`resolveCareersLink`): up to three Greenhouse tokens are guessed from the host's labels, the job is read under each, and the posting is accepted only when its own URL has the pasted host. A third-party careers host stays refused.
- **Any other URL** gets `Nexui can add roles from Greenhouse, Lever and Ashby job pages for now.`

Requests to the boards send `User-Agent: Nexui/1.0 (<NEXUI_CONTACT>)`, follow no redirects, time out after 10 seconds, and run at most 4 at a time per host (a finished request hands its slot to the next one waiting). A 404 means gone; any other failure is a `BoardError` whose message holds a status at most.

## Web search

Parallel (`search.ts`) finds postings on the six board hosts above. One call is `POST https://api.parallel.ai/v1/search` with:

- the key in `x-api-key`, mode `fast`, and 10 results;
- `include_domains` set to the six board hosts and `after_date` set to the day `sinceDays` ago (7 by default, up to 30 for a model's search);
- an objective and up to three keyword queries of 3 to 6 words, built in code from the search's roles, places, work modes and industries, never from the resume.

The answer is the hits' URLs in relevance order, only those on a board host. A hit is confirmed on its board before it counts. Its output stays in the plan that asked: nothing is cached across users. A search that times out (15 seconds), answers an error or answers something unreadable is a `SearchError` and finds nothing.

## The scan

`scanForRoles` (`scan.ts`) is one code path for the build run's first scan and for later ones.

1. **Named companies.** Up to five companies the user named, in their order. Each gets its board (the one on file, else `findBoard`), and its open roles whose titles match a target role, newest first, at most 10 a company. A scan given a window (`sinceDays`) keeps only roles posted within it; the build's scan takes any age.
2. **One web search** from the search's criteria, if `PARALLEL_API_KEY` is set and the pool isn't full. Each hit on a board is read from that board.
3. **Filter and cap.** Roles the plan already holds, roles a scan already considered (`context.jobs.seen`), and companies on the never-show list are dropped. A company matches by `companyKey` (lower case, one legal suffix such as Inc or Ltd dropped, only letters and digits kept), against its name and its board's token, so `Jane Street`, `Janestreet` and `jane-street` are one company; the resume's current employer is dropped the same way even if the list was edited. At most 25 candidates go on. The find phase (steps 1 and 2) has 25 seconds.
4. **Score.** One Jev call with a `boolean` question per candidate, "Is this a strong fit for this person?", each question carrying its own role. The person is the resume's profile and the search's criteria, plus the last 10 passes and why: never the resume's text. It has a 10-second limit and one retry.
5. **Pick.** At 0.85 or above, a strong fit: the best three, best first (ties to the newer posting), go to New. From 0.6 up to 0.85, a partial fit: the best one gets the "Also worth a look" card.
6. **Explain.** One fast-tier call writes 1 to 3 reasons and at most 2 gaps for each chosen role.
7. **Commit.** `jobs.surfaceMatches` (code only) adds the roles with their companies and the partial card, and records the boards found for named companies and `seen`, as one changeset: "Found 2 new roles", "Found a role worth a look" or "Checked the job boards". One Undo reverts the whole scan.

`seen` holds the last 300 keys and only what a scan showed or dropped (scored under 0.6). A fit the caps left out stays unseen, so the next scan scores it again and a capped strong fit returns. If scoring or the explain call fails, the scan surfaces nothing and leaves `seen` alone, so the next scan tries again; boards it found are kept. Without a contact it does nothing.

**The build run's scan** (`scanAfterBuild`, the template's `afterBuild`) runs after the model's steps with a 45-second budget, 25 of it for the find phase. It reads named companies' open roles of any age and a week of search hits. Its changeset stays out of the run's progress. A failure after the steps is logged and the run still succeeds. Without `NEXUI_CONTACT` it logs once and does nothing.

## What a model may say

Models read through three lookups (`lookups.ts`), all answering `{ error }` instead of throwing: `web_search` (3 a run; board URLs for a model-written query of up to 120 characters, which the prompt limits to titles, places and industries), `jobs_lookup` (10 a run; one posting from its URL, or a company's open roles from its board; a posting's text comes back fenced in `<posting>`; each role and posting also carries a `boardUrl`, the posting's URL on its board's own host, which can be passed back as `url` when the board's own `url` is a custom careers page) and `document_read` (5 a run; a document's full text, the resume fenced in `<resume>`).

`jobs.addRole` is the only way a model adds a role, and a model's word on a role is its title and where it is:

- its `fit` is dropped, since the fit is the scan's judgement;
- its `source` is taken from the URL, never from the model: the one a board URL names, or for a careers-site `gh_jid` URL the Greenhouse source a lookup confirmed for that host. The role's `url` is tried first, then its `boardUrl`. Any other URL gives none;
- it is not stamped live.

A goal that mentions an interview gets its role and the interview in the build: the role titled as the user put it, or just "Role" when they don't say, so it reads "Role at Datadog" (they can rename it), and the interview dated from the goal and the run's date, which every run's message opens with in the plan's time zone.

A role added from a button carries what a scan found, so it keeps its fit and is stamped live. `accepted`, the outcome that ends a search as hired, is the user's: `jobs.setStage` refuses it from a model.

## The resume read

`POST /api/intents/[id]/start` and `/resume` read an uploaded PDF once (`resume.ts`, the template's `intake`). The file is checked for `%PDF-` first ("That file isn't a PDF.", 400), then one fast-tier call reads it as a file part with structured output: 16,000 output tokens at most, 60 seconds, one retry for a 429 or 5xx. The text (cut to 20,000 characters) and a profile (headline, current title and employer, location, years, up to 20 skills, up to 10 past roles) are stored as the plan's resume document, and the current employer joins the never-show list. The response's `intake` says what this upload found (`none` on a restart without a file, even when the plan already holds a resume), so the app reads the plan's card, not that field, for "Add your resume".

A blank, illegible or non-resume file, a damaged or password-protected PDF, a timeout and an outage all end the same way: "Couldn't read that PDF. Try another file." The plan still starts. The file is never stored, only the bytes in memory during the request.

## In the app

The app draws a job search through the generic workspace and its own folder, `apps/mobile/src/features/jobs/`, joined by the registries in `features/registry/` (see [`mobile.md`](./mobile.md)).

- **The + sheet.** A goal routed here answers `awaiting_resume`, and the sheet asks for the resume: **Add resume (PDF)** picks a file (4 MB at most, `MAX_UPLOAD_BYTES` in `@nexui/types`, checked before it's sent) and calls `start` with it; **Continue without** calls `start` with none. Either streams the build run. A second job search's goal answers `existing_search`: "You already have a job search. Add this to it?", and **Open my search** puts the goal back in the composer to ask that plan. On a job search, the composer's PDF button adds the resume through `start` before the first run and replaces it through `resume` after; it doesn't show under the second-search reply, which is about the other plan.
- **The plan.** The meta line under the title (`searchMeta`: roles, places and pay floor) opens the search's sheet. Coming up (`timeline`) lists interviews soonest first, and a row opens its role. The Roles pipeline shows New first, under the AI disclosure "Picked by Nexui's AI from employers' own job boards.", each role with why it fits, its gaps, **Interested** and **Pass**. Pass asks why in one tap (or skips): the reason joins the search's pass reasons, the last 10 of which the scan's scoring reads. Later stages show only with roles in them, and Closed folds to a count. Home's card shows the search's companies as chips.
- **The sheets.** A role's sheet renames it, moves its stage or closes it with an outcome, shows why it fits, opens its posting after naming the host it opens (a model may have written the URL; one that isn't https or carries a user name or password shows no button), and lists its drafts, people and interviews; **Ask about this role** opens + with the role named. A draft's sheet copies its text, and for a follow-up or withdrawal opens a `mailto:` link in the user's own mail app (Nexui never sends); **I sent it** logs the contact. The search's sheet edits its roles, places, work modes, salary floor, industries and never-show list (the resume's current employer stays), forgets a pass reason, and adds or replaces the resume.
- **What the app calls.** Renames and criteria go through `object.update`, with the same kind checks as a model's call: a role's title follows its `data.title` (`nameField`), and the fields `jobs.*` owns stay refused. `jobs.forgetPass` removes one pass reason by when it was given; only the app calls it. Stage moves are `jobs.setStage` and `jobs.pass`, and I sent it is `jobs.logContact`. Each of these edits has Undo, and all but I sent it show before the server answers. The resume buttons call `start` or `resume` and wait for the server: starting a plan has no Undo, and replacing the resume offers Undo on the plan and in the object sheet, while the + sheet's PDF button only says "Replaced your resume." (the Changes tab can undo it).

## Privacy

- Two kinds of web search query. The scan's search (`searchQuery`) is built from the criteria only. The model's `web_search` lookup sends a query the model writes (up to 120 characters, three a run), and its only guard is the prompt rule that the query holds job titles, places and industries, never resume text. That is a residual risk the prompt rule covers, not code. Jev and the explain call read the profile and criteria, not the resume's text.
- Logs carry a tag and a status code at most (`[jobs]`, `[resume]`, `[lookups]`, `[runs]`). They never carry resume text, a file name, a URL, a query, a company, a posting, a provider's message or the value of `NEXUI_CONTACT`.
- The contact reaches only the boards, in the User-Agent.

## Configuration and rollout

Set in `apps/api/.env.local` (see `apps/api/.env.example`):

- `JOB_SEARCH`: `on` lets Jev route new goals to job search. The gate governs only routing (`routableTemplates`): the `start` and `resume` routes aren't gated. Unset, the template doesn't route (`gate`). The app draws job search (see "In the app"), but production leaves it unset until the iOS preview build with the app's two new native modules, `expo-document-picker` and `expo-clipboard`, is installed, then turns it on. The `gate` field stays for the next template whose app side follows its API.
- `NEXUI_CONTACT`: an email address or URL (at most 200 characters) the boards can reach us at. Unset or invalid, board lookups and the scan are off; an invalid value logs that, without the value.
- `PARALLEL_API_KEY`: unset, web search is off and scans read only the boards of companies a user named. Production waits for Parallel's written answer on its acceptable-use policy.

## Checking it

- `tests/jobs-board-urls.test.mjs`, `jobs-boards.test.mjs`, `jobs-search.test.mjs`, `jobs-lookups.test.mjs`, `jobs-resume.test.mjs`, `jobs-scan.test.mjs`, `jobs-capabilities.test.mjs`, `jobs-derive.test.mjs`, `jobs-kinds.test.mjs`, `jobs-template.test.mjs` and `jobs-build.test.mjs`: the URL rules, the boards' parsing and limits, the search, the lookups, the resume read, the scan and the build run, with network and models stubbed.
- `tests/start-route.test.mjs` and `tests/resume-route.test.mjs`: the two routes.
- `tests/model-surface.test.mjs`: pins what models see for a job search.
- `tests/mobile-jobs-pipeline.test.mjs`, `mobile-jobs-timeline.test.mjs`, `mobile-jobs-role.test.mjs`, `mobile-jobs-draft.test.mjs`, `mobile-jobs-search.test.mjs`, `mobile-compose-reply.test.mjs` and `mobile-upload-form.test.mjs`: the app's pipeline, timeline, sheets, + sheet replies and upload, under plain Node. `tests/kind-meta.test.mjs` and `template-intakes.test.mjs`: the meta line and the intake step's shared contracts.
- Manual live gates: `pnpm eval:jobs` and `node --experimental-strip-types scripts/check-job-search.mjs` (see "Checking it" in `intent-graph.md`).
