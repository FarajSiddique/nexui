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
- **`features/<area>/`**: what one area of the app needs: `auth`, `home`, `workspace` (with its
  `sections/` primitives), `changes`, `compose` (the + sheet), `account`, `place` (a stop's details sheet), and
  `shell` (the tab bar). A Zustand store lives in the feature that owns it, as `use-<name>-store.ts`.
- **`ui/`**: shared building blocks such as `Button` (its `ink` variant is a screen's main
  action, like Sign out), `PlacePhoto` (a place's photo on `expo-image`), `Pill`, the list states
  including `RefetchNotice`, `FormError` and `FormNotice`, and the tab header.
- **`theme/`**: the palettes and fonts (the `photoScrim` and `photoInk` tokens, the same in both
  themes, are for text and buttons drawn on a photo), `useColors`/`createThemedStyles`, and the appearance
  choice.
- **`data/`**: the API and Supabase clients, the TanStack Query hooks and keys (`queries.ts`, with
  `usePlaceMedia`, `usePlacePhotos` and the `PhotoState` type), and Realtime (`use-intent-live.ts`).
- **`lib/`**: pure helpers that several features share (`format.ts`).

Outside `src/`, `apps/mobile/assets/images/` holds the app icon and favicon that `app.config.ts`
points to. They're exported from the SVG sources in
[`docs/design/app-icons/`](../design/app-icons/README.md).

Imports run one way. Routes import from anywhere. Features import `ui`, `theme`, `data` and `lib`,
and another feature only where a screen needs that area's piece (the + tab button reads
`workspace`'s focused-intent store). `ui` imports only `theme`; `data`, `theme` and `lib` import
none of the others.

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

- `import/no-restricted-paths` holds the folder directions above, with one zone per folder.
  `eslint-import-resolver-typescript` follows the `#` imports, so a barrel import is checked like
  a relative one.
- `no-restricted-imports` bans `../` out of a folder, `@/`, `#<folder>/<file>` and a folder's
  own barrel.
- `no-restricted-syntax` keeps barrels to re-exports.
- `import/order` sets the groups.
- `import/no-cycle` keeps the graph acyclic, since a barrel makes a cycle easy to close and Metro
  warns about require cycles at runtime.

Lint doesn't police imports between features; keep those to what a screen needs.

## The Home stack and the workspace route

`apps/mobile/src/app/(app)/(tabs)/(home)/` is its own `Stack`
(`_layout.tsx`): `index.tsx` is Home (every plan as a card, then the latest three changes), and
`intent/[id].tsx` is the workspace for one intent, pushed over Home under the tab bar rather than
replacing it. Its back link (`‹ Plans`) calls `router.back()` when there's history, else
`router.replace('/')`. `GestureHandlerRootView` wraps the root layout
(`apps/mobile/src/app/_layout.tsx`) for the swipe below.

The workspace screen loads the intent's `GraphSnapshot` (`useIntent`), lays it out with
`layoutWorkspace`, and draws each block with `SectionView`. It shows a full-page skeleton or
error while nothing has loaded yet, a "Drafting" pill while a run is working (from `useIntents`'
list, since a single intent's own query doesn't carry that), and turns whatever a primitive
reports (a `WorkspaceAction`) into either a capability call (`useWorkspaceEdit`) or a push for the actions that open a sheet: `+` for an `ask`, `/place` for an `openPlace`.

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

These files under `apps/mobile/src/` have no `react-native` import, so `tests/mobile-*.test.mjs`
can run them under plain Node with no RN runtime: `lib/format.ts`; `ai-mark.ts`,
`workspace-layout.ts`, `workspace-actions.ts`, `stop-details.ts` and `sections/map-region.ts` in
`features/workspace/`; `features/changes/change-feed.ts`; `features/home/photo-band.ts`; and `plan-deletes.ts`,
`api-request.ts`, `intent-channel.ts` and `place-media.ts` in `data/`.

They import siblings by relative `.ts` paths. The only barrel they may import is `#lib`, whose
`index.ts` also uses `.ts` paths so Node can load it. Any other barrel, such as `#data`, pulls in
React Native and breaks the tests.

- **`format.ts`**: numbers, money, dates and relative times as display strings; `cardText` reads
  an object's title/subtitle from `KIND_CARDS`; `capitalize`, `ordinalWord`, `countryName`,
  `travelTo` and `legFigures` build the route and place sheet's wording.
- **`ai-mark.ts`**: `aiMarkFor`, the one place that decides what's marked as Nexui's work.
- **`workspace-layout.ts`**: `layoutWorkspace` and `sectionData`, which turn a `WorkspaceDoc` and a
  `GraphSnapshot` into `WorkspaceBlock[]` — each section's data, evaluated with `evaluateQuery`
  from `@nexui/types`, and the Open band placement. `metric` and `allocation` read the anchor's
  figures by derived key (`anchorFigures` and `figureValue`, from `KIND_FIGURES`), recomputed from
  the snapshot so an optimistic edit moves them at once.
- **`workspace-actions.ts`**: `capabilityFor` turns a `ServerAction` (any `WorkspaceAction` except `ask` and
  `openPlace`) into a `CapabilityRequest` (or `null` when there's nothing to send), `daysAction`
  builds the `setDays` action the route's and the sheet's steppers share, and `optimisticOps`
  builds the `ChangesetOp[]` a `setDays` or `move` shows at once.
- **`stop-details.ts`**: `stopDetails(snapshot, placeId)`, what the stop's sheet shows.
- **`place-media.ts`**: `mediaPlaceIds`, `mediaKeyIds` and `mediaPollInterval` for
  `usePlaceMedia`, and `placeAbout` and `placePhotos` for what each place shows (`PhotoState`).
- **`photo-band.ts`**: `photoBand`, the photos and "+N" of a Home card's band.
- **`map-region.ts`**: `fitRegion`, the map's camera for a set of points.
- **`change-feed.ts`**: `buildChangeRows`, `filterRows` and `groupByDay` for the Changes feed and
  Home's "What changed".
- **`plan-deletes.ts`**: `planDeletes`, which reduces the plan deletes in the mutation cache to
  the ids to hide (pending) and the failed ones to retry, counting each plan's latest attempt.
- **`api-request.ts`**: `requestJson`, the one function that sends a request, applies a timeout,
  and turns a failure into an `ApiError`.

## Sections

`SECTION_REGISTRY` (`apps/mobile/src/features/workspace/sections/registry.tsx`) maps every
`Section['type']` to its primitive component; a type with no entry fails typecheck. Every primitive
receives `{ section, data, snapshot, photos, onAction, busy }` (`SectionProps<T>` in `./types.ts`): it
renders and reports a `WorkspaceAction` through `onAction`, and never calls the API itself — the
workspace screen (`intent/[id].tsx`) is the only place a `WorkspaceAction` becomes a capability
request or a push to `+` or `/place`.

`photos` is each place's `PhotoState` by id, which the workspace screen passes from
`usePlacePhotos`.

A route row is one button per stop (`openPlace`), with the ↑↓ and the day stepper on a line below.
`DayStepper` lives in `features/workspace/day-stepper.tsx`, shared with the place sheet.

## The Open band

A section can carry `pin: 'open'`. `layoutWorkspace` lifts a pinned section into one "Open band"
while it's unresolved — a `decision` with `status: 'open'`, or an `insight` whose query still
returns rows — and drops it once resolved. The band sits directly under the doc's first `metric`
section, or at the top if the doc has none.

## The AI marking rule

`aiMarkFor` is the one place that decides what's marked as Nexui's work: `highlight` is true for
an object with `source.type === 'ai'` and no `source.reviewedAt` (a user edit sets
`reviewedAt` on the server, which clears it), and `tentative` is true for any `option` object.
Every primitive that shows an AI mark calls this function rather than checking `source` itself.

## Optimistic edits

The route's user-callable capabilities — `trip.setPlaceDays`, `trip.reorderPlaces`,
`decision.resolve`, and whatever a `capability` action names (an insight's buttons) — go through
`useWorkspaceEdit(intentId)`:

- Every edit on one intent shares a mutation `scope` (`editKey(intentId)`), so taps run one at a
  time in the order they were made rather than racing.
- Each edit applies its `optimistic` ops to the cached snapshot at once, for display; the ops for
  `setDays` and `move` are absolute values, so a burst of taps ends in the state the user saw
  last. `decision.resolve` and capability actions carry no optimistic ops — only the server knows
  their outcome.
- Only the last edit to finish writes the server's `CommitResponse.snapshot` into the cache (and
  only the last edit to fail refetches); an earlier answer never overwrites a later tap's
  optimistic state.
- `use-edit-memory-store.ts`'s `rememberDays` remembers a stop's day count from before this
  session's first edit to it, so the route can show "was 4" next to a changed stepper; stepping
  back to the original value forgets it.
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
reads `intentId`/`prompt` from its route params (set when a section's `ask` action pushes to `+`
with a prompt already filled in) and otherwise from nothing, in which case it starts a new intent.
Once a run starts, `RunCard` (`apps/mobile/src/features/compose/run-card.tsx`) streams it: a spinner
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

"Try again" after a failed run calls `onRetry`, which re-sends the same text through `send()`. For
an ask, or for a new plan whose run failed after the intent was already created, `target` is
already set, so this re-sends the goal as an `ask` on that plan — there's no API to re-run the
original `create_intent` run itself. While the retry is in flight, `RunCard`'s `retrying` prop
(`ask.isPending || create.isPending`) puts the Try again button in its `busy` state, so a second
tap can't fire a second retry underneath the first.

## The place sheet

Tapping a stop pushes `apps/mobile/src/app/(app)/place.tsx`, an iOS form sheet (a modal on Android
and web) registered with the same options as the + sheet. It builds `stopDetails` from the cached
plan and renders `PlaceSheet` (`features/place/place-sheet.tsx`); its day changes go through the
same edit path as the route (see "Optimistic edits"). Like the + sheet, its root `View` is
`collapsable={false}` with an empty `<View collapsable={false} />` first child; without them
react-native-screens resizes the ScrollView and the iOS form sheet shows blank. `usePlaceMedia(intentId, placeIds)` fetches
`GET /api/intents/:id/media`, refetching every 2 s while any place is pending, up to ten times, and
the workspace screen calls it, through `usePlacePhotos`, for every place in the plan so the sheet
usually opens with its introduction and photo. The lookup and cache are in
[`docs/architecture/place-media.md`](./place-media.md).

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

`MapSection` (`apps/mobile/src/features/workspace/sections/map-section.tsx`) uses
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
so photos need a new dev client and a new EAS preview build.

## iOS scene life cycle

Apps built with the iOS 27 SDK must adopt the UIScene life cycle, or UIKit stops them at launch
(`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Expo 57's app template doesn't
yet, so the local config plugin `apps/mobile/plugins/with-scene-lifecycle.js` adds a scene manifest
naming Expo's `EXExpoAppSceneDelegate` and makes `AppDelegate` an `ExpoReactNativeFactoryProvider`
that leaves the window to the scene delegate. Prebuild fails with a pointer to the plugin if the
template's `AppDelegate.swift` changes shape; remove the plugin once Expo's template adopts scenes.
