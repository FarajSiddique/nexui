# Job search Day 1 spikes

**Status:** the four Day 1 spikes from the job search spec, section 10, run on 2026-10-10 against
`main` at `c076dc5`. They settle the open questions before the PR 2 plan (job search core API).
**Companion to:** `2026-10-04-job-search-design.md` ("the spec" below).
**Method:** throwaway scripts in the git-ignored `.qa/spikes/`, as the handoff settled. Board
fetches sent `User-Agent: Nexui/1.0 (<contact>)` with the `WIKIMEDIA_CONTACT` value. Every
person, company and resume in the Jev and PDF tests is fictional. Live spend: 5 Jev calls and 10
PDF calls, **$0.0105** in total. No trip runs or evals.

## 1. Results at a glance

| Spike                       | Result                                                                                                                                                                                                                               | Changes to the spec                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse, Lever and Ashby | All three are public and keyless, and none throttled us. Ashby has no single-posting endpoint. 13 of 23 Greenhouse employers send applicants to their own careers site, which a board-domain search can't see. Lever has an EU host. | `board` gains a Lever region; Ashby liveness reads the whole board; pasted careers-site URLs with `gh_jid` can map to a board; discovery has a coverage gap |
| Exa vs Parallel (terms)     | **Recommend Parallel**, subject to one written confirmation: its acceptable-use policy lists employment as a high-risk use. Neither runs usefully through Gateway, so the scan needs a provider key.                                 | New env var `PARALLEL_API_KEY`; search results stay per user                                                                                                |
| Jev, 25 `boolean` questions | 25 answers in 0.33–0.63 s for $0.00023, with a near-perfect ranking. Roles referenced by index in a large `state` silently lose all signal past about 31 KB.                                                                         | Each question carries its own role; `state` holds only the person                                                                                           |
| PDF read through Gateway    | Works as specced on `anthropic/claude-haiku-5.5`: 4.5–6.9 s for one page, 11 s for two, $0.0003–0.0017. Two columns and a clean scan read correctly. Bad files fail fast with a 400.                                                 | Add `readable` to the output; map 400s by status; the eval's unreadable case must be illegible, not just scanned                                            |

## 2. Board fetches: Greenhouse, Lever and Ashby

All three job board APIs answer GET requests with no key, and no request was throttled. Three
findings change the design. Ashby can only be read whole. More than half of the Greenhouse
employers sampled point applicants at their own careers site, so a search limited to board
domains can't find their roles. Lever keeps EU customers on a separate host.

### 2.1 Companies checked

Starting from the eval's `named-companies` case (Stripe, Figma, Notion), with companies added
until each board had two or three. Open roles on 2026-10-10:

| Board      | Companies (open roles)                   | Posted in the last 7 days |
| ---------- | ---------------------------------------- | ------------------------- |
| Greenhouse | Stripe (729), Figma (150), Datadog (435) | 68, 9, 27                 |
| Lever      | Palantir (309), Spotify (85)             | 1, 16                     |
| Ashby      | Notion (132), Ramp (165), Linear (31)    | 3, 11, 2                  |

Twenty more Greenhouse boards were sampled for URL hosts (section 2.3), four EU-hosted Greenhouse
boards (AISI, Proton, Parloa, IMC) and four EU Lever boards (Quantinuum, Cirrus Logic, OLX,
Everseen). Two companies have an empty second board: Figma's Ashby board answers 200 with no
jobs, and so does Mistral's Lever board.

### 2.2 Endpoints, sizes and speed

| Board      | List of a company's roles                                                     | One posting                              | A posting that's gone                                 |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` (`?content=true` adds text) | `…/jobs/{id}?pay_transparency=true`      | 404 `{"status":404,"error":"Job not found"}`          |
| Lever      | `api.lever.co/v0/postings/{site}?mode=json` (`skip`, `limit` work)            | `…/postings/{site}/{id}?mode=json`       | 404 `{"ok":false,"error":"Document not found"}`       |
| Ashby      | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`       | **None.** Every guessed path answers 401 | Absent from the list. The job page answers 200 anyway |

| Board      | List size, wire / decoded                                                                        | Measured time                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Greenhouse | Stripe: 33 KB / 445 KB (gzip); with `content=true`, 870 KB / 5.4 MB                              | List 34–170 ms. 30 single reads in a row: p50 40 ms, p95 46 ms                                |
| Lever      | Palantir: 5.7 MB, Spotify: 0.8 MB. **Not compressed**, and every list includes full descriptions | Palantir list 1.0–1.1 s. 30 single reads: p50 99 ms, p95 1.4 s, max 2.1 s. One 404 took 9.6 s |
| Ashby      | Notion: 145 KB / 2.3 MB (brotli); Ramp: 233 KB / 2.9 MB; OpenAI: 1.2 MB / 13.6 MB                | 22–122 ms (Cloudflare, `max-age=60`)                                                          |

Sizes count 1 KB as 1,024 bytes.

EU hosting:

- Greenhouse serves EU-hosted boards from the same `boards-api.greenhouse.io`; only their posting
  URLs use `job-boards.eu.greenhouse.io`. `boards-api.eu.greenhouse.io` doesn't resolve.
- Lever EU customers answer only on `api.eu.lever.co` (posting URLs on `jobs.eu.lever.co`). The
  US host returns 404 for them.

Rate limits: none is documented for these GET endpoints, and none of the responses carried a
rate-limit header. Greenhouse says
"authentication is not required for any GET endpoints". Lever documents a 429 only for
application POSTs (2 a second) and adds "This rate limit may also be changed without warning".
Ashby's docs say nothing about limits.

### 2.3 Ids, URLs, dates and fields

| Board      | Job id             | URL the API gives                                                              | Posted date                                                                                       | Work mode                                                                                     | Salary                                                                                   |
| ---------- | ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Greenhouse | Number (`8172510`) | `absolute_url`: a board page, or the employer's careers site with `?gh_jid=`   | `first_published`. `updated_at` is refreshed constantly: all 729 Stripe roles within about 3 days | None; only a free-text `location.name`                                                        | `pay_input_ranges`, on the single-posting read only (Figma and Datadog yes, Stripe none) |
| Lever      | UUID               | `hostedUrl` on `jobs.lever.co` or `jobs.eu.lever.co`; `applyUrl` adds `/apply` | `createdAt` (epoch ms)                                                                            | `workplaceType`: live values `onsite`, `hybrid`, `remote` (docs say `on-site`, `unspecified`) | `salaryRange`, optional: 0 of 394 roles sampled                                          |
| Ashby      | UUID               | `jobUrl` on `jobs.ashbyhq.com`; `applyUrl` adds `/application`                 | `publishedAt`, documented as "when the job was last published"                                    | `workplaceType` `OnSite`, `Remote`, `Hybrid`, or absent (45 of Notion's 132); `isRemote`      | `compensation` with `includeCompensation=true`: Ramp 158 of 165, Notion 0                |

Old postings stay listed for years: the oldest were 7.5 years at Datadog, 16.8 at Palantir and 5.5
at Linear. "Still listed" is not "new"; the posted date is.

**Greenhouse careers sites.** For 13 of the 23 Greenhouse boards sampled, every `absolute_url`
leaves the board host: Stripe, Datadog, Airbnb, Dropbox, Pinterest, Coinbase, Duolingo,
Instacart, Lyft, Databricks, MongoDB, Asana and Brex. Their board pages redirect there too:
`job-boards.greenhouse.io/stripe/jobs/{id}` answers 302 to `stripe.com/jobs/search?gh_jid={id}`.
A search engine therefore indexes the careers site, not a board domain. The other ten (Figma,
Discord, Reddit, Robinhood, Cloudflare, GitLab, Anthropic, Twilio, Gusto, Affirm) stay on
`boards.greenhouse.io` or `job-boards.greenhouse.io`.

### 2.4 Mapping a pasted URL to a board

A parser, tested on live URLs, maps these forms directly:

- `boards.greenhouse.io`, `job-boards.greenhouse.io` and `job-boards.eu.greenhouse.io`, as
  `/{token}/jobs/{id}`, plus the embed form `/embed/job_app?for={token}&token={id}`;
- `jobs.lever.co` and `jobs.eu.lever.co`, as `/{site}/{uuid}`, with or without `/apply`;
- `jobs.ashbyhq.com`, as `/{name}/{uuid}`, with or without `/application`;
- a bare board root (`jobs.ashbyhq.com/ramp`) gives the company's board.

It refused a LinkedIn job, `http://169.254.169.254/…`, a URL with `user@` before the host, a
look-alike host (`jobs.lever.co.evil.example`) and `evil.example/?gh_jid=…`.

A careers-site URL with `gh_jid` can map too, without fetching that site. Guess the token from
the host's labels (drop `www`, `careers`, `jobs` and the TLD; strip a trailing `careers`, `jobs`
or `hq`), read the posting from the Greenhouse API, and accept only if its `absolute_url` has the
same host as the pasted URL. This mapped 12 of the 13 careers-site URLs above. The 14 URLs tried,
including the hostile one, took 17 board reads.
Lyft failed: its careers site is a third-party host (`app.careerpuck.com`). Only board API hosts
are ever fetched, so the spec's rule holds. Ashby's `ashby_jid` embeds would work the same way;
that wasn't tested.

### 2.5 What changes in the spec

1. **Section 3.1, `company.board`:** `{ provider, token, region? }`, where `region: 'eu'` is
   needed for Lever only. `opportunity.source` carries the same region.
2. **Section 3.1, `opportunity.url`:** the URL the board API gives (`absolute_url`, `hostedUrl`
   or `jobUrl`). For most Greenhouse employers that is their careers site; users open it, Nexui
   never fetches it.
3. **Section 5.5, URL parsing:** accept the forms in section 2.4, including careers-site URLs with
   `gh_jid` confirmed by the `absolute_url` host check. The refusal copy stays.
4. **Section 5.3 (check-in) and the eval's liveness bar:** Greenhouse and Lever confirm a posting
   with one GET (404 when gone). Ashby has no such endpoint: read each company's board once per
   run and check the ids. The job page can't be used, since it answers 200 for any id.
5. **Section 5.4, Find:** "check the boards of the plan's companies" costs one list read per
   company. That's cheap for Greenhouse without `content` and for Ashby, which compresses (up to
   1.2 MB on the wire). It's heavy for large Lever boards (5.7 MB uncompressed): use `limit` and
   `skip`, or filter by `createdAt` while streaming.
6. **New roles mean the posted date** (`first_published`, `createdAt`, `publishedAt`), never
   Greenhouse's `updated_at`.
7. **Finding a company's board by name:** probe Greenhouse, Lever, Lever EU and Ashby, and keep
   the board that has open roles. A 200 alone isn't enough (Figma, Mistral).
8. **Discovery gap (decision for you, section 6):** a search limited to board domains can't find
   roles at Greenhouse employers with careers sites, 13 of the 23 sampled, including
   Stripe and Datadog. The plan's named companies are still covered, because their boards are
   read directly. Accept the gap for the beta, or seed a list of known company boards.
9. **Requests:** a 10 s timeout per request and a few at a time per host, as the spec says.
   Lever's slow tail (2.1 s reads, one 9.6 s 404) needs the timeout.

## 3. Search provider: Exa vs Parallel

**Recommendation: Parallel, called directly with `PARALLEL_API_KEY`, once Parallel confirms in
writing that a job seeker's own role finder isn't a "High-Risk Use Case" needing professional
review.** It is the only one of the two whose terms grant the storage and display Nexui needs,
and it costs a quarter to a seventh as much at 10 results. If Parallel says the clause applies,
fall back to Exa with written permission to store and show results. No key exists, so this rests
on public pages only (section 7).

### 3.1 Side by side

| Point                 | Exa                                                                                                                                                                                                                                                                                                                          | Parallel                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store results         | Not granted. ToS §4.2(a) bars users who "download, modify, copy, distribute, transmit, display, … publish … any information … obtained from or through, the Services", unless "expressly permitted in these Terms or by us in writing". The API licence is "for the limited purposes set forth in the documentation" (§1.1). | Allowed per user. Customer Terms §2(b): output "shall be primarily for the use of one End Customer only, and shall not be copied, cached, stored, or made available to other End Customers". §2(c)(xii) bars serving "Customer Outputs from previous queries" in place of new requests.                   |
| Show results to users | Not granted in the ToS (§4.2(a) names "display"). The docs describe apps with citations. No attribution rule found.                                                                                                                                                                                                          | Granted: §2(b) includes "the right … to make Customer Applications available to End Customers". The AUP asks for disclosure that recommendations were informed by AI.                                                                                                                                     |
| Employment            | No clause found.                                                                                                                                                                                                                                                                                                             | AUP §3: "High-Risk Use Cases" include "employment"; for them, "any content that is provided to your end users … must be reviewed by a qualified professional in that field prior to dissemination". AUP §2 and Customer Terms §8(e) ban automated employment decisions about people without human review. |
| Domain filter         | `includeDomains`: hosts, path prefixes or `*.` wildcards, up to 1,200                                                                                                                                                                                                                                                        | `source_policy.include_domains`: hosts (with subdomains) or path prefixes (not in `turbo`), up to 200                                                                                                                                                                                                     |
| Date filter           | `startPublishedDate` and `endPublishedDate`, on an estimated publish date; crawl-date filters are ignored                                                                                                                                                                                                                    | `after_date` only, on publish date "if available"                                                                                                                                                                                                                                                         |
| Results per search    | 25 self-serve, by the pricing page's Enterprise line ("requests above 25 results")                                                                                                                                                                                                                                           | 20 at most ("higher requested values are reduced to 20")                                                                                                                                                                                                                                                  |
| Price per search      | `instant` $0.004, `fast` $0.007, plus $0.001 per result above 10                                                                                                                                                                                                                                                             | `fast` or `turbo` $0.001, `basic` or `advanced` $0.005, plus $0.001 per result above 10                                                                                                                                                                                                                   |
| Rate limit            | 10 per second                                                                                                                                                                                                                                                                                                                | 600 per minute                                                                                                                                                                                                                                                                                            |
| Data use              | Exa takes a "perpetual and irrevocable license" to "User Input and Output … to provide, develop and improve" its services (§1.2(c)); the privacy policy says query data trains its models. Zero retention is Enterprise only.                                                                                                | Customer Terms §4(b): "Parallel may use Customer IP to train"; its FAQ says it never does. Zero retention is Enterprise only; the EU endpoint keeps no request or response content.                                                                                                                       |
| Through AI Gateway    | `gateway.tools.exaSearch()`, $7 per 1,000                                                                                                                                                                                                                                                                                    | `gateway.tools.parallelSearch()`, $5 per 1,000, older beta modes                                                                                                                                                                                                                                          |
| State of the terms    | The public ToS PDF looks unfinished: an unfilled `[LINK]`, a bracketed section, a "Last Revised" date that isn't shown, and "recurring subscription" fees the pricing page denies                                                                                                                                            | Complete Customer Terms and AUP, though neither page shows an effective date                                                                                                                                                                                                                              |

**Gateway doesn't fit the scan.** Both Gateway tools run only when a model calls them ("When the
model needs current information, it calls the tool"), so the model writes the query and each
search also costs a model call. The scan builds its query in code, so it calls the provider's API
directly. That answers the spec's "the search provider's key (unless it runs through Gateway)":
it needs a key.

**What Nexui keeps from the provider is small.** The scan takes only each hit's URL. Title,
location, pay and dates come from the board's own API (section 2). Storing the URL in the
plan's `seen` keys and in the role it creates is per user, which fits Parallel's §2(b). A shared,
cross-user role cache would not.

### 3.2 Cost

One scan a day for 1,000 active searches is 30,000 searches a month. Asks add up to 3 searches
each.

| Provider and mode   | 10 results | 20 results | 25 results |
| ------------------- | ---------- | ---------- | ---------- |
| Parallel `fast`     | **$30/mo** | $330/mo    | –          |
| Parallel `advanced` | $150/mo    | $450/mo    | –          |
| Exa `instant`       | $120/mo    | $420/mo    | $570/mo    |
| Exa `fast`          | $210/mo    | $510/mo    | $660/mo    |

The spec budgets $0.03–0.08 a scan. Any row fits, but 10 results is the right start: the scan
confirms at most 25 candidates, and the plan's named-company boards fill part of that.

### 3.3 What only a live test can answer

- How many hits from a board-domain, last-7-days search are live postings. Job pages often carry
  no publish date, and neither provider says how undated pages are filtered.
- Whether `fast` mode returns enough board pages for a narrow query ("staff product manager
  fintech London").

Ten searches with a Parallel key would answer both for about $0.01. That can open PR 2's search
connector work instead of blocking the plan.

### 3.4 What changes in the spec

1. **Section 10, new env vars:** `PARALLEL_API_KEY` (or `EXA_API_KEY`), read through the
   injectable `env`.
2. **Section 5.5, `web.search`:** a direct provider call with the six board hosts
   (`boards.greenhouse.io`, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`,
   `jobs.lever.co`, `jobs.eu.lever.co`, `jobs.ashbyhq.com`) and `after_date` = today minus 7
   days; mode `fast`, 10 results.
3. **Privacy and storage:** search output stays in the plan that asked for it. No shared role
   cache across users. Queries hold criteria only, never resume text.
4. **Disclosure:** the AUP's AI disclosure is already met if the job search plan says its
   matches are AI-selected; the PR 3 copy should say so.

## 4. Jev: 25 `boolean` questions in one call

One `experimental_evaluate` call to `typesafe-ai/jev` answers 25 yes/no questions in 0.33–0.63
s, ranks a fictional seeker's 25 fictional roles almost perfectly, and costs $0.00023. The
one trap: when each question points into a large `state` by index, Jev silently stops seeing the
candidates past roughly 31 KB.

The test set: one fictional seeker (a senior payments PM in London wanting a Staff, Principal or
Group PM role in fintech, hybrid or remote, from £110k, with three pass reasons) and 25 fictional
roles. Before any call, each was labelled fit (8), partial (8) or no (9). "Pairwise order" is the
share of label pairs Jev put in the right order. Calls ran with `maxRetries: 0`; none failed.

| Call | Layout                                           | Questions | `state` | Time   | Input tokens | Cost     | Pairwise order | Fits at 0.85+       |
| ---- | ------------------------------------------------ | --------- | ------- | ------ | ------------ | -------- | -------------- | ------------------- |
| 1    | Roles in `state`, questions name `candidates[i]` | 25        | 5.8 KB  | 633 ms | 5,495        | $0.00023 | 0.971          | 3 of 8              |
| 2    | Each role inside its own question                | 25        | 1.0 KB  | 381 ms | 5,572        | $0.00023 | 0.969          | 6 of 8              |
| 3    | Same as 2, repeated                              | 25        | 1.0 KB  | 334 ms | 5,572        | $0.00023 | 0.969          | 6 of 8              |
| 4    | As 1, ×4 roles with 1.2 KB more text each        | 100       | 141 KB  | 574 ms | 39,573       | $0.0017  | **0.662**      | –                   |
| 5    | As 2, the same 100 long roles                    | 100       | 1.0 KB  | 482 ms | 39,875       | $0.0017  | 0.956          | 7 of 8 (every copy) |

- **Speed and cost:** questions run in parallel, as TypeSafe's docs say ("adding Nouls barely
  changes the response time"). 100 questions took under 0.6 s. The scan's Jev step costs about
  $0.0002, a rounding error against the spec's $0.03–0.08 a scan.
- **Stable:** calls 2 and 3 differed by at most 0.03 on any role.
- **Where it breaks:** in call 4, `candidates[0]` to about `[21]` kept call 1's ranking
  (pairwise order 0.97), though single values moved by up to 0.23 and no fit reached 0.85. From
  about index 22 on, every role drifted to 0.2–0.55 whatever its label.
  With roles of about 1.4 KB, the cutoff is about 31 KB of `state`. The call returned no warning.
  In call 5 the same 100 long roles, each inside its own question, kept full signal: the four
  copies of each role agreed within 0.06.
- **The answers make sense:** in calls 2 and 3, fits averaged 0.84, partials 0.29 and no-fits
  0.08. Across the inline calls (2, 3 and 5), the pass reasons worked: the crypto exchange scored
  0.06–0.08, and the five-days-in-office role 0.04–0.06. The role below the salary floor scored
  0.08–0.11. The current employer scored 0.21–0.29; the spec's Dedupe step already removes it
  before scoring.
- **Calibration against the spec's bands:** 0.85 caught 6 or 7 of the 8 fits. Seven of the 8
  partials scored 0.08–0.57, so they're dropped. The 0.6–0.85 band held the weaker fits (a Group
  PM role at 0.65–0.75) and the eighth partial, a Director role (0.63–0.69). Ranking is the
  reliable signal; the bands need Part C of the eval to tune.
- Probabilities come rounded to 2 decimals, so ties happen.

### 4.1 What changes in the spec

1. **Section 5.4, Score:** each question carries its candidate (title, company, location, work
   mode, pay, a one- or two-sentence summary). `state` holds only the profile, criteria and
   recent pass reasons. Never point questions into a list in `state`.
2. **Budget:** a 10 s abort and `maxRetries: 1` for the scan, which runs in the background. The
   5 s perception budget would also do.
3. **Thresholds:** keep 0.85 and 0.6 for the first eval run. Sort by probability, break ties by
   posted date, and tune the bands in Part C.
4. **Mock fixtures:** a recorded Jev answer must hold one probability per candidate question id.

## 5. PDF read through Gateway

One fast-tier call reads a resume PDF sent as a file part, with structured output, as section 4
describes. It took 4.5–6.9 s for one page and 11 s for two, cost $0.0003–0.0017 per read, and
returned exact profiles, including from a two-column layout and an image-only scan. Bad files
fail in about a second.

Setup: `generateText` with `Output.object`, a file part (`application/pdf`) and
`anthropic/claude-haiku-5.5`. No fallback models were passed, and `maxRetries` was 0. Every
successful call was answered by Haiku 5.5 through the `anthropic` provider on the first attempt.
The schema asked for `readable`, `isResume`, `text` (at most 20,000 characters) and `profile`.

| File                                        | Time      | Tokens in / out | Cost     | Result                                                                                                                                                            |
| ------------------------------------------- | --------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One column, 1 page (1,200 chars)            | 6,580 ms  | 3,123 / 1,077   | $0.00085 | Exact profile (employer, 8 years, 9 skills, past roles). The text lost its line breaks                                                                            |
| Two columns, 1 page                         | 6,690 ms  | 3,128 / 1,101   | $0.00086 | Each column whole, the main one first; exact profile                                                                                                              |
| Clean scan, image only (176 KB)             | 4,465 ms  | 2,647 / 763     | $0.00065 | Read in full from the image, line breaks kept                                                                                                                     |
| Blurred scan, illegible                     | 2,073 ms  | 2,648 / 229     | $0.00038 | `readable: false`, empty text, no profile; nothing invented                                                                                                       |
| Truncated file (1.5 KB)                     | 1,363 ms  | –               | –        | HTTP 400 "The PDF specified was not valid.", raised as `GatewayInternalServerError`                                                                               |
| Password-protected                          | 1,089 ms  | –               | –        | HTTP 400 "The PDF specified is password protected.", same error class                                                                                             |
| A café menu, not a resume                   | 1,268 ms  | 2,793 / 26      | $0.00029 | `readable: false`, `isResume: false`                                                                                                                              |
| One column plus a hidden white instruction  | 6,784 ms  | 3,087 / 1,109   | $0.00086 | Ignored it ("Chief Executive Officer, 25 years" appears nowhere). The real title and employer came back; `years` was null, since this version has no summary line |
| Two pages (3,842 chars)                     | 11,030 ms | 5,633 / 2,226   | $0.00168 | 3,841 characters of text; exact profile (employer, 10 years)                                                                                                      |
| One column, prompt asks to keep line breaks | 6,922 ms  | 3,147 / 1,128   | $0.00088 | 21 line breaks                                                                                                                                                    |

- **Latency follows the text echoed back.** Between the one-page and two-page reads, each extra
  output token added about 3.9 ms (6.6 s for 1,077 tokens, 11.0 s for 2,226). Each extra
  character of resume added about 0.44 output tokens; whole reads ran 0.58–0.94 tokens per
  character, counting the profile. One- and two-page resumes fit the spec's "10–20 seconds". A
  resume at the 20,000-character cap would need roughly 9,000–12,000 output tokens: an estimated
  40–50 s, and more than some default output limits allow. No long resume was tested.
- **Cost** is below the spec's ~$0.005 estimate.
- **A scanned resume is readable.** The model reads the page image, so only a blank, illegible or
  non-resume file ends in "Couldn't read that PDF".
- **Gateway names a 400 `GatewayInternalServerError`.** Code that sorts errors by class would
  treat a bad upload as an outage.

### 5.1 What changes in the spec

1. **Section 4, the read's output:** `{ readable, text, profile }`. `readable: false` (blank,
   illegible or not a resume) and any 400 from Gateway both end in "Couldn't read that PDF. Try
   another file." Decide by `statusCode`, never by the error's class name, and don't retry a 400.
2. **Section 4, before the call:** refuse a file in code without the `%PDF-` header or over 4 MB,
   saving a call.
3. **Section 4, the prompt:** ask for line breaks (one per heading, role, date line and bullet),
   and for a two-column layout, each column whole with the main column first.
4. **Section 4, timing:** keep "Reading your resume…". Set `maxOutputTokens` explicitly (about
   16,000) so a long resume isn't cut off mid-JSON, give the call a 60 s timeout, and give the
   `start` and `resume` routes a `maxDuration` of 90 s. If 40–50 s is too slow for long resumes, the
   plan can ask the model for the profile only (about 250 output tokens, a few seconds) and take
   the text from the PDF's text layer in code, keeping the model's text for scans. Test a
   three-page resume in PR 2 either way.
5. **Section 9, eval Part B:** `interview-prep`'s "Scanned image (unreadable)" becomes a blurred,
   illegible scan, since a clean scan reads fine. A clean scan could be a passing case.
6. **Fallbacks:** the fast tier falls back to `anthropic/claude-sonnet-5` by default. That is
   acceptable for the read if `response.modelId` lands in the run's usage, as `RunUsage.model`
   already does for runs.

## 6. Decisions for you

| Decision                    | Options                                           | Recommendation                                                                                       |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Search provider             | Parallel or Exa                                   | Parallel, after its written answer on the employment clause; Exa if the clause applies               |
| Live search test            | Plan without one, or 10 searches with a key       | Plan now; run the 10 searches when the key exists, at the start of PR 2's search work                |
| Greenhouse careers-site gap | Accept for the beta, or seed known company boards | Accept for the beta: named companies are read directly, and a seed list can follow from eval results |

## 7. Sources

Opened on 2026-10-10.

Boards:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever postings API](https://github.com/lever/postings-api)
- [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)

Exa:

- [Terms of Service (PDF)](https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf)
- [Privacy policy](https://exa.ai/privacy-policy)
- [Pricing](https://exa.ai/docs/reference/pricing.md) and [pricing page](https://exa.ai/pricing)
- [Search API reference](https://exa.ai/docs/reference/search.md)
- [Rate limits and billing](https://exa.ai/docs/admin/billing.md)
- [Zero data retention](https://exa.ai/docs/admin/security/zero-data-retention.md)
- [AI Gateway integration](https://exa.ai/docs/integrations/vercel/ai-gateway.md)

Parallel:

- [Customer Terms](https://parallel.ai/customer-terms)
- [Acceptable use policy](https://parallel.ai/acceptable-use-policy)
- [Privacy policy](https://parallel.ai/privacy-policy)
- [Pricing](https://docs.parallel.ai/getting-started/pricing.md) and [pricing page](https://parallel.ai/pricing)
- [Search API reference](https://docs.parallel.ai/api-reference/search/search)
- [Source policy](https://docs.parallel.ai/search/source-policy.md)
- [Advanced search settings](https://docs.parallel.ai/search/advanced-search-settings.md)
- [Rate limits](https://docs.parallel.ai/getting-started/rate-limits.md)
- [FAQ](https://docs.parallel.ai/resources/faqs.md)
- [Vercel integration](https://docs.parallel.ai/integrations/vercel.md)

Vercel and TypeSafe:

- [AI Gateway web search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search)
- [AI product terms](https://vercel.com/legal/ai-product-terms)
- [TypeSafe API](https://docs.typesafe.ai/api.md)
- [TypeSafe Noul questions](https://docs.typesafe.ai/primitives/noul.md)
