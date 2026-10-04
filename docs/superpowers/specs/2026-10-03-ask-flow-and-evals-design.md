# Ask flow and travel evals: slice 1, steps 7 and 8

**Status:** approved in conversation on 2026-10-03; awaiting review of this written spec.
**Adds to:** `2026-09-27-intent-graph-design.md`, section H, steps 7 and 8. Its "Done when" still
applies; this addendum settles what those steps left open and folds in four run-reliability
fixes found while reviewing plan 3.

## 0. Decisions made while brainstorming

| Topic                | Decision                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Eval gate            | `pnpm eval:travel` is a **manual gate**: run live, judged by a person. It is not part of `pnpm test` or CI.                                                              |
| Eval review          | A terminal summary per prompt, plus the real plans left in the QA account to open in Expo. Eval plans are tagged in `intents.context.eval`; `--clean` deletes them.      |
| Eval scope           | Each case runs its goal and, if days are free, the insight's ask. The proposed decision is left open for the reviewer to pick.                                           |
| Coordinates          | Checked against a per-case expected region: countries and a rough bounding box.                                                                                          |
| Unpicked candidates  | Resolving or dismissing a decision deletes the candidate places nobody chose, in the same changeset. The decision and options stay as a record; Undo restores all.       |
| Chosen place's days  | The free days when there are any; otherwise the model's suggested days for that option; otherwise 1.                                                                     |
| New leg              | An option may carry a leg hint (mode, hours, cost) from the last stop when proposed. It is used only if that stop is still last.                                         |
| After an in-plan ask | The + sheet offers "See the choice" when the run proposed a decision, otherwise "Back to plan". "See changes" stays secondary.                                           |
| Mock fixture         | `japan-ask-free-days`, recorded live from the insight's default prompt, replaces `japan-ask-rural`.                                                                      |
| Cancel race          | A cancelled running run goes through `stopping` until its last step commits, and no new run starts meanwhile.                                                            |
| Packaging            | One plan and one PR: run hardening, ask-flow API, mobile, fixture, eval, smoke test, in that order.                                                                      |
| Parked               | Mobile polish for a later pass: the `useIntentLive` catch-up guard and double catch-up, Undo toast for only the last rapid edit, Undo not queued behind edits in flight. |

## 1. Run hardening

**Refused tool inputs reach run progress.** When the model's input fails a tool's
`inputSchema`, the AI SDK produces a `tool-error` part without calling `execute`, so the stager
records nothing. `runModel` collects `tool-error` parts with no staged entry (matched by
`toolCallId`) into `StepReport.refused: { capability, message }[]`, and `commitStep` records
them as refused progress entries (`ok: false`, `error`). The model's correction loop is
unchanged.

**A failed forced step that answers in text is invalid.** In `runModel`, a
`ToolChoiceViolationError` after a step with errors (`invalidStreak > 0`) returns `invalid`, and
the run fails with `INVALID_RUN_ERROR`. A first forced step that answers in text still returns
`finished`: the model found nothing to change.

**`stopping` closes the cancel race.** One migration:

- `runs.status` gains `stopping`; `runStatusSchema` matches.
- `cancel_run` moves `queued` straight to `cancelled`, and `running` or `awaiting_approval` to
  `stopping`.
- `create_run` refuses while a run is `queued`, `running` or `stopping` within the existing
  6-minute window, so a stale `stopping` run stops blocking as a stale `running` one does.
- `finish_run` accepts `stopping → cancelled`, and `stopping → failed` when the last step
  errors.

`executeRun` treats any `recordRunStep` status other than `running` as a stop, and a `stopped`
outcome finishes the run `cancelled` after that step's commit. Spec section F's "a cancel stops
the run after its current step" still holds. The API reports a stale `stopping` run as failed,
like a stale `running` one.

**No trip without a run.** If `createRun` throws in `startIntent`, the seeded intent is deleted
before the error is rethrown.

**`DATA_HELP` states the limits.** Place `days` is "whole days, 0 to 365", and leg `estHours` is
"0 to 200". A test checks the help text against the schema limits.

## 2. Ask-flow API

**`decision.propose`.** Each option's `place` takes `placeDataSchema` with `days` optional, as the
model's suggestion ("Days you'd suggest here if the trip has none free"). An option may also
carry `leg: legDataSchema`, for getting there from the current last stop. `optionDataSchema`
gains:

- `suggestedDays?`: a whole number from 1 to 365.
- `leg?: { mode, estHours?, estCost?, fromPlaceId }`, where `fromPlaceId` is the trip's last
  place when proposed. Without a last place, the hint is dropped.

The candidate place is still created with `days: 0` and no `part_of` link.

**`decision.resolve`**, as one changeset:

1. Set the decision `resolved` (with `chosenOptionId`) or `dismissed`, as today.
2. On a pick, add the chosen place to the route with:
   - `days`: the free days if more than 0, else `suggestedDays`, else 1;
   - a leg from the last stop that uses the hint's `mode`, `estHours` and `estCost` when
     `fromPlaceId` is still the last stop, and `{ mode: 'other' }` otherwise.
3. Delete each candidate place of this decision's other options (all options on a dismiss) that
   still exists and is not `part_of` the trip. A candidate the user put on the route by hand
   stays.
4. Remove the decision's workspace section, as today.

Undo reverts the whole changeset. A settled option's `placeId` may then point to a deleted
place; nothing renders a settled decision's options.

**Mock fixture.** After these schema changes, `japan-ask-free-days` is recorded live with
`scripts/record-fixture.mjs` on the `japan-december` graph after `try-run.mjs free-day`. It
matches `['days i have free']` (the insight's prompt is "How should I use the N days I have
free?") and replaces `japan-ask-rural` in `FIXTURES`.

## 3. Mobile

**"You asked …".** The decision card reads `decision.source?.runId` through `useRun` and shows
_You asked "…"_ above the question, from `run.input.text` and cut to two lines. It shows nothing
while the run loads, if it fails to load, or for a derived decision with no source run.

**The + sheet after an in-plan ask.** When the sheet was opened from a workspace and the run
has succeeded:

- If `run.progress` has an `ok` `decision.propose` entry, the primary button is **See the
  choice**. It sets a focus flag for the intent in a small Zustand UI store and dismisses the
  sheet. On focus, the workspace sees the flag, scrolls to the top where decisions are pinned,
  and clears it.
- Otherwise the primary button is **Back to plan**, which dismisses the sheet.

The RunCard's "See changes" stays as a secondary link. Failed, invalid and cancelled runs keep
Retry, and a new plan keeps "Open plan", as today. The RunCard shows **Stopping…**, with no Stop
button, for a `stopping` run.

**One Realtime channel per intent.** The workspace stays mounted under the modal sheet with its
own subscription, so the sheet calls `useIntentLive(params.intentId ? null : target)` and
subscribes only for a plan it created.

## 4. `pnpm eval:travel`

**Files.** `scripts/eval-travel.mjs` is the runner; `scripts/eval-travel-cases.mjs` holds the
cases as data. `call`, `waitForRun`, `printPlan` and QA sign-in move into
`scripts/lib/qa-api.mjs`, shared with `try-run.mjs` and `qa-session.mjs`. The root script is
`"eval:travel": "node scripts/eval-travel.mjs"`, with `--case <name>` to run one case and
`--clean`. Checks import `parseKindData`, `tripFigures`, `tripParts` and `LENGTH_KEY` from the
TypeScript sources, using Node's type stripping as the tests do. The API must be running; live
mode is the point, but mock mode exercises the script itself on the cases with fixtures.

**Each case, one at a time:**

1. `POST /api/intents` with the goal, then wait for the run.
2. Tag the intent: `context.eval = { suite: 'travel', case, at }`, written with the admin client
   the QA scripts already use.
3. Run the goal checks.
4. If unallocated days are above 0, send the unallocated insight's own `prompt` to the ask
   route, wait, and run the ask checks. Leave the decision open.

**Goal checks:**

- The run `succeeded`. Refused tool calls are counted, not failed.
- Every object passes `parseKindData`.
- At least `minStops` places, with a leg between each consecutive pair.
- Each place's `country` is in the case's `countries`, and its coordinates fall in the case's
  `box` if it has one. With `oneCountry`, every place shares a country.
- Days: if the case states a length, the trip's total days are in its range and unallocated
  days are 0 or more. If it expects a length question, the `LENGTH_KEY` decision is open.
  Otherwise, either holds.

**Ask checks:** the run `succeeded`; one new open decision exists, with 2 to 4 options; each
option's place passes the region check; and the decision's section is in the workspace.

**Output.** Per case: the name and intent id; each check with ✓ or ✗; the stops
(`Tokyo 4d → Hakone 1d → Kyoto 4d …`); legs (`Tokyo → Hakone train 1.5h`); open decisions with
their options; and tokens used. It ends with `N/8 passed automatic checks — open them in Expo
(QA account)` and exits 1 if any check failed. `--clean` deletes the QA user's intents that
have `context.eval` (their graph cascades) and prints the count.

**Cases** (section H's eight prompts):

| Case            | Goal                                                 | Region                                                 | Days                 |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------ | -------------------- |
| japan-december  | Two weeks in Japan in December                       | JP, Japan box                                          | 14                   |
| chicago-weekend | A weekend in Chicago                                 | US, Chicago-area box                                   | 2 to 3               |
| portugal-road   | A 10-day road trip around Portugal                   | PT, mainland Portugal box                              | 10                   |
| sea-backpacker  | Three weeks in Southeast Asia on a backpacker budget | TH, VN, KH, LA, MY, SG, ID, PH, MM; Southeast Asia box | 21                   |
| beach-warm      | A beach week somewhere warm                          | One country; latitude between 35°S and 35°N            | 7                    |
| berlin-business | A business trip to Berlin plus two free days         | DE, PL, CZ, AT, DK, NL; central Europe box             | either rule          |
| disney-family   | A family Disney trip                                 | US, FR, JP, CN, HK; one country                        | length question open |
| iceland-ring    | Driving Iceland's ring road in 10 days               | IS, Iceland box                                        | 10                   |

`minStops` is 1 for Chicago and Disney and 2 for the rest. The exact boxes are set in the cases
file, loose enough to include islands and border towns.

## 5. Build order and checks

1. **Run hardening** (section 1), with the migration pushed via `pnpm db:push`.
2. **Ask-flow API** (section 2) with capability tests, then a propose → resolve → undo pass in
   `scripts/smoke-intent-graph.mjs`.
3. **Mobile** (section 3).
4. **Fixture:** record `japan-ask-free-days` live and retire `japan-ask-rural`.
5. **Eval:** `pnpm eval:travel`; the reviewer runs it live and judges the plans in Expo.
6. **Smoke test** in Expo web as the QA user, first in mock mode and then live:
   - tap the insight's "Ask Nexui for ideas" and send the prefilled prompt;
   - watch the run, tap "See the choice" and check the "You asked" line;
   - pick an option: the route, day bar and map update and the unallocated insight goes away;
   - Undo, and check that the candidates come back.

Each step keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` passing. The API, mobile and
security reviewers and the docs keeper run before handoff. The docs keeper adds
`pnpm eval:travel` to `AGENTS.md` and documents the ask flow, `stopping` and candidate cleanup
in `docs/architecture/`.

**Tests**, at the capability and changeset boundary:

- a pick with free days uses them, and unallocated days reach 0;
- a pick with no free days, or negative free days, uses the suggestion, then 1;
- the leg hint applies only while `fromPlaceId` is still last;
- unpicked candidates are deleted, while hand-added ones and the chosen place stay;
- a dismiss deletes every candidate;
- undo restores everything.

**Run tests:**

- `runModel` records a schema-invalid call in `refused`;
- a failed forced step followed by text returns `invalid`;
- `executeRun` finishes a run `cancelled` after committing its step when `recordRunStep`
  returns `stopping`.

Device checks of the iOS keyboard fix (PR #11) and plan 3's map and theme are separate and wait
for the next preview build.
