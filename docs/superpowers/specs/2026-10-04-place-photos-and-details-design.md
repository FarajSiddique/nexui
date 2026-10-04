# Place photos and stop details

**Status:** approved in conversation on 2026-10-04; awaiting review of this written spec.
**Adds to:** `2026-09-27-intent-graph-design.md` (the travel workspace and its route section).
**Mock:** the "Stop photos and details" canvas
(https://claude.ai/artifact/M4TaRaN8AmSbtw3xrFsc1g): Option B photo cards, the stop-details
sheet in light and dark, and the decision and Home placements.

Two features that share one Wikipedia lookup:

- **Stop details.** Tapping a stop on the route opens a sheet with everything about it: the full
  `why` (cut to two lines on the route today), a short Wikipedia introduction, days, cost, the
  next leg and where you'll stay.
- **Place photos.** Each stop shows a real photo of the place, found on Wikipedia by name and
  coordinates, copied once into our storage and credited. Photos also appear on decision options
  and Home plan cards.

## 0. Decisions made while brainstorming

| Topic            | Decision                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phasing          | One spec, two phases and two PRs. Phase 1: the lookup, cache and media route returning only the Wikipedia introduction, plus the stop sheet. Phase 2: photos.                |
| Route layout     | Option B: a full-width 148pt photo card per stop, with the stop number on the photo.                                                                                         |
| No photo         | A compact card with no photo area: number, name, type, `why`, controls.                                                                                                      |
| Other placements | Decision options (a photo above each candidate) and Home plan cards (a band of up to three photos). Not map pins: they crowd when stops are close, and web shows a list.     |
| Source           | English Wikipedia and Wikimedia Commons only. No stock-photo fallback in v1; the share of places with no photo decides whether one is added later.                           |
| Architecture     | A shared `place_media` cache keyed by place, joined on read by a media route. Plan data, Changes and Undo are untouched, and the model never writes a photo URL.             |
| Lookup timing    | Lazily, the first time anyone views a place: inline within a 6-second budget, finished in `after()` beyond it.                                                               |
| Delivery         | Photos are copied once into our Supabase Storage bucket at Wikimedia's standard 500px and 960px widths. The app never hotlinks Wikimedia.                                    |
| Access           | Only the API's secret-key client reads or writes the cache and uploads to the bucket (which anyone can read). A user can only trigger lookups for places in their own plans. |
| Wrong photos     | An operator fixes a row and pins it, which fixes it for every user. No in-app "report photo" in v1.                                                                          |
| Parked           | Map photo pins; a stock-photo fallback; an in-app report; non-English Wikipedia; tapping a decision candidate to open its sheet; Home photos for plans never opened.         |

## 1. Place key

`placeMediaKey(place)` in `packages/types/src/media.ts` turns a place into the cache key: its
name normalized (Unicode NFKD, diacritics removed, lower case, whitespace collapsed), its country
code, and its coordinates rounded to 0.1° (about 11 km).

```ts
placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 });
// 'cesky krumlov|CZ|48.8|14.3'
```

The same place in different plans shares one key, so Wikipedia is asked about Berlin once for
everyone. Two coordinates either side of a rounding boundary make two keys; that costs a second
lookup, nothing more. The API uses the key for the cache, and `derive.trip` stores it on each Home
summary stop (section 4).

## 2. Wikipedia lookup

`apps/api/src/lib/media/` holds the lookup: a small Wikipedia client, the match and photo rules
(pure, tested on their own), the cache, and the storage copy. Every request sends
`User-Agent: Nexui/1.0 (<WIKIMEDIA_CONTACT>)` and times out after 4 seconds.

**Request 1, the article.** One Action API call on `en.wikipedia.org` searches for the place's
name and returns the top 5 articles with their coordinates, lead image name and a three-sentence
plain-text introduction (`generator=search`, `gsrlimit=5`,
`prop=pageimages|coordinates|extracts`, `exintro`, `explaintext`, `exsentences=3`).

**Match rules.**

- Keep only articles with coordinates within 25 km of the place, or 75 km when its `placeType` is
  `region` or `area`.
- Prefer the article whose normalized title equals the normalized name, or starts with it
  followed by a comma (`Springfield, Illinois`). Otherwise take the nearest.
- No article in range means no match: the row is `none`, with no introduction and no photo. The
  lookup never guesses.

**Photo rules (phase 2).** The match's lead image is used when:

- the page-image API returned it, which limits it to freely licensed files by default;
- its file name doesn't end in `.svg` and doesn't name a flag, coat of arms (`coa`, `Wappen`),
  map, locator map, logo, seal or emblem;
- request 2 confirms a licence.

**Request 2, the credit (phase 2).** `prop=imageinfo` on the file with `iiurlwidth=960` and the
`Artist`, `LicenseShortName`, `LicenseUrl` and `NonFree` metadata. The author is the `Artist`
HTML reduced to plain text, at most 120 characters. A file with no licence name, or marked
non-free, is rejected. The 500px URL is the 960px one with the width replaced; both are standard
Wikimedia widths.

**Copy (phase 2).** Both sizes are downloaded (JPEG, PNG or WebP only, at most 2 MB each) and
uploaded to the `place-photos` bucket at
`<first 16 hex of sha256(key)>/<first 12 hex of sha256(bytes)>-<960|500>.<ext>`, with a one-year
`Cache-Control`. A path names its content, so a refresh writes new files and old URLs stay valid.

## 3. The `place_media` cache and storage

One migration in phase 1 creates the table with every column, so phase 2 changes no schema:

```sql
create table public.place_media (
  key            text primary key check (char_length(key) <= 200),
  status         text not null check (status in ('found', 'none', 'failed')),
  lookup_version int  not null,
  pinned         boolean not null default false,
  page_title     text,
  page_url       text,
  extract        text check (char_length(extract) <= 600),
  photo          jsonb,  -- { path, thumbPath, width, height }
  credit         jsonb,  -- { author, license, licenseUrl, sourceUrl }
  fetched_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
alter table public.place_media enable row level security;
revoke all on public.place_media from anon, authenticated;
```

- `found` means an article matched; `photo` may still be null (phase 1, or a rejected image).
  `none` means no article in range. `failed` means the lookup errored or was throttled.
- **Expiry:** `found` after 90 days, `none` after 30, `failed` after 15 minutes or the
  `Retry-After` time, whichever is later.
- **`lookup_version`:** the code's `LOOKUP_VERSION` is 1 in phase 1 and 2 in phase 2. A row with
  an older version counts as expired, so phase 1 rows gain photos on their next view after phase
  2 ships.
- **`pinned`:** refreshes skip a pinned row. An operator corrects a wrong match (for example,
  sets `status = 'none'` or swaps the photo) and pins it.
- RLS is on with no policies, and `anon` and `authenticated` hold no grants. Only the API's
  secret-key client (`getAdminClient`) reads and writes it, after the route has checked the plan
  belongs to the caller.

**Storage (phase 2).** A second migration creates the public `place-photos` bucket: public reads
through Supabase's CDN, `image/jpeg`, `image/png` and `image/webp` only, at most 2 MB per file.
Only the secret-key client uploads.

## 4. Media API

**`GET /api/intents/:id/media`** (`apps/api/src/app/api/intents/[id]/media/route.ts`,
`maxDuration = 30`). In the usual handler order:

1. `verifyRequest`.
2. Load the snapshot with the user's client. That is the ownership check; another user's plan
   is a 404.
3. Collect the snapshot's `place` objects, decision candidates included, and their keys.
4. Read their cache rows in one query with the secret-key client.
5. Look up the missing or expired keys, four at a time, within a 6-second budget, starting at
   most 20 lookups per request. Places whose lookup hasn't finished, or hasn't started, come back
   `pending`; started lookups carry on in `after()` and write the cache, and the rest start on the
   app's next request.

**Contract** (`packages/types/src/media.ts`):

```ts
const aboutSchema = z.strictObject({
  title: z.string().max(200),
  extract: z.string().max(600),
  url: z.url(), // the Wikipedia article
});

const photoSchema = z.strictObject({
  url: storageUrl, // 960px
  thumbUrl: storageUrl, // 500px
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  credit: z.strictObject({
    author: z.string().max(120),
    license: z.string().max(60),
    licenseUrl: z.url().optional(),
    sourceUrl: z.url(), // the Commons file page
  }),
});

const placeMediaSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    about: aboutSchema.nullable(),
    photo: photoSchema.nullable(),
  }),
  z.strictObject({ status: z.literal('pending') }),
]);

export const intentMediaSchema = z.strictObject({
  places: z.record(idSchema, placeMediaSchema),
});
```

The API builds photo URLs from `SUPABASE_URL` and the stored paths. `storageUrl` accepts only a
URL whose path starts `/storage/v1/object/public/place-photos/`, so nothing but our bucket can
appear as a photo. A `failed` row answers `ready` with `about` and
`photo` null, and the app shows the compact card.

**Home list photos (phase 2).**

- Each entry of `intentSummarySchema.strip` gains an optional `key` (`placeMediaKey`), written by
  `derive.trip`. It is optional because summaries saved before phase 2 don't have it until their
  plan's next changeset.
- `intentListItemSchema` gains `photos: z.array(storageUrl).max(3)`.
- `GET /api/intents` reads the cache rows for each plan's first three strip keys in one query and
  fills `photos` with their 500px URLs. It never looks anything up, so Home stays fast. A plan's
  places are looked up the first time it is opened, which is normally straight after its first run.

**Config.** `readMediaConfig(env = process.env)` reads `WIKIMEDIA_CONTACT`, an email address or
URL Wikimedia can reach us at, and is added to `apps/api/.env.example`. Without it, lookups are
off: the media route answers `ready` with `about` and `photo` null for any place not already
cached, and logs `[media] lookups are off` once.

**Safety.**

- The route only looks up places in the caller's own plans, so it can't be used to query
  Wikipedia freely, and one request starts at most 20 lookups.
- Wikipedia text never enters the graph or a model prompt. The app shows it as plain text.
- Logs carry the `[media]` tag, counts and HTTP status codes only: no place names, response
  bodies or URLs.

## 5. Mobile

**Data.** `getPlaceMedia` in `data/api.ts` and `usePlaceMedia(intentId, placeIds)` in
`data/queries.ts`, keyed by the intent and its sorted place ids, so a stop the model adds starts a
fetch. While any place is `pending`, it refetches every 2 seconds, up to 10 times. There is no new
Zustand state.

**Opening a stop.** A new `WorkspaceAction`, `{ type: 'openPlace'; placeId }`, which the workspace
screen turns into `router.push({ pathname: '/place', params: { intentId, placeId } })`. The `place`
screen (`app/(app)/place.tsx`, registered in `app/(app)/_layout.tsx` with the same options as
`compose`) is an iOS form sheet and a modal on Android and web. Its components live in
`features/place/`.

**The sheet (phase 1, photo in phase 2).** It reads the plan from `useIntent`'s cache and the
media from `usePlaceMedia`. Top to bottom:

- The photo with "Done" over it, and the credit underneath: "Photo: {author}, {license}, via
  Wikimedia Commons", linking to the file page (phase 2). Without a photo, the sheet starts at the
  name with a "Done" button.
- The name on the Nexui highlighter, then "{Type} in {Country}, the {nth} of {n} stops". The
  country name comes from `Intl.DisplayNames`, falling back to the code.
- **Days here** with the stepper, through the same capability call, optimistic op and Undo toast
  as the route. **Daily cost** shows when the place has `estDailyCost`.
- **Why it's on your route:** the full `why`, on the highlighter while unreviewed.
- **About {name}:** the Wikipedia introduction and "Read more on Wikipedia" (`Linking.openURL`).
  Hidden when `about` is null; a quiet placeholder line while `pending`.
- **Next stop:** the onward leg ("Train to Prague", "4h 15m, ≈ $40"). Tapping it shows that
  stop's details in place. Hidden on the last stop.
- **Where you'll stay:** the place's stays, or "No place to stay yet." and **Find a stay with
  Nexui**, which closes the sheet and opens + with "Find a stay in {name}".

**Route rows, phase 1.** The name, type and `why` become one button with a chevron that opens the
sheet. The ↑↓ and −/+ controls move to a line below it, which roughly doubles the text width.
This is the compact card, used for every stop until phase 2.

**Photo cards, phase 2** (`features/workspace/sections/route-section.tsx`). A stop with a photo
shows it full width at 148pt with the number badge, then the name, type and `why`, then the
controls. While its media is loading it shows a soft placeholder of the same height, so nothing
jumps. A stop with no photo keeps the compact card. Photos render through a new
`ui/place-photo.tsx`, which wraps `expo-image` (disk cache, fade-in, placeholder colour from the
theme).

**Decision options, phase 2.** `ComparisonTable` columns take an optional photo, shown 80pt tall
above the candidate's name. `decision-section.tsx` passes each candidate's photo when one exists.
Candidates aren't tappable in v1.

**Home cards, phase 2.** `features/home/intent-card.tsx` shows a 108pt band of `item.photos` (up
to three tiles) above the goal, with "+N" on the last tile when the plan has more stops than
photos shown. A plan with no photos looks as it does today.

**Native build.** `expo-image` is a native module: phase 2 needs a new dev client and a new EAS
preview build (`pnpm build:preview`).

**Accessibility.** Each stop row is one button labelled like "Berlin, stop 1, 3 days. Show
details". Photos on the route, in decisions and on Home are decorative; the sheet's photo is
described as "Photo of {name}". Targets stay at 44pt or more, and both themes use existing tokens.

## 6. Failures, scale and monitoring

- **Slow or failing Wikipedia.** A 429 or 503 caches the place as `failed` until `Retry-After` (at
  least 15 minutes) and stops the request starting new lookups. Other errors and timeouts cache
  `failed` for 15 minutes. The stop shows the compact card; nothing else waits on Wikipedia.
- **Storage failure.** A failed copy caches `failed`, so the whole lookup retries in 15 minutes,
  and a photo URL never points at a missing file.
- **Duplicate lookups.** Two requests can look up the same new place at once. Both upsert the same
  row and the paths name their content, so the extra copy is harmless; there is no lock.
- **Monitoring.** Each media request logs counts only, like
  `[media] looked up 3: 2 found, 1 none, 0 failed`. The share of `none` rows in `place_media` is
  the number that decides whether a stock-photo fallback is worth adding.
- **Scale.** Wikimedia sees about two requests per new place, however many people view it.
  Storage is about 300 KB per place with a photo. Photo traffic is about 100 GB a month at 5,000
  monthly users, inside Supabase Pro's included cached egress.
- **Licensing.** Each photo's credit is stored with it and shown in the sheet, which every photo on
  the route, in decisions and on Home leads to. A short legal check of that before launch is an
  open item.
- **Privacy.** Devices load photos only from our storage. They reach Wikimedia only through "Read
  more on Wikipedia".

## 7. Build order and checks

**Phase 1: stop details** (one PR)

1. `packages/types/src/media.ts`: `placeMediaKey`, `aboutSchema`, `placeMediaSchema` and
   `intentMediaSchema` (photo nullable and always null in phase 1).
2. The `place_media` migration. The user runs `pnpm db:push` on dev and prod.
3. `apps/api/src/lib/media/`: the Wikipedia client, match rules and cache, with
   `LOOKUP_VERSION = 1`; the media route; `WIKIMEDIA_CONTACT` in `.env.example`.
4. Mobile: `usePlaceMedia`, the `openPlace` action, the `place` sheet, the phase 1 route rows.
5. Docs: a new `docs/architecture/place-media.md`; env and route updates through `docs-keeper`.

**Phase 2: photos** (one PR)

1. Photo rules, the credit request and the storage copy; `LOOKUP_VERSION = 2`; the bucket
   migration.
2. `photo` in the media response; `key` on summary stops in `derive.trip`; `photos` on the Home
   list.
3. Mobile: `expo-image` and `ui/place-photo.tsx`, photo cards, decision photos, the Home band and
   the sheet photo with its credit. A new dev client and EAS preview build.

**Tests** (`node --test`; Wikipedia and storage stubbed through `globalThis.fetch` like the
existing route tests):

- `tests/place-media-key.test.mjs`: diacritics, case, whitespace and rounding.
- `tests/place-media-rules.test.mjs`: the 25 km and 75 km radii, the exact-title preference, no
  match out of range, rejected image names (SVG, flag, coat of arms, map, logo), the `Artist`
  HTML reduced to text, expiry per status, and an older `lookup_version` counting as expired.
- `tests/media-route.test.mjs`: 401 without a token; 404 for another user's plan; a cache hit
  makes no Wikipedia call; a miss calls Wikipedia with the User-Agent and writes the row; a
  timeout answers `pending`; a 429 caches `failed` until `Retry-After`; no `WIKIMEDIA_CONTACT`
  means no calls; the schema rejects a photo URL outside the bucket.
- Phase 2: the Home list fills `photos` from the cache without calling Wikipedia;
  `tests/derive-trip.test.mjs` checks each strip entry's `key`.

**Live check.** `node scripts/check-place-media.mjs` runs the lookup's match and photo rules
against live Wikipedia, with no storage writes, and prints a pass or fail per case: Berlin and
Hallstatt get photos; Springfield at Illinois' and Massachusetts' coordinates matches each; Lower
Austria gets no photo; the Amalfi Coast doesn't match the Duchy of Amalfi; Kyoto and the
Dolomites get photos. Like `pnpm eval:travel`, it is a manual gate, not part of `pnpm test`.

**Smoke test** on the iOS simulator and Expo web, as the QA user:

- Phase 1: open the sheet from each stop; change days there and undo; follow Next stop; Read
  more opens Wikipedia; Find a stay opens + with the prompt; light and dark.
- Phase 2: photo cards loading, found and none (Lower Austria); the sheet photo and its credit
  link; decision candidate photos; the Home band with "+N".

**Reviews.** `api-reviewer`, `mobile-reviewer` and `security-reviewer` (a new route, the
secret-key client and outbound calls) before each handoff, then `docs-keeper`.

**Done when.** Phase 1: every stop opens its sheet on iOS and web, Berlin shows its Wikipedia
introduction, and `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check` pass. Phase
2: the live check passes all eight cases, and the route, decisions, Home and the sheet show photos
with credits on iOS and web, with the compact card where there is none.
