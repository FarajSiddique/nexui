# Mobile

The Expo app renders the intent graph (see
[`docs/architecture/intent-graph.md`](./intent-graph.md)) as a workspace, keeps edits feeling
instant, and stays current while a run or another device changes the same intent. This doc
covers the pieces that make that work: the workspace route, the pure layout layer, optimistic
edits, and Realtime.

## The Home stack and the workspace route

`apps/mobile/src/app/(app)/(tabs)/(home)/` is its own `Stack`
(`_layout.tsx`): `index.tsx` is Home (every plan as a card, then the latest three changes), and
`intent/[id].tsx` is the workspace for one intent, pushed over Home under the tab bar rather than
replacing it. Its back link (`‹ Plans`) calls `router.back()` when there's history, else
`router.replace('/')`.

The workspace screen loads the intent's `GraphSnapshot` (`useIntent`), lays it out with
`layoutWorkspace`, and draws each block with `SectionView`. It shows a full-page skeleton or
error while nothing has loaded yet, a "Drafting" pill while a run is working (from `useIntents`'
list, since a single intent's own query doesn't carry that), and turns whatever a primitive
reports (a `WorkspaceAction`) into either a capability call (`useWorkspaceEdit`) or a push to `+`
for an `ask`.

## The pure display layer

`apps/mobile/src/lib/format.ts`, `ai-mark.ts`, `sections.ts`, `workspace-actions.ts`,
`map-region.ts`, `change-feed.ts` and `api-request.ts` have no `react-native` import and import
each other as sibling `.ts` files (not through the `@/` alias), so `tests/mobile-*.test.mjs` can
run them under plain Node with no RN runtime:

- **`format.ts`**: numbers, money, dates and relative times as display strings; `cardText` reads
  an object's title/subtitle from `KIND_CARDS`.
- **`ai-mark.ts`**: `aiMarkFor`, the one place that decides what's marked as Nexui's work.
- **`sections.ts`**: `layoutWorkspace` and `sectionData`, which turn a `WorkspaceDoc` and a
  `GraphSnapshot` into `WorkspaceBlock[]` — each section's data, evaluated with `evaluateQuery`
  from `@nexui/types`, and the Open band placement.
- **`workspace-actions.ts`**: `capabilityFor` turns a `WorkspaceAction` into a `CapabilityRequest`
  (or `null` when there's nothing to send), and `optimisticOps` builds the `ChangesetOp[]` a
  `setDays` or `move` shows at once.
- **`map-region.ts`**: `fitRegion`, the map's camera for a set of points.
- **`change-feed.ts`**: `buildChangeRows`, `filterRows` and `groupByDay` for the Changes feed and
  Home's "What changed".
- **`api-request.ts`**: `requestJson`, the one function that sends a request, applies a timeout,
  and turns a failure into an `ApiError`.

## Sections

`SECTION_REGISTRY` (`apps/mobile/src/components/sections/registry.tsx`) maps every `Section['type']`
to its primitive component; a type with no entry fails typecheck. Every primitive receives
`{ section, data, snapshot, onAction, busy }` (`SectionProps<T>` in `./types.ts`): it renders and
reports a `WorkspaceAction` through `onAction`, and never calls the API itself — the workspace
screen (`intent/[id].tsx`) is the only place a `WorkspaceAction` becomes a capability request or a
push to `+`.

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

`useIntentLive(intentId)` (`apps/mobile/src/lib/use-intent-live.ts`) keeps an open workspace
current while the server writes to it without the client asking — a run filling it in, or another
device's edit. It subscribes to `objects`, `relationships`, `workspaces`, `runs` and `events`,
filtered to `intent_id=eq.<id>`, scoped by RLS. A burst of row changes collapses into one refetch
per 300 ms: the run, intents and changes lists always refetch, but the intent snapshot itself
waits (re-arming only its own retry, not the lists') while the user's own edit is still in flight,
so a refetch can't briefly undo an optimistic change. Each mount opens a channel with a unique
topic (`intent-<id>-<random>`), because `supabase.channel` returns an existing channel for a topic
already in use, which would throw on a second `.on(...)` for a remount of the same intent.

`subscribe` takes a status callback: on every `SUBSCRIBED` — including a rejoin after
`CHANNEL_ERROR` or `TIMED_OUT`, or the socket dropping and reconnecting — it runs the same
catch-up (lists plus the intent key), since `postgres_changes` gives no other sign that events
were missed while disconnected.

Three polls cover what Realtime and a rejoin don't:

- `useIntents` (Home's cards) polls every 4 s while any intent's summary badge reads `running`,
  since `intents` isn't a table `useIntentLive` watches. When that goes from some plan Drafting to
  none, it invalidates `changes` once more, to catch a run's last change even if it landed just
  before this poll saw the plan settle.
- `useIntent(id, { poll })` polls every 4 s while its workspace screen passes `poll: true` (set
  from `drafting`, the same "any intent's badge is `running`" check), for the one intent on
  screen — Realtime already covers a run's own writes, but this is the fallback for a missed
  event. It skips a tick while a workspace edit (`editKey(id)`) is in flight, so it can't overwrite
  an optimistic change. The workspace screen also invalidates the intent key and `changes` once,
  directly, the moment `drafting` flips from true to false.
- `useRecentChanges` (Home's "What changed") polls on the same 4 s cadence as `useIntents`, reading
  its cached data to decide whether any plan is Drafting, since a run's changes aren't on Realtime
  when no workspace is open for it.

`useRun` polls every 3 s while its run is `queued` or `running`, as a fallback for a dropped
socket, unrelated to the polls above.

The Changes tab (`apps/mobile/src/app/(app)/(tabs)/changes.tsx`) doesn't poll — the feed
(`useChangesFeed`) instead refetches whenever the tab regains focus (`useFocusEffect`), which is
enough since visiting the tab is exactly when a stale feed would otherwise show.

## The + sheet

`use-focused-intent-store.ts` holds the intent id of the workspace on screen, if any
(`focusIntent`, set on focus and cleared on blur by the workspace screen's `useFocusEffect`), so
opening `+` acts on that plan instead of starting a new one. `apps/mobile/src/app/(app)/compose.tsx`
reads `intentId`/`prompt` from its route params (set when a section's `ask` action pushes to `+`
with a prompt already filled in) and otherwise from nothing, in which case it starts a new intent.
Once a run starts, `RunCard` (`apps/mobile/src/components/run-card.tsx`) streams it: a spinner and
elapsed time while active, one line per succeeded capability call (not per step — a step can make
several calls) as it lands, and Stop, Retry or "See changes" depending on the run's status.
Closing the sheet doesn't stop the run — what it's written stays and can be undone from Changes.

"Try again" after a failed run calls `onRetry`, which re-sends the same text through `send()`. For
an ask, or for a new plan whose run failed after the intent was already created, `target` is
already set, so this re-sends the goal as an `ask` on that plan — there's no API to re-run the
original `create_intent` run itself. While the retry is in flight, `RunCard`'s `retrying` prop
(`ask.isPending || create.isPending`) puts the Try again button in its `busy` state, so a second
tap can't fire a second retry underneath the first.

## Error display

Home and the workspace show a full `ListError` (with retry) only when nothing has loaded yet
(`isLoadingError`, or a 404 as "This plan no longer exists."). Once something has loaded, a
failed refetch (`isRefetchError`) shows a small inline notice — a 44 pt `Pressable` reading
"Couldn't refresh your plans/this plan. Showing what was last loaded. Tap to try again." — over
the stale data instead of replacing it; tapping it calls `refetch()` again. The Changes tab shows
the equivalent notice as plain (non-interactive) text, since its feed already refetches on its own
whenever the tab regains focus.

## The map

`MapSection` (`apps/mobile/src/components/sections/map-section.tsx`) uses `react-native-maps`:
Apple Maps on iOS (no key needed), Google Maps on Android, which needs
`GOOGLE_MAPS_ANDROID_API_KEY` at build time (`apps/mobile/app.config.ts` passes it to the
`react-native-maps` config plugin and sets `extra.mapsOnAndroid`). The key is optional — without
it, Android renders `MapFallback`, the same numbered-list fallback `map-section.web.tsx` always
renders on web, since `react-native-maps` has no web build. The map itself is a fixed-height,
gesture-disabled postcard framed with `fitRegion` (`map-region.ts`), with numbered pins and a
route line in stop order.

Changing anything under `ios`/`android`/`plugins` in `app.config.ts`, or the maps key, needs a new
native dev client, not just a JS reload: `pnpm --filter @nexui/mobile exec expo run:ios` (or
`run:android`).
