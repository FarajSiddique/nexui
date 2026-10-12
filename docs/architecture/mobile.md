# Mobile

The Expo app renders the intent graph (see
[`docs/architecture/intent-graph.md`](./intent-graph.md)) as a workspace, keeps edits feeling
instant, and stays current while a run or another device changes the same intent. This doc
covers the pieces that make that work: the workspace route, the pure layout layer, optimistic
edits, and Realtime.

## Where code lives

`apps/mobile/src/` is split by what the code is for:

- **`app/`**: Expo Router routes only. Every file here becomes a route, so components and helpers
  live in the folders below.
- **`features/<area>/`**: what one area of the app needs: `auth`, `home`, `workspace`, `changes`,
  `compose` (the + sheet), `account`, and `shell` (the tab bar), plus one folder per template and
  the registry that joins them. A Zustand store lives in the feature that owns it, as
  `use-<name>-store.ts`.
  - `workspace`: what draws any template: the generic primitives in `sections/`, the
    `WorkspaceAction` type, the layout and `DetailProps`.
  - `travel`: the trip's primitives in `sections/` (route, map, allocation), stop details, the
    place body and sheet, the day stepper, `trip-actions.ts` and the travel formatters.
  - `jobs`: the pipeline and timeline primitives in `sections/`, and the role, draft and search
    bodies with their pure helpers.
  - `registry`: `SECTION_REGISTRY` and `DETAIL_REGISTRY`, which pick a template's primitive or
    details body. Only routes import it.
- **`ui/`**: shared building blocks such as `Button` (its `ink` variant is a screen's main
  action, like Sign out), `PlacePhoto` (a place's photo on `expo-image`), `Pill`, the list states
  including `RefetchNotice`, `FormError` and `FormNotice`, and the tab header.
- **`theme/`**: the palettes and fonts (the `photoScrim` and `photoInk` tokens, the same in both
  themes, are for text and buttons drawn on a photo), `useColors`/`createThemedStyles`, and the appearance
  choice.
- **`data/`**: the API and Supabase clients, the TanStack Query hooks and keys (`queries.ts`, with
  `usePlaceMedia`, `usePlacePhotos` and the `PhotoState` type), Realtime (`use-intent-live.ts`),
  and the PDF picker and upload (`pick-pdf.ts` on `expo-document-picker`, and `upload-form.ts`).
- **`lib/`**: pure helpers that several features share (`format.ts`, and `ai-mark.ts`'s
  `aiMarkFor`).

Outside `src/`, `apps/mobile/assets/images/` holds the app icon and favicon that `app.config.ts`
points to. They're exported from the SVG sources in
[`docs/design/app-icons/`](../design/app-icons/README.md).

Imports run one way. Routes import from anywhere. Features import `ui`, `theme`, `data` and `lib`,
and another feature only where a screen needs that area's piece (the + tab button reads
`workspace`'s focused-intent store). `ui` imports only `theme`; `data`, `theme` and `lib` import
none of the others.

The template folders keep apart from the generic workspace and from each other:

- `features/workspace` imports no template folder and not `features/registry`.
- `features/travel` and `features/jobs` import `features/workspace`, never each other or
  `features/registry`.
- Only routes import `features/registry`, which imports them all.

A new template adds its folder, its zone in `eslint.config.js` and a line per primitive or body
in the registry; nothing in `features/workspace` names it.

### Barrels

`data`, `lib`, `theme`, `ui` and each `features/<area>` have an `index.ts` barrel that
re-exports, by name, what other folders may use. Import another folder only through its barrel:

```ts
import { useIntents } from '#data';
import { useSessionStore } from '#features/auth';
import { Button } from '#ui';
```

- `#data`, `#lib`, `#theme`, `#ui` and `#features/*` are Node subpath imports in
  `apps/mobile/package.json`, so Metro, `tsc` and the Node test runner all resolve them. There is
  no `@/` alias.
- Inside a folder, import files as `./name`, never the folder's own barrel. A feature's subfolder
  (`workspace/sections/`) reaches its feature with `../name`.
- A barrel holds only `export { … } from './file'` and `export type { … } from './file'` lines.
  Leave the extension off so Metro still picks platform files such as `map-section.web.tsx`;
  `lib/index.ts` is the exception (see the pure display layer below). When another folder needs
  a new name, add it to the barrel; a new feature needs its `index.ts` before
  `#features/<area>` resolves. A new top-level `src/` folder also needs an entry under
  `imports` in `package.json` and an `onlyImports` zone in `eslint.config.js`.
- Import groups go in this order: packages, `@nexui/*`, `#…` barrels, then relative paths, with
  a blank line between groups.

`pnpm lint` enforces all of this in `apps/mobile/eslint.config.js`:

- `import/no-restricted-paths` holds the folder directions above, with one zone per folder and
  three for `features/workspace`, `features/travel` and `features/jobs`.
  `eslint-import-resolver-typescript` follows the `#` imports, so a barrel import is checked like
  a relative one. `tests/mobile-import-direction.test.mjs` lints probe files with the app's
  config, so the template zones are tested as `pnpm lint` enforces them.
- `no-restricted-imports` bans `../` out of a folder, `@/`, `#<folder>/<file>` and a folder's
  own barrel.
- `no-restricted-syntax` keeps barrels to re-exports.
- `import/order` sets the groups.
- `import/no-cycle` keeps the graph acyclic, since a barrel makes a cycle easy to close and Metro
  warns about require cycles at runtime.

Beyond the three template zones, lint doesn't police imports between features; keep those to
what a screen needs.

## The Home stack and the workspace route

`apps/mobile/src/app/(app)/(tabs)/(home)/` is its own `Stack`
(`_layout.tsx`): `index.tsx` is Home (every plan as a card, then the latest three changes), and
`intent/[id].tsx` is the workspace for one intent, pushed over Home under the tab bar rather than
replacing it. Its back link (`‹ Plans`) calls `router.back()` when there's history, else
`router.replace('/')`. `GestureHandlerRootView` wraps the root layout
(`apps/mobile/src/app/_layout.tsx`) for the swipe below. A Home card ends with the summary's
strip: a trip's stops as a mini route, or a job search's companies as chips when
`summary.stripStyle` is `chips`.

The workspace screen loads the intent's `GraphSnapshot` (`useIntent`), lays it out with
`layoutWorkspace`, and draws each block with `SectionView`. Under the goal it shows the plan's
meta line, `anchorMeta(snapshot)` from `@nexui/types` (`KIND_META`, keyed by anchor kind: a
trip's dates, travelers and pace; a search's roles, places and pay floor); when the anchor's
kind has a details body (`hasDetail`), the line ends in › and opens it. The screen shows a
full-page skeleton or error while nothing has loaded yet, a "Drafting" pill while a run is
working (from `useIntents`' list, since a single intent's own query doesn't carry that), and
turns whatever a primitive reports (a `WorkspaceAction`) into one of:

- `capability`: a call through `useWorkspaceEdit`, with the ops the primitive built to show it
  at once (see "Optimistic edits"), then an Undo toast;
- `open`: a push to `/object` for that object (see "The object sheet");
- `ask`: a push to `+`, with the prompt filled in;
- `upload`: the system's file picker for one PDF (`choosePdf`, `data/pick-pdf.ts`), sent where
  `intakeRoute` (`@nexui/types`) says: `start` before the plan's first run, `resume` after;
- `start`: `start` with no file;
- `copy`: the text on the clipboard (`expo-clipboard`), then "Copied.";
- `link`: `Linking.openURL`, only for an https page or a `mailto:` message, as the URL it parses
  to (`openableUrl`, `lib/links.ts`); a link it refuses, or one the system can't open, shows
  "Couldn't open that link.".

### Deleting a plan

Swiping a plan card left on Home reveals a red Delete button
(`apps/mobile/src/features/home/swipe-to-delete.tsx`, RNGH `ReanimatedSwipeable`). Tapping it
deletes the plan for good, with no undo. One row is open at a time: opening one closes the other,
and scrolling closes it. A Drafting plan can't be swiped, and a row that becomes Drafting while open
closes. The card offers a VoiceOver/TalkBack "Delete" accessibility action; the swipe button
itself is `aria-hidden` and out of tab order. Web has no keyboard or screen-reader path to delete.

`useDeleteIntent` (`queries.ts`) calls `DELETE /api/intents/[id]`; a 404 counts as deleted. On
success it removes the card from the intents cache and the intent query, then refetches intents
and changes. `usePlanDeletes` reads every delete in the mutation cache through the pure
`planDeletes` (`apps/mobile/src/data/plan-deletes.ts`); only each plan's latest attempt counts.
Home hides cards whose delete is pending. Failed ones show "Couldn't delete that plan. Tap to try
again." (or "N plans"), and tapping retries them all.

On web, React Native Web fires `onPress` from the DOM click, which also ends a mouse swipe, and
the swipeable's `pointerEvents: 'box-only'` guard for an open row doesn't apply. A capture-phase
listener in `swipe-to-delete.tsx` stops the click after a drag and turns a click on an open row
into a close.

## The pure display layer

These files under `apps/mobile/src/` have no `react-native` or `expo-*` import, so
`tests/mobile-*.test.mjs` can run them under plain Node with no RN runtime:

- `lib/format.ts`, `lib/ai-mark.ts` and `lib/links.ts`;
- `workspace-layout.ts` and `workspace-actions.ts` in `features/workspace/`;
- `stop-details.ts`, `trip-actions.ts`, `travel-format.ts` and `sections/map-region.ts` in
  `features/travel/`;
- `job-parts.ts`, `job-format.ts`, `role-actions.ts`, `pipeline.ts`, `timeline.ts`,
  `role-details.ts`, `draft-details.ts` and `search-details.ts` in `features/jobs/`;
- `features/changes/change-feed.ts`, `features/home/photo-band.ts` and
  `features/compose/compose-reply.ts`;
- `plan-deletes.ts`, `api-request.ts`, `intent-channel.ts`, `place-media.ts` and `upload-form.ts`
  in `data/`.

They import siblings by relative `.ts` paths. The only barrel they may import is `#lib`, whose
`index.ts` also uses `.ts` paths so Node can load it. Any other barrel, such as `#data`, pulls in
React Native and breaks the tests. An `import type` from another barrel is fine, since Node strips
it: the action builders take `CapabilityAction` from `#features/workspace` that way.

- **`format.ts`**: numbers, money, dates, times and relative times as display strings
  (`formatDate`, `formatDateTime` and `formatTime` take an optional time zone); `formatField`
  reads a field in its `FieldFormat`; `cardText` reads an object's title/subtitle from
  `KIND_CARDS`; `capitalize` and `ordinalWord`.
- **`ai-mark.ts`**: `aiMarkFor`, the one place that decides what's marked as Nexui's work.
- **`links.ts`**: `openableUrl`, the URL a `link` action may open (https and `mailto:` only).
- **`workspace-layout.ts`**: `layoutWorkspace` and `sectionData`, which turn a `WorkspaceDoc` and a
  `GraphSnapshot` into `WorkspaceBlock[]` — each section's data, evaluated with `evaluateQuery`
  from `@nexui/types`, and the Open band placement. `metric` and `allocation` read the anchor's
  figures by derived key (`anchorFigures` and `figureValue`, from `KIND_FIGURES`), recomputed from
  the snapshot so an optimistic edit moves them at once.
- **`workspace-actions.ts`**: the `WorkspaceAction` type and two builders: `resolveAction`, a
  decision's Choose or Keep the day free as `decision.resolve`, and `fromInsightAction`, an
  insight's button.
- **`stop-details.ts`**: `stopDetails(snapshot, placeId)`, what the stop's sheet shows.
- **`trip-actions.ts`**: `daysAction` and `moveAction`, a stop's days (`trip.setPlaceDays`) and
  place on the route (`trip.reorderPlaces`) with the ops that show them at once. The route and the
  stop's sheet share `daysAction`.
- **`travel-format.ts`**: `placeName`, `countryName`, `travelTo`, `legFigures` and `photoCredit`,
  the route's and the place sheet's wording.
- **`job-parts.ts`**: a role's links and interviews (`linkedTo`, `linkedFrom`, `companyName`,
  `interviewsFor`, `nextInterview`, `isUpcoming`).
- **`job-format.ts`**: a role's wording (`roleLine`, `placeLine`, `salaryText`, `outcomeLabel`,
  `workModeLabel`) and `postingLink`, the parsed link a posting opens and its host (null for one
  that isn't https or carries a user name or password).
- **`role-actions.ts`**: `stageAction`, `passAction`, `cardAction` (a pipeline card's button) and
  `renameAction`, each with the ops that show it at once.
- **`pipeline.ts`**: `pipelineGroups`, the pipeline's stages and cards.
- **`timeline.ts`**: `timelineRows`, the timeline's upcoming and past rows.
- **`role-details.ts`**, **`draft-details.ts`** and **`search-details.ts`**: what each sheet
  shows (`roleDetails`, `draftDetails`, `searchDetails`), with the draft's `mailtoUrl` and
  `sentAction`, and the search's criteria edits (`addTo`, `removeFrom`, `toggleWorkMode`,
  `salaryFloorAction`) and `forgetPassAction`.
- **`place-media.ts`**: `mediaPlaceIds`, `mediaKeyIds` and `mediaPollInterval` for
  `usePlaceMedia`, and `placeAbout` and `placePhotos` for what each place shows (`PhotoState`).
- **`photo-band.ts`**: `photoBand`, the photos and "+N" of a Home card's band, counting only
  strip entries with a media key (a trip's stops).
- **`map-region.ts`**: `fitRegion`, the map's camera for a set of points.
- **`change-feed.ts`**: `buildChangeRows`, `filterRows` and `groupByDay` for the Changes feed and
  Home's "What changed" (see "Changes").
- **`compose-reply.ts`**: `replyFor` and `targetOf`, the + sheet's reply to a new goal and the
  plan it acts on next.
- **`upload-form.ts`**: `checkPdf`, which refuses a PDF over `MAX_UPLOAD_BYTES` (4 MB) before
  it's sent, and `appendPdf`, the multipart `file` part (the `File` on web, a `{ uri, name, type }`
  part on a phone).
- **`plan-deletes.ts`**: `planDeletes`, which reduces the plan deletes in the mutation cache to
  the ids to hide (pending) and the failed ones to retry, counting each plan's latest attempt.
- **`api-request.ts`**: `requestJson`, the one function that sends a request, applies a timeout,
  and turns a failure into an `ApiError`.

## Sections

`SECTION_REGISTRY` (`apps/mobile/src/features/registry/section-registry.tsx`) maps every
`Section['type']` to its primitive component: the generic ones from `features/workspace`, each
template's from its own folder. A type with no entry fails typecheck. Every primitive receives
`{ section, data, snapshot, photos, onAction, busy }` (`SectionProps<T>` in
`features/workspace/sections/types.ts`): it renders and reports a `WorkspaceAction` through
`onAction`, and never calls the API itself — the workspace screen (`intent/[id].tsx`) and the
object sheet are the only places a `WorkspaceAction` becomes a request, a push, a file pick, a
copy or a link.

An edit is capability-shaped, `{ type: 'capability', request, optimistic }`: the primitive that
knows the capability builds the whole request and the ops that show it at once, so the screens
never name a template's capability. The other actions are `ask`, `open` (an object id), `link`,
`upload`, `start` and `copy`.

`photos` is each place's `PhotoState` by id, which the workspace screen passes from
`usePlacePhotos`.

An insight's buttons go through `fromInsightAction`: `ask` and `capability` as above, `upload`
picks a PDF for the plan's intake, `start` starts the plan without one (a job search's "Add your
resume to start" card), and `copy` copies its text. A summary badge with the `quiet` tone draws as
the plain pill.

`pipeline` (`features/jobs/sections/pipeline-section.tsx`) draws roles by stage in the doc's
order. The first stage (New) always shows, under the AI disclosure ("Picked by Nexui's AI from
employers' own job boards."); later stages show only with roles in them, and a collapsed stage
(Closed) folds to a count row. A role Nexui found and the user hasn't touched is on the
highlighter inside a dashed outline. A New card shows why the role fits and its gaps, and under it
the doc's `cardActions` for its stage (New's Interested and Pass). Pass opens a one-tap reason
picker inside the card, with "Skip, just pass". Every card opens its role.

`timeline` (`features/jobs/sections/timeline-section.tsx`) lists interviews soonest first, each
with a day block, what it is with the role's company, and its time and who it's with, or the
doc's `empty` line ("No interviews yet"); the past folds to a count. A row opens the role its
interview is `for`. Both job search primitives read "now" from the device clock, for display
only.

A route row is one button per stop (it reports `open` with the place's id), with the ↑↓ and the
day stepper on a line below. `DayStepper` lives in `features/travel/day-stepper.tsx`, shared with
the place sheet.

## The Open band

A section can carry `pin: 'open'`. `layoutWorkspace` lifts a pinned section into one "Open band"
while it's unresolved — a `decision` with `status: 'open'`, or an `insight` whose query still
returns rows — and drops it once resolved. The band sits directly under the doc's first `metric`
section, or at the top if the doc has none.

## The AI marking rule

`aiMarkFor` (`lib/ai-mark.ts`) is the one place that decides what's marked as Nexui's work:
`highlight` is true for an object with `source.type === 'ai'` and no `source.reviewedAt` (a user
edit sets `reviewedAt` on the server, which clears it), and `tentative` is true for any `option`
object.
Every primitive that shows an AI mark calls this function rather than checking `source` itself.

## Optimistic edits

Every `capability` action, from the workspace or the object sheet, goes through
`useWorkspaceEdit(intentId)` as `{ request, optimistic }`. The primitive or body that reports it
builds its own optimistic ops:

- a trip's days and order (`daysAction`, `moveAction` in `features/travel/trip-actions.ts`);
- a role's stage or pass (`stageAction`, `passAction`, `cardAction`) and a rename
  (`renameAction`), in `features/jobs/role-actions.ts`;
- a search's criteria (`addTo`, `removeFrom`, `toggleWorkMode`, `salaryFloorAction`) and a
  forgotten pass (`forgetPassAction`), in `features/jobs/search-details.ts`.

Then:

- Every edit on one intent shares a mutation `scope` (`editKey(intentId)`), so taps run one at a
  time in the order they were made rather than racing.
- Each edit applies its `optimistic` ops to the cached snapshot at once, for display. The ops are
  absolute values (the whole new `data`, or each stop's new position), so a burst of taps ends in
  the state the user saw last. `decision.resolve`, I sent it (`jobs.logContact`) and an insight's
  capability carry no optimistic ops — only the server knows their outcome.
- Only the last edit to finish writes the server's `CommitResponse.snapshot` into the cache (and
  only the last edit to fail refetches); an earlier answer never overwrites a later tap's
  optimistic state.
- `features/travel/use-edit-memory-store.ts`'s `rememberDays` remembers a stop's day count from
  before this session's first edit to it, so the route can show "was 4" next to a changed stepper;
  stepping back to the original value forgets it.
- A successful edit shows an `UndoToast` for its event id; dismissing it or tapping Undo
  (`useUndo`, which also serves Redo on an Undo event) clears it.

## Realtime as an invalidation signal

`useIntentLive(intentId)` (`apps/mobile/src/data/use-intent-live.ts`) keeps an open workspace
current while the server writes to it without the client asking — a run filling it in, or another
device's edit. The database broadcasts a `changed` message on the private topic `intent:<id>` for
each changeset and each run write, and only the intent's owner may join it (see
[`intent-graph.md`](./intent-graph.md)). The hook treats the message as a signal only and
refetches. A burst of messages collapses into one refetch per 300 ms: the run, intents and
changes lists always refetch, but the intent snapshot itself waits (re-arming only its own retry,
not the lists') while the user's own edit is still in flight, so a refetch can't briefly undo an
optimistic change.

`createIntentChannels` (`apps/mobile/src/data/intent-channel.ts`) owns the channels. It takes the
Realtime client (`channel`, `removeChannel`), so it is tested without Supabase. `watch(intentId,
{ onChange, onSubscribed })` returns a release function. There is one private channel per intent,
shared by its watchers, because `supabase.channel` returns the existing channel for a topic and a
private topic can't carry a random suffix. The last release removes the channel; a watch that
arrives while the removal is in flight waits for it and opens a fresh one.

`onSubscribed` runs on every `SUBSCRIBED` — including a rejoin after `CHANNEL_ERROR` or
`TIMED_OUT`, or the socket dropping and reconnecting — and at once for a watcher joining an
already-subscribed channel. The hook runs the same catch-up there (lists plus the intent key),
since Broadcast doesn't replay messages missed while disconnected.

Three polls cover what Realtime and a rejoin don't:

- `useIntents` (Home's cards) polls every 4 s while any intent's summary badge reads `running`,
  since a change to `intents` alone sends no message. When that goes from some plan Drafting to
  none, it invalidates `changes` once more, to catch a run's last change even if it landed just
  before this poll saw the plan settle.
- `useIntent(id, { poll })` polls every 4 s while its workspace screen passes `poll: true` (set
  from `drafting`, the same "any intent's badge is `running`" check), for the one intent on
  screen — Realtime already covers a run's own writes, but this is the fallback for a missed
  event. It skips a tick while a workspace edit (`editKey(id)`) is in flight, so it can't overwrite
  an optimistic change. The workspace screen also invalidates the intent key and `changes` once,
  directly, the moment `drafting` flips from true to false.
- `useRecentChanges` (Home's "What changed") polls on the same 4 s cadence as `useIntents`, reading
  its cached data to decide whether any plan is Drafting, since no channel is open for a run's changes
  when no workspace is open for it.

`useRun` polls every 3 s while its run is active (`queued`, `running` or `stopping`, through
`isRunActive`), as a fallback for a dropped socket, unrelated to the polls above.

The workspace stays mounted under the + sheet with its own watcher, so the sheet calls `useIntentLive(params.intentId ? null : target)`: it subscribes
only for a plan it started itself, not for the plan open underneath.

The Changes tab (`apps/mobile/src/app/(app)/(tabs)/changes.tsx`) doesn't poll — the feed
(`useChangesFeed`) instead refetches whenever the tab regains focus (`useFocusEffect`), which is
enough since visiting the tab is exactly when a stale feed would otherwise show.

## The + sheet

`use-focused-intent-store.ts` holds the intent id of the workspace on screen, if any
(`focusIntent`, set on focus and cleared on blur by the workspace screen's `useFocusEffect`), so
opening `+` acts on that plan instead of starting a new one. `apps/mobile/src/app/(app)/compose.tsx`
reads `intentId`/`prompt` from its route params (set when a section's or a details body's `ask`
action pushes to `+` with a prompt already filled in) and otherwise from nothing, in which case it
starts a new intent. Once a run starts, `RunCard` (`apps/mobile/src/features/compose/run-card.tsx`) streams it: a spinner
and elapsed time while active, one line per succeeded capability call (not per step — a step can
make several calls) as it lands, and Stop, Retry or "See changes" depending on the run's status.
After Stop, a running run shows **Stopping…** ("Nexui is saving the change it was making, then it
stops.") with no Stop button until its last step commits, then Stopped. A run that succeeded also
offers "See changes" as a secondary link. Closing the sheet doesn't stop the run — what it's
written stays and can be undone from Changes.

After an ask about the plan underneath (the sheet was opened with `intentId`), `afterAsk`
(`apps/mobile/src/features/compose/run-outcome.ts`, pure and unit-tested) picks the next step once
the run has succeeded: **See the choice** when its progress has an `ok` `decision.propose` entry,
otherwise **Back to plan**, which dismisses the sheet. A run that failed or stopped gets neither,
only the RunCard's own buttons, and a new plan shows "Open plan". Both buttons sit in the composer
above the input, outside the scroll view, so they stay in view while the keyboard is up.

A new goal gets one of four replies, which `replyFor` (`features/compose/compose-reply.ts`, pure)
maps from the create's outcome; `targetOf` gives the plan the sheet acts on next.

- `started`: the run streams in `RunCard`.
- `unsupported`: `SavedGoalReply` (below).
- `awaiting_resume`: `ResumeStep` (`features/compose/resume-step.tsx`), the plan's intake step.
  Its copy comes from `TEMPLATE_INTAKES` in `@nexui/types`: "Add your resume?", why Nexui asks,
  **Add resume (PDF)** and **Continue without**. Add picks a file (`choosePdf`, refused over
  4 MB before it's sent) and starts the plan with it through `useStartPlan`, which calls
  `POST /api/intents/[id]/start` with a 90 s timeout; Continue without starts it with none. While
  a file is read the step shows "Reading your resume…"; then the build run streams in `RunCard`.
  A file the API couldn't read still starts the plan, and the sheet says so. Closing the sheet at
  this step leaves the plan on Home as Ready to start.
- `existing_search`: `ExistingPlanReply` ("You already have a job search. Add this to it?",
  worded from `TEMPLATE_EXAMPLES`' `one` and `short`). **Open my search** puts the goal back in
  the composer, where sending it asks the plan already going.

On a plan whose template takes a document (`TEMPLATE_INTAKES`), a **PDF** button sits beside the
input once the plan has loaded, except during the resume step, under the second-search reply
(whose plan is the other search), and while anything is in flight. It picks a file and sends it
where `intakeRoute` says: `start` before the plan's first run, or `resume` after, which replaces
the resume as one change and says "Replaced your resume." (no Undo toast here; the Changes tab
can undo it).

A goal Nexui can't plan is saved, and the sheet shows `SavedGoalReply`
(`apps/mobile/src/features/compose/saved-goal-reply.tsx`) instead of a run: what Nexui plans today
(from `TEMPLATE_EXAMPLES` in `@nexui/types`; `GOAL_EXAMPLES` skips a template whose entry is
null, one whose app side hasn't shipped) and a "Try one" button per template that fills the
composer with its example goal. There is no "Open plan", and the next send starts a new plan. The
new-plan placeholder takes turns across the templates' examples (`nextGoalPlaceholder`). A 503
shows its message above the composer and keeps the typed goal.

The sheet is an iOS form sheet (react-native-screens), which constrains two things. The composer
clears the keyboard with `useKeyboardOverlap()`
(`apps/mobile/src/features/compose/use-keyboard-overlap.ts`), which pads by the window height minus
the keyboard's top edge and does not measure the sheet: Fabric's `measureInWindow` reads the shadow
tree, which puts a form sheet at the top of the window wherever iOS draws it, so a measured overlap
comes out short and the composer sits behind the keyboard. Android and web get 0. The sheet's root
`View` is `collapsable={false}` with an empty `<View collapsable={false} />` as its first child;
RNScreens stretches a ScrollView it finds among a form sheet's direct children or down its
first-child chain to fill the sheet, which hides the body behind the composer. Keep both so the
ScrollView stays at the height React lays out.

**See the choice** sets `use-reveal-store.ts` (`revealOpenBand(intentId)`) and dismisses the sheet.
The workspace screen watches the flag through `useRevealOpenBand`
(`apps/mobile/src/features/workspace/use-reveal-open-band.ts`): once it is focused again and its
Open band has been laid out (it measures the page and the band with `onLayout`, and waits out a
0×0 layout, which is what Expo web reports for a screen hidden under the sheet), it scrolls the
band into view and clears the flag. If the loaded plan has nothing open, it just clears it. The decision card shows _You asked
"…"_ above its question from `DecisionData.asked`, cut to two lines; a decision the user or a
derivation made has none.

"Try again" after a failed run calls `onRetry`. A build run that `start` queued (the reply's
`restart`) starts again through `start` with no file, keeping the resume the plan already read.
Any other run re-sends the same text through `send()`: for an ask, or for a new plan whose run
failed after the intent was already created, `target` is already set, so this re-sends the goal as
an `ask` on that plan — there's no API to re-run the original `create_intent` run itself. While
the retry is in flight, `RunCard`'s `retrying` prop (`ask.isPending || create.isPending ||
start.isPending`) puts the Try again button in its `busy` state, so a second tap can't fire a
second retry underneath the first.

## The object sheet

An `open` action — a stop, a role card, a timeline row (its role), a draft in a role's sheet, or
the meta line (the plan's anchor) — pushes `apps/mobile/src/app/(app)/object.tsx` with `intentId`
and `objectId`. It's an iOS form sheet (a modal on Android and web) registered with the same
options as the + sheet. It reads the plan from `useIntent`'s cache and draws `DetailView`
(`features/registry/detail-registry.tsx`), which picks the object's body from `DETAIL_REGISTRY`
by kind:

- `place`: `PlaceBody` (`features/travel/`), which builds `stopDetails` and renders `PlaceSheet`.
- `opportunity`: `RoleBody` (`features/jobs/`): rename, the stage picker, Accept offer and
  Decline while at Offer, Close this role with an outcome, why it fits, **View posting** (the
  host it opens shown first), its drafts, people and interviews, I applied, and Ask about this
  role.
- `document`: `DraftBody`: the text, Copy, and for a follow-up or withdrawal **Open in Mail**, a
  `mailto:` link the user's own mail app fills in (Nexui never sends); I sent it, on a follow-up,
  logs the contact. A resume has no draft sheet.
- `search`: `SearchBody`: roles, places, industries and the never-show list as chips to add and
  remove (the resume's current employer stays), work modes, the salary floor, the pass reasons to
  forget, and the resume to add or replace.

A kind with no body shows "There's nothing more to show for this." `hasDetail(kind)` says whether
a kind has a body; the workspace's meta line ends in › and opens only for an anchor with one. Each body gets `DetailProps` (`features/workspace/detail-types.ts`: the
object, the snapshot, `onAction`, `onDone`, `busy`) and, like a primitive, never calls the API.

The sheet handles a body's actions as the workspace screen does: edits go through the same
capability path, optimistic ops and Undo (see "Optimistic edits"), and `upload`, `copy` and `link`
work the same. Two differ:

- `open` swaps the body in place (`router.setParams`; Next stop, a role's draft), scrolls to the
  top and clears the notice.
- `ask` dismisses the sheet and opens `+` with the prompt (Find a stay, Ask about this role, the
  salary floor's Set in +).

An object removed while its sheet is open shows "This is no longer in your plan." (each body has
its own line for an object it can't read). Done closes the sheet, or opens the plan when there's
no history to go back to, as after a reload on web. The ScrollView keeps taps while the keyboard
is up (`keyboardShouldPersistTaps="handled"`), so Save lands on the first tap, and on iOS it
insets its content by the keyboard (`automaticallyAdjustKeyboardInsets`; it uses UIKit's own
geometry, so the form sheet's measuring problem in "The + sheet" doesn't apply), keeping a lower
field in view. The sheet's notice ("Copied.", a 4 MB refusal), "Reading your resume…" and its
error lines sit in a fixed strip under the ScrollView, as the + sheet's composer does, so the line
about the button just tapped shows on a long sheet. Like the + sheet, its root `View` is
`collapsable={false}` with an empty `<View collapsable={false} />` first child; without them
react-native-screens resizes the ScrollView and the iOS form sheet shows blank.

`usePlaceMedia(intentId, placeIds)` fetches `GET /api/intents/:id/media`, refetching every 2 s
while any place is pending, up to ten times, and the workspace screen calls it, through
`usePlacePhotos`, for every place in the plan so a stop's sheet usually opens with its
introduction and photo. The lookup and cache are in
[`docs/architecture/place-media.md`](./place-media.md).

## Changes

The Changes tab and Home's "What changed" draw rows from `buildChangeRows`
(`features/changes/change-feed.ts`), one per changeset, from its event's payload, parsed with
`changesetPayloadSchema` as untrusted (see "The event's payload" in
[`intent-graph.md`](./intent-graph.md)). A row reads `payload.label` ("Set Tokyo to 3 days"),
or says how much changed without one, and each of `payload.figures` adds an Auto-calculated row
with its before → after. No row reads an object's kind, so a template's changes need no app code.

## Error display

Home and the workspace show a full `ListError` (with retry) only when nothing has loaded yet
(`isLoadingError`, or a 404 as "This plan no longer exists."). Once something has loaded, a
failed refetch (`isRefetchError`) shows `RefetchNotice` (`apps/mobile/src/ui/list-states.tsx`)
over the stale data instead of replacing it: a 44 pt button reading "Couldn't refresh your
plans/this plan. Showing what was last loaded. Tap to try again." that calls `refetch()` again.
The Changes tab passes no `onRetry`, so its notice is plain (non-interactive) text without "Tap to
try again.", since its feed already refetches on its own whenever the tab regains focus.

A failed plan delete shows a similar tappable notice on Home (see "Deleting a plan").

## The map

`MapSection` (`apps/mobile/src/features/travel/sections/map-section.tsx`) uses
`react-native-maps`: Apple Maps on iOS (no key needed), Google Maps on Android, which needs
`GOOGLE_MAPS_ANDROID_API_KEY` at build time (`apps/mobile/app.config.ts` passes it to the
`react-native-maps` config plugin and sets `extra.mapsOnAndroid`). The key is optional — without
it, Android renders `MapFallback`, the same numbered-list fallback `map-section.web.tsx` always
renders on web, since `react-native-maps` has no web build. The map itself is a fixed-height,
gesture-disabled postcard framed with `fitRegion` (`map-region.ts`), with numbered pins and a
route line in stop order.

Changing anything under `ios`/`android`/`plugins` in `app.config.ts`, or the maps key, needs a new
native dev client, not just a JS reload: `pnpm --filter @nexui/mobile exec expo run:ios` (or
`run:android`).

`expo-image`, which `PlacePhoto` uses, is a native module with a config plugin in `app.config.ts`,
so photos need a new dev client and a new EAS preview build. `expo-document-picker` (the PDF
picker, `data/pick-pdf.ts`) and `expo-clipboard` (Copy) are native modules too, with no config
plugin: picking a resume and copying a draft need a dev client and a preview build that include
them.

## iOS scene life cycle

Apps built with the iOS 27 SDK must adopt the UIScene life cycle, or UIKit stops them at launch
(`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Expo 57's app template doesn't
yet, so the local config plugin `apps/mobile/plugins/with-scene-lifecycle.js` adds a scene manifest
naming Expo's `EXExpoAppSceneDelegate` and makes `AppDelegate` an `ExpoReactNativeFactoryProvider`
that leaves the window to the scene delegate. Prebuild fails with a pointer to the plugin if the
template's `AppDelegate.swift` changes shape; remove the plugin once Expo's template adopts scenes.
