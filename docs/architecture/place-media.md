# Place media

Each place on a trip has two things from Wikimedia: a short Wikipedia introduction and a photo. The introduction shows in the stop sheet. The photo shows in four places: route cards, decision options, Home cards and the sheet. Both come from one shared cache, filled lazily the first time anyone views the place.

The design is in
[`docs/superpowers/specs/2026-10-04-place-photos-and-details-design.md`](../superpowers/specs/2026-10-04-place-photos-and-details-design.md).

The plan data, Changes and Undo are untouched:

- The model never writes media.
- Wikipedia and Commons text never enters the graph or a model prompt.
- Devices load photos only from our Supabase Storage bucket, never from Wikimedia.

## The place key

`placeMediaKey(place)` (`packages/types/src/media.ts`) turns a place into its cache key: its
normalized name, its country code, and its coordinates rounded to 0.1° (about 11 km).

```ts
placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 });
// 'cesky krumlov|CZ|48.8|14.3'
placeMediaKey({ name: 'Washington, D.C.', country: 'US', lat: 38.9072, lng: -77.0369 });
// 'washington d c|US|38.9|-77.0'
```

`normalizePlaceName` lowercases, removes accents (Unicode NFKD), and turns each run of punctuation or whitespace into one space. The name part is capped at 150 characters.

Folding punctuation keeps commas, quotes and parentheses out of keys. That matters because the cache is read with a PostgREST `in.(…)` filter, which supabase-js doesn't escape.

The same place in any plan shares one key, so Wikipedia is asked about Berlin once for everyone. `derive.trip` also stores each stop's key on the plan's Home summary (see Home below).

## The lookup

`apps/api/src/lib/media/` holds it. Every request sends `User-Agent: Nexui/1.0 (<contact>)` and times out after 4 seconds.

**`wikipedia.ts`** holds the Wikimedia requests:

- `searchArticles(name, contact)` is request 1: one Action API call on `en.wikipedia.org` (`generator=search`, `gsrlimit=5`, `prop=pageimages|coordinates|extracts`, `exintro`, `explaintext`, `exsentences=3`). Articles without coordinates are dropped. The page-image API returns only freely licensed lead images.
- `fileInfo(file, contact)` is request 2: `prop=imageinfo` for the lead image on `commons.wikimedia.org`, with `iiurlwidth=960` and the `Artist`, `LicenseShortName`, `LicenseUrl` and `NonFree` metadata. A file that isn't on Commons, such as one stored only on English Wikipedia, comes back null and gets no photo.
- `downloadImage(url, contact)` fetches one size without following redirects. It returns null for anything that isn't a JPEG, PNG or WebP by its first bytes, or is over 2 MB.

Errors:

- A 429 or 503 from any of these hosts is a `WikipediaThrottledError` carrying `Retry-After`.
- Any other HTTP error, a timeout, a redirect, an `error` answer or an unreadable body is a `WikipediaError`.

**`rules.ts`** (pure) holds the match and photo rules:

- `matchArticle` keeps articles within 25 km of the place (75 km for a `region` or `area`). It prefers one titled with the place's name, or the name followed by a comma ("Springfield, Illinois"), and otherwise takes the nearest. Nothing in range is `none`; the lookup never guesses.
- `isUsableImage` rejects a lead image that is an SVG, or whose file name names a flag, coat of arms (`coa`, `Wappen`), map, locator map, logo, seal or emblem. Words match whole, so "Flagstaff" passes.
- `photoSource` applies request 2's rules:
  - The file needs a licence name and must not be marked non-free (a `NonFree` value other than `false`).
  - It needs a 960px thumbnail on Wikimedia's thumbnail host: `thumb.wikimedia.org` since 2026, or `upload.wikimedia.org`.
  - Its file page must be on `commons.wikimedia.org`.
  - The tracking query Commons adds to thumbnail URLs is dropped.
  - The 500px URL is the 960px one with the width replaced; both are standard Wikimedia widths. An original narrower than 960px has no 960px thumbnail, so it gets no photo.
  - The author is `plainText(Artist)`: tags dropped, entities decoded, at most 120 characters. A derivative work's link to its source file is dropped, and list items join with "; ". A missing `Artist` gives an empty author.
- The file also holds `imageType` (format from the bytes), the expiry rules, `isFresh`, the row builders and `toPlaceMedia`, which maps a row to what the app sees.

**`storage.ts`** holds the copy:

- `copyPhoto` downloads both sizes and uploads them to the `place-photos` bucket at `<first 16 hex of sha256(key)>/<first 12 hex of sha256(bytes)>-<960|500>.<ext>`, with a one-year `Cache-Control` and upsert.
- A path names its content, so a refresh writes new files and old URLs stay valid. Files are never deleted.
- `publicPhotoUrl` builds a file's public URL with supabase-js's `getPublicUrl`.

**The other files:**

- `cache.ts`: `readRows` reads keys at most 100 per query, and `saveRow` upserts one result.
- `lookup.ts`: `mediaPlaces(snapshot)` collects every valid place in a snapshot (decision candidates included) with its key, and `resolvePlaceMedia` answers for them (see the route). Each lookup searches, matches and, when the match has a usable lead image, makes request 2 and copies the photo.
- `home.ts`: `withHomePhotos` fills Home's cards (see Home below).
- `config.ts`: `readMediaConfig(env = process.env)` reads `WIKIMEDIA_CONTACT`.
- `schedule.ts`: `scheduleMediaTask` wraps Next.js `after()`; tests replace it with `setMediaScheduler`.

## The cache

`supabase/migrations/20261004140000_place_media.sql` creates `public.place_media`, one row per key:

| Column           | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `key`            | The place key (at most 200 characters).                               |
| `status`         | `found` (an article matched), `none` (nothing in range), `failed`.    |
| `lookup_version` | The code's `LOOKUP_VERSION` (2). An older row counts as expired.      |
| `pinned`         | Set by an operator; refreshes skip the row.                           |
| `page_title`     | The matched article's title.                                          |
| `page_url`       | `https://en.wikipedia.org/wiki/…`, built from the title.              |
| `extract`        | The three-sentence introduction on one line, at most 600 characters.  |
| `photo`          | `{ path, thumbPath, width, height }` in the bucket, or null.          |
| `credit`         | `{ author, license, licenseUrl?, sourceUrl }`, or null.               |
| `fetched_at`     | When the row was written.                                             |
| `expires_at`     | `found` + 90 days, `none` + 30 days, `failed` + 15 minutes or longer. |

Rows and photos:

- `found` means an article matched. Its `photo` is null when there's no lead image or the image fails a rule. Phase 1 wrote version 1 rows with no photos, and those are looked up again on their next view.
- A `failed` row expires after 15 minutes or the `Retry-After` wait, whichever is later, capped at a day.

Access: RLS is on with no policies, and `anon` and `authenticated` have no grants. Only the API's secret-key client (`getAdminClient`) reads or writes the table, after the route has loaded the plan as the user. A write never sends `pinned`, so an operator's pin survives.

**Fixing a wrong match.** An operator edits the row and pins it, which fixes it for every user:

```sql
update public.place_media
set status = 'none', page_title = null, page_url = null, extract = null,
    photo = null, credit = null, pinned = true
where key = 'amalfi coast|IT|40.6|14.6';
```

To swap a wrong photo, upload the right one to the bucket, point `photo` and `credit` at it, and pin the row. The share of `none` rows is the number that decides whether a non-Wikipedia fallback is worth adding.

## The bucket

`supabase/migrations/20261004150000_place_photos_bucket.sql` creates the public `place-photos` bucket:

- `image/jpeg`, `image/png` and `image/webp` only, at most 2 MB per file.
- Anyone can read a file by its public URL through Supabase's CDN.
- There are no policies, so app users can't list, upload or change files; only the secret-key client uploads.

## The route

`GET /api/intents/:id/media` (`apps/api/src/app/api/intents/[id]/media/route.ts`, `maxDuration = 30`):

1. `verifyRequest`; a bad id is 404.
2. `readMediaConfig()`, then `loadSnapshot` with the user's client. That is the ownership check: another user's plan is a 404, and nothing is read or looked up.
3. `resolvePlaceMedia`, with the secret-key client:
   - It reads every key's row; a fresh row answers at once.
   - Missing or expired keys are looked up, at most 20 per request and four at a time, within a 6-second budget.
   - A throttle stops the request starting new lookups.
4. Places whose lookup finished answer `ready`; the rest answer `pending`.
   - Lookups still running at the deadline finish in `after()` and write the cache.
   - Ones never started wait for the app's next request.
   - A place twice in a plan is looked up once.

A lookup makes up to six requests: search, request 2, two downloads and two uploads. One cut off by `maxDuration` writes no row, so it is looked up again on the next request.

The answer is `intentMediaSchema` (`packages/types/src/media.ts`), by place id:

```json
{
  "places": {
    "<placeId>": {
      "status": "ready",
      "about": { "title": "Berlin", "extract": "Berlin is…", "url": "https://…" },
      "photo": {
        "url": "https://<project>.supabase.co/storage/v1/object/public/place-photos/…-960.jpg",
        "thumbUrl": "https://<project>.supabase.co/storage/v1/object/public/place-photos/…-500.jpg",
        "width": 960,
        "height": 560,
        "credit": {
          "author": "Kasa Fue; derivative work: Georgfotoart",
          "license": "CC BY-SA 4.0",
          "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
          "sourceUrl": "https://commons.wikimedia.org/wiki/File:…"
        }
      }
    },
    "<otherId>": { "status": "pending" }
  }
}
```

`about` and `photo` are null for `none` and `failed` rows. `about` is also null for a row whose introduction is empty.

The contract accepts only these links, so an edited row can't put any other link in front of a user:

- `about.url` on `https://en.wikipedia.org`.
- Photo URLs that are `https` under `/storage/v1/object/public/place-photos/`.
- Credit links on `commons.wikimedia.org`.

A stored photo whose URL the contract rejects, such as one on a local `http` Supabase, is dropped from the answer instead of failing it.

## Home

The Home list never looks anything up, so it stays fast:

1. `derive.trip` writes each summary stop's `key` (`intentSummarySchema.strip[].key`).
2. `GET /api/intents` lists the plans with the user's client.
3. `withHomePhotos` reads the cache rows for each card's first three keys with the secret-key client, at most 100 keys per query.
4. It fills `photos` (`intentListItemSchema`, at most three) with the 500px URLs of the stops that have one. Expired rows still count, since stored files never move.

Two cases add no photos:

- A summary saved before photos has no keys until its plan's next change, so its card has no photos until then.
- A failed read logs `[media] Could not load Home photos (<code>).`, and the cards come back without photos.

## Configuration

`WIKIMEDIA_CONTACT` (`apps/api/.env.example`) is an email address or URL Wikimedia can reach us at; it goes in the User-Agent.

- **Unset:** lookups are off. The route answers `ready` with nothing for any place not already cached, serving cached rows even when expired. It logs `[media] Lookups are off: WIKIMEDIA_CONTACT is not set.` once.
- **Neither an email address nor a URL:** a `MediaConfigurationError`. The route logs its message and answers 500.

## Failures and logs

- **Throttles:** a 429 or 503 from Wikipedia, Commons or a thumbnail download caches the place as `failed` until `Retry-After` (at least 15 minutes) and stops the request starting new lookups.
- **Other errors:** HTTP errors, redirects, timeouts and failed uploads cache `failed` for 15 minutes. A photo URL never points at a missing file.
- **Rejected content:** a file that isn't an image we accept, or is over 2 MB, keeps the row `found` with no photo.
- **Cache failures:**
  - A failed cache write is logged with its code (`[media] Could not cache a lookup (42501).`), and the lookup's answer is still sent.
  - A failed cache read on the media route is a 500, `Could not load place details. Try again.`
- **Duplicate lookups:** two requests can look up the same new place at once. Both upsert the same row, and the photo paths name their content, so the extra copy is harmless. There is no lock.
- **What logs carry:** the `[media]` tag, counts and HTTP status codes only. No place names, file names, response bodies or URLs.
  - After its lookups, a request logs `[media] looked up 3: 2 found, 1 none, 0 failed.`, with `console.error` when any failed and `console.info` outside production otherwise.
  - A failed upload logs `[media] Could not store a photo (<status>).`

## The app

**Fetching.**

- `getPlaceMedia` (`apps/mobile/src/data/api.ts`) and `usePlaceMedia(intentId, placeIds)` (`data/queries.ts`) fetch the route.
- The query is keyed by the intent and its sorted place ids (`mediaKeyIds`), so a stop the model adds starts a fetch. The last answer stays on screen while a new key loads.
- While any place is `pending`, it refetches every 2 seconds, up to ten times (`mediaPollInterval` in the pure `data/place-media.ts`).

**Reading.**

- `usePlaceAbout` and `usePlacePhotos` read the same query through the pure `placeAbout` and `placePhotos`.
- A slot is the value, `'pending'` (loading, or the lookup is running and the app is still polling) or null. `PhotoState` is `PlacePhoto | 'pending' | null`.

**The workspace.**

- The screen calls `usePlacePhotos` with every place in the plan (`mediaPlaceIds`), which starts the lookups when a plan is opened.
- It passes the result to every section as `SectionProps.photos`. Primitives still never call the API.

**Photos.**

- They render through `ui/place-photo.tsx`, a wrapper around `expo-image` (disk cache, 200 ms fade-in). It shows a `soft` tile while loading or when `uri` is null.
- They are decorative except the sheet's, which is labelled "Photo of {name}".
- Text and buttons drawn on a photo use the `photoScrim` and `photoInk` tokens, which are the same in both themes.

**Route cards** (`features/workspace/sections/route-section.tsx`).

- A stop with a photo, or whose photo may still come, is a card. Its 148pt photo (960px copy) has the stop number on it in a ringed 28pt badge, followed by the name, type and `why`, then the ↑↓ and day controls.
- A stop with no photo is the compact row.
- Each stop is one button ("Berlin, stop 1, 3 days. Show details") that reports `{ type: 'openPlace', placeId }`. The workspace pushes `/place` with `intentId` and `placeId`.

**Decision options** (`decision-section.tsx`).

- Each candidate's 500px photo goes to `ComparisonTable` as an optional column `photo`, shown 80pt tall above its name.
- When any candidate has one, or one may still come, every candidate gets the slot, with a soft tile where it has none, so the names stay aligned.

**Home** (`features/home/intent-card.tsx`).

- A card with photos shows a 108pt band of up to three tiles across its top.
- The pure `photoBand` in `features/home/photo-band.ts` puts "+N" on the last tile when the plan has more stops than photos. A plan with no photos looks as before.

**The sheet.**

- `apps/mobile/src/app/(app)/place.tsx` is an iOS form sheet and a modal on Android and web, with the + sheet's options.
- It reads the plan from `useIntent`'s cache, builds `stopDetails(snapshot, placeId)` (`features/workspace/stop-details.ts`, pure), and renders `PlaceSheet` (`features/place/place-sheet.tsx`).

`PlaceSheet` shows, top to bottom:

- **The photo and Done.** With a photo, the sheet opens on it, 244pt and edge to edge, with Done over it. The credit sits underneath, "Photo: {author}, {license}, via Wikimedia Commons" (`photoCredit`), as one link to the file's Commons page. Without one it opens on Done and the name. Done opens the plan when there's no history to go back to, as after a reload on web.
- **The name**, on the Nexui highlighter while unreviewed.
- **"{Type} in {Country}, the {nth} of {n} stops"**. `countryName` reads the bundled CLDR list in `lib/country-names.ts`, since Hermes has no `Intl.DisplayNames`.
- **Days here**, with the shared `DayStepper`, and **Daily cost**.
- **Why it's on your route.**
- **About {name}** (`usePlaceAbout`): "Looking up {name}…" while pending and the app is still polling; hidden with no article or once the polls run out. **Read more on Wikipedia** opens the article.
- **Next stop**, which swaps in that stop's details.
- **Where you'll stay**, or **Find a stay with Nexui**, which closes the sheet and opens + with "Find a stay in {name}".

Sheet behaviour:

- Links open with `Linking.openURL` through the sheet's `onOpenLink`.
- Day changes in the sheet go through the same `daysAction`, `capabilityFor`, `optimisticOps`, `rememberDays` and `UndoToast` as the route.
- A stop removed while its sheet is open shows "This stop is no longer on your route."

**Native builds.** `expo-image` is a native module (with its config plugin in `app.config.ts`), so photos need a dev client and preview build that include it.

## Checking it

**Automated tests:**

- `tests/place-media-key.test.mjs`: normalization, punctuation and rounding.
- `tests/place-media-rules.test.mjs`:
  - match rules: the radii, the title preference, no match out of range;
  - expiry: per status, `Retry-After`, freshness, pinned rows, lookup version 2;
  - photo rules: unsafe links, image names, `Artist` text, image formats, and `photoSource`'s licence, size and host rules (including `thumb.wikimedia.org`).
- `tests/place-media-photos.test.mjs`: request 2's parameters and parsing, `NonFree`, a missing file, and downloads (redirects refused, the format from the bytes, the 2 MB cap, throttles).
- `tests/place-media-lookup.test.mjs`:
  - the budget and `after()`, the 20-lookup cap, throttles (search and download);
  - a place twice, pinned rows, Wikipedia error answers;
  - the photo copy (paths, headers, credit), rejected images, a failed upload;
  - a failed cache write, no contact, and 100-key reads.
- `tests/media-route.test.mjs`: auth, ownership, cache hits and misses, the User-Agent, a 429, no contact, candidates, a cache failure, a bad contact, cached photos, and the contract's URL rules.
- `tests/intents-route.test.mjs`: Home's photos from the cache with no lookup, and a failed photo read.
- `tests/derive-trip.test.mjs`: each summary stop's key.
- The app's pure logic:
  - `tests/mobile-stop-details.test.mjs` and `tests/mobile-place-media.test.mjs`: the sheet's logic, the polling and photo slots;
  - `tests/mobile-format.test.mjs`: the credit line;
  - `tests/mobile-photo-band.test.mjs`: "+N".

**The live gate.** `node scripts/check-place-media.mjs` runs the lookup's match and photo rules against live Wikipedia and Commons, with no cache or storage writes. It downloads both sizes of each photo and prints a pass or fail per case. It needs `WIKIMEDIA_CONTACT` in the environment or `apps/api/.env.local`.

| Place                                                   | Expected                            |
| ------------------------------------------------------- | ----------------------------------- |
| Berlin, Hallstatt, Kyoto, the Dolomites                 | A photo                             |
| Springfield at Illinois' and Massachusetts' coordinates | The right Springfield article       |
| Lower Austria                                           | No photo (its lead image is a flag) |
| The Amalfi Coast                                        | Not the Duchy of Amalfi             |
