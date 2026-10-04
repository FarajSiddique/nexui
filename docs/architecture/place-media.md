# Place media

Tapping a stop on a trip's route opens a sheet with everything about it, including a short
Wikipedia introduction to the place. That introduction comes from a shared cache that is filled
lazily from English Wikipedia the first time anyone views the place. Phase 2 adds photos to the
same cache. The design is in
[`docs/superpowers/specs/2026-10-04-place-photos-and-details-design.md`](../superpowers/specs/2026-10-04-place-photos-and-details-design.md);
this doc covers what exists today (phase 1). The plan data, Changes and Undo are untouched: the
model never writes media, and Wikipedia text never enters the graph or a model prompt.

## The place key

`placeMediaKey(place)` (`packages/types/src/media.ts`) turns a place into its cache key: its
normalized name, its country code, and its coordinates rounded to 0.1° (about 11 km).

```ts
placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 });
// 'cesky krumlov|CZ|48.8|14.3'
placeMediaKey({ name: 'Washington, D.C.', country: 'US', lat: 38.9072, lng: -77.0369 });
// 'washington d c|US|38.9|-77.0'
```

`normalizePlaceName` lowercases, removes accents (Unicode NFKD), and turns each run of
punctuation or whitespace into one space. Folding punctuation keeps commas, quotes and
parentheses out of keys, which matters because the cache is read with a PostgREST `in.(…)`
filter that supabase-js doesn't escape. The name part is capped at 150 characters. The same
place in any plan shares one key, so Wikipedia is asked about Berlin once for everyone.

## The lookup

`apps/api/src/lib/media/` holds it:

- `wikipedia.ts`: `searchArticles(name, contact)`, one Action API call on `en.wikipedia.org`
  (`generator=search`, `gsrlimit=5`, `prop=pageimages|coordinates|extracts`, `exintro`,
  `explaintext`, `exsentences=3`). Every request sends `User-Agent: Nexui/1.0 (<contact>)` and
  times out after 4 seconds. A 429 or 503 is a `WikipediaThrottledError` carrying
  `Retry-After`; any other HTTP error, a timeout, an `error` answer or an unreadable body is a
  `WikipediaError`. Articles without coordinates are dropped.
- `rules.ts` (pure): `matchArticle` keeps articles within 25 km of the place (75 km for a
  `region` or `area`), prefers one titled with the place's name (or the name followed by a
  comma, as in "Springfield, Illinois"), and otherwise takes the nearest. Nothing in range is
  `none`; the lookup never guesses. It also holds the expiry rules, `isFresh`, the row builders
  and `toPlaceMedia`, which maps a row to what the app sees.
- `cache.ts`: `readRows` reads a plan's keys in one query; `saveRow` upserts one result.
- `lookup.ts`: `mediaPlaces(snapshot)` collects every valid place in a snapshot (decision
  candidates included) with its key, and `resolvePlaceMedia` answers for them (see the route).
- `config.ts`: `readMediaConfig(env = process.env)` reads `WIKIMEDIA_CONTACT`.
- `schedule.ts`: `scheduleMediaTask` wraps Next.js `after()`; tests replace it with
  `setMediaScheduler`.

## The cache

`supabase/migrations/20261004140000_place_media.sql` creates `public.place_media`, one row per
key, with every column phase 2 needs:

| Column           | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `key`            | The place key (at most 200 characters).                               |
| `status`         | `found` (an article matched), `none` (nothing in range), `failed`.    |
| `lookup_version` | The code's `LOOKUP_VERSION` (1 now). An older row counts as expired.  |
| `pinned`         | Set by an operator; refreshes skip the row.                           |
| `page_title`     | The matched article's title.                                          |
| `page_url`       | `https://en.wikipedia.org/wiki/…`, built from the title.              |
| `extract`        | The three-sentence introduction on one line, at most 600 characters.  |
| `photo`          | Phase 2: `{ path, thumbPath, width, height }`. Always null today.     |
| `credit`         | Phase 2: `{ author, license, licenseUrl, sourceUrl }`. Always null.   |
| `fetched_at`     | When the row was written.                                             |
| `expires_at`     | `found` + 90 days, `none` + 30 days, `failed` + 15 minutes or longer. |

A `failed` row expires after 15 minutes or the `Retry-After` wait, whichever is later, capped at
a day. RLS is on with no policies, and `anon` and `authenticated` have no grants: only the API's
secret-key client (`getAdminClient`) reads or writes the table, after the route has loaded the
plan as the user. A write never sends `pinned`, so an operator's pin survives.

**Fixing a wrong match.** An operator edits the row and pins it, which fixes it for every user:

```sql
update public.place_media
set status = 'none', page_title = null, page_url = null, extract = null, pinned = true
where key = 'amalfi coast|IT|40.6|14.6';
```

The share of `none` rows is the number that decides whether a non-Wikipedia fallback is worth
adding later.

## The route

`GET /api/intents/:id/media` (`apps/api/src/app/api/intents/[id]/media/route.ts`,
`maxDuration = 30`):

1. `verifyRequest`; a bad id is 404.
2. `readMediaConfig()`, then `loadSnapshot` with the user's client. That is the ownership check:
   another user's plan is a 404, and nothing is read or looked up.
3. `resolvePlaceMedia` with the secret-key client reads every key's row in one query. A fresh
   row answers at once. Missing or expired keys are looked up, at most 20 per request and four
   at a time, within a 6-second budget. A throttle stops the request starting new lookups.
4. Places whose lookup finished answer `ready`; the rest answer `pending`. Lookups still
   running at the deadline finish in `after()` and write the cache; ones never started wait for
   the app's next request. A place twice in a plan is looked up once.

The answer is `intentMediaSchema` (`packages/types/src/media.ts`), by place id:

```json
{
  "places": {
    "<placeId>": {
      "status": "ready",
      "about": { "title": "Berlin", "extract": "Berlin is…", "url": "https://…" },
      "photo": null
    },
    "<otherId>": { "status": "pending" }
  }
}
```

`about` is null for `none` and `failed` rows, and for a row whose introduction is empty. The
contract only accepts `about.url` on `https://en.wikipedia.org`, and (phase 2) photo URLs under
`/storage/v1/object/public/place-photos/` and credit links on `commons.wikimedia.org`, so an
edited row can't put any other link in front of a user.

## Configuration

`WIKIMEDIA_CONTACT` (`apps/api/.env.example`) is an email address or URL Wikimedia can reach us
at; it goes in the User-Agent. Unset, lookups are off: the route answers `ready` with nothing for
any place not already cached (serving cached rows even when expired) and logs `[media] Lookups
are off: WIKIMEDIA_CONTACT is not set.` once. A value that is neither an email address nor a URL
is a `MediaConfigurationError`: the route logs its message and answers 500.

## Failures and logs

- A 429 or 503 caches the place as `failed` until `Retry-After` (at least 15 minutes) and stops
  the request starting new lookups. Other errors and timeouts cache `failed` for 15 minutes.
  The app shows no introduction; nothing else waits on Wikipedia.
- A failed cache write is logged with its code (`[media] Could not cache a lookup (42501).`) and
  the lookup's answer is still sent. A failed cache read is a 500, `Could not load place
details. Try again.`
- Two requests can look up the same new place at once. Both upsert the same row; there is no
  lock.
- Logs carry the `[media]` tag, counts and HTTP status codes only: no place names, response
  bodies or URLs. After its lookups, a request logs `[media] looked up 3: 2 found, 1 none, 0
failed.` with `console.error` when any failed, else with `console.info` outside production.

## The app

- `getPlaceMedia` (`apps/mobile/src/data/api.ts`) and `usePlaceMedia(intentId, placeIds)`
  (`data/queries.ts`) fetch the route. The query is keyed by the intent and its sorted place
  ids (`mediaKeyIds`), so a stop the model adds starts a fetch, and the last answer stays on
  screen while a new key loads. While any place is `pending` it refetches every 2 seconds, up
  to ten times (`mediaPollInterval` in the pure `data/place-media.ts`).
- The workspace screen calls `usePlaceMedia` with every place in the plan (`mediaPlaceIds`), so
  lookups start when a plan is opened and a stop's sheet usually opens with its introduction.
- Each route row is one button ("Berlin, stop 1, 3 days. Show details") that reports
  `{ type: 'openPlace', placeId }`; the workspace pushes `/place` with `intentId` and
  `placeId`. The ↑↓ and day stepper sit on a line below.
- `apps/mobile/src/app/(app)/place.tsx` is an iOS form sheet and a modal on Android and web,
  with the + sheet's options. It reads the plan from `useIntent`'s cache, builds
  `stopDetails(snapshot, placeId)` (`features/workspace/stop-details.ts`, pure), and renders
  `PlaceSheet` (`features/place/place-sheet.tsx`): Done (which opens the plan when there's no history to go back to, as after a reload on
  web); the name on the Nexui highlighter
  while unreviewed; "{Type} in {Country}, the {nth} of {n} stops" (`countryName` reads the
  bundled CLDR list in `lib/country-names.ts`, since Hermes has no `Intl.DisplayNames`); Days here with the shared `DayStepper` and
  Daily cost; Why it's on your route; About {name} ("Looking up {name}…" while pending and the app is still polling, hidden with
  no article or once the polls run out; `usePlaceAbout`) with Read more on Wikipedia; Next stop, which swaps in that stop's details;
  and Where you'll stay, or Find a stay with Nexui, which closes the sheet and opens + with
  "Find a stay in {name}".
- Day changes in the sheet go through the same `daysAction`, `capabilityFor`,
  `optimisticOps`, `rememberDays` and `UndoToast` as the route. A stop removed while its sheet
  is open shows "This stop is no longer on your route."

## Checking it

- `tests/place-media-key.test.mjs`: normalization, punctuation and rounding.
- `tests/place-media-rules.test.mjs`: the radii, the title preference, no match out of range,
  expiry per status, `Retry-After`, freshness and pinned rows, and unsafe links.
- `tests/place-media-lookup.test.mjs`: the budget and `after()`, the 20-lookup cap, a throttle,
  a place twice, pinned rows, Wikipedia error answers, a failed cache write, and no contact.
- `tests/media-route.test.mjs`: auth, ownership, cache hits and misses, the User-Agent, a
  429, no contact, candidates, a cache failure, a bad contact, and the contract's URL rules.
- `tests/mobile-stop-details.test.mjs` and `tests/mobile-place-media.test.mjs`: the sheet's
  pure logic and the polling.
- `node scripts/check-place-media.mjs`: the manual live gate. It runs the lookup and match rules
  against live Wikipedia, with no cache writes, for Berlin, Hallstatt, Springfield at Illinois'
  and Massachusetts' coordinates, Lower Austria, the Amalfi Coast (not the Duchy of Amalfi),
  Kyoto and the Dolomites, and prints a pass or fail per case. It needs `WIKIMEDIA_CONTACT` in
  the environment or `apps/api/.env.local`.
