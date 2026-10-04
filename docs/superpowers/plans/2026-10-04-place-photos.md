# Place Photos (Phase 2 of Place Photos and Stop Details) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every route stop, decision candidate and Home plan card shows a real photo of its place, found on Wikipedia, copied once into our Supabase Storage and credited in the stop sheet. A place with no usable photo keeps the compact card.

**Architecture:** Phase 1's lookup gains Wikipedia's photo rules. When the matched article has a lead image that passes the name rules, request 2 asks Commons for its 960px thumbnail and licence. The two sizes, 960px and 500px, are downloaded and uploaded to a public `place-photos` bucket at paths named by their content. The paths and credit are stored on the existing `place_media` row, and `LOOKUP_VERSION` becomes 2, so phase 1 rows are looked up again. The media route turns stored paths into bucket URLs.

Home gets photos without any lookup:

- `derive.trip` writes each summary stop's media key.
- `GET /api/intents` reads the cache rows for each card's first three keys.

On mobile, `expo-image` renders photos through one `ui/place-photo.tsx`. The workspace passes each place's photo state to its sections. Route stops become 148pt photo cards, decision candidates get 80pt photos, the stop sheet opens on its photo with a credit link, and Home cards show a 108pt band.

**Tech Stack:**

- Next.js 16 route handlers with `after()`.
- Supabase Postgres and Storage through supabase-js 2.117.
- The MediaWiki Action API on `en.wikipedia.org` and `commons.wikimedia.org`.
- `upload.wikimedia.org` thumbnails.
- Zod 4 contracts in `@nexui/types`.
- Expo SDK 57 with `expo-image`, Expo Router and TanStack Query 5.
- Node 24's test runner with type stripping.

**Spec:** `docs/superpowers/specs/2026-10-04-place-photos-and-details-design.md`, phase 2 (section 7). Phase 1's plan is `docs/superpowers/plans/2026-10-04-place-details.md`, and what phase 1 built is described in `docs/architecture/place-media.md`. Read the spec and that doc.

## Global Constraints

- **Tooling:**
  - Node.js 24, pnpm 10.34.5. Run every command from the worktree root.
  - A single test file runs with `node --experimental-strip-types --test tests/<file>.test.mjs`.
- **Source:** the lead image comes from English Wikipedia's page-image API (free files only, by default). Its credit and thumbnail come from Wikimedia Commons. Every request sends `User-Agent: Nexui/1.0 (<WIKIMEDIA_CONTACT>)` and times out after 4 seconds. There is no stock-photo fallback.
- **Photo rules (verbatim):** the lead image is used when:
  - the page-image API returned it;
  - its file name doesn't end in `.svg` and doesn't name a flag, coat of arms (`coa`, `Wappen`), map, locator map, logo, seal or emblem;
  - request 2 confirms a licence.

  A file with no licence name, or marked non-free, is rejected. The author is the `Artist` HTML reduced to plain text, at most 120 characters.

- **Copy (verbatim):**
  - Both sizes are downloaded, JPEG, PNG or WebP only, at most 2 MB each.
  - They are uploaded to `place-photos` at `<first 16 hex of sha256(key)>/<first 12 hex of sha256(bytes)>-<960|500>.<ext>`, with a one-year `Cache-Control`.
  - The 500px URL is the 960px one with the width replaced.
- **Versioning:** `LOOKUP_VERSION = 2`. The `place_media` schema doesn't change; the `photo` and `credit` columns already exist.
- **Failures:**
  - A storage failure caches `failed`, so the whole lookup retries in 15 minutes, and a photo URL never points at a missing file.
  - A 429 or 503 from any Wikimedia host caches `failed` until `Retry-After` (at least 15 minutes) and stops the request starting new lookups.
- **Access:**
  - Only `getAdminClient()` reads `place_media` or uploads to the bucket.
  - The bucket is public for reads, `image/jpeg`, `image/png` and `image/webp` only, at most 2 MB per file, with no policies.
  - The app loads photos only from our bucket. `storageUrlSchema` accepts only `https` URLs under `/storage/v1/object/public/place-photos/`.
- **Home:**
  - `GET /api/intents` never looks anything up. It reads the cache rows for each card's first three strip keys and fills `photos` (at most three) with 500px URLs.
  - A summary saved before phase 2 has no keys until its plan's next changeset.
- **Safety:** logs carry the `[media]` tag, counts and HTTP status codes only: no place names, file names, response bodies or URLs. Wikipedia and Commons text never enters the graph or a model prompt.
- **Mobile:**
  - Primitives never call the API. Section components get their props, including the new `photos`, and report a `WorkspaceAction`. Only screens use query hooks.
  - Pure mobile modules (`data/place-media.ts`, `lib/format.ts`, `features/home/photo-band.ts`) import no `react-native` or `expo-*`. They import siblings with `.ts` paths, so `tests/mobile-*.test.mjs` load them under Node.
  - Colors come only from tokens (`createThemedStyles`, `useColors`); `tests/theme-tokens.test.mjs` forbids raw colors outside `theme.ts`. Touch targets stay 44pt or more.
- **Sizes (from the spec and the mock):**

  | Where            | Size and shape                                                                                         |
  | ---------------- | ------------------------------------------------------------------------------------------------------ |
  | Route card photo | 148pt tall, full width, radius 16. The stop number sits on it: a 28pt circle at 10/10 with a 2pt ring. |
  | Decision photo   | 80pt tall, radius 8, above the candidate's name.                                                       |
  | Home band        | 108pt tall, up to three tiles with 2pt gaps; "+N" on the last tile.                                    |
  | Stop sheet photo | 244pt tall, edge to edge, "Done" over it.                                                              |

- **Copy (verbatim):**
  - "Photo: {author}, {license}, via Wikimedia Commons", linking to the file page.
  - "Photo of {name}" for the sheet's photo. Route, decision and Home photos are decorative.
  - "+N".
  - The stop row's label stays "Berlin, stop 1, 3 days. Show details".
- **Native:** `expo-image` is a native module, so phase 2 needs a new dev client and a new EAS preview build (`pnpm build:preview`, the user's to run).
- **Style:**
  - Strict TypeScript with `noUncheckedIndexedAccess`.
  - Braces on every `if`, `else` and loop.
  - A blank line before `return`, after blocks and after declaration groups.
  - Explicit parameter and return types on exported functions.
  - No nested ternaries; kebab-case filenames.
  - `.claude/hooks/format.sh` runs Prettier and ESLint after each edit; run `pnpm fix` before each commit anyway.
- **Every task** keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` passing.
- **Commit messages:** a concise imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The user runs these:**
  - `pnpm db:push` (agents are refused it): the bucket migration on dev before the smoke test, and on prod before the API deploys.
  - The EAS preview build.
  - Pushing the branch and opening the draft PR are covered by the session's instructions.

## Decisions this plan makes (flagged for review)

1. **Request 2 asks Commons' API** (`commons.wikimedia.org/w/api.php`), not English Wikipedia's.
   - Cost: a free file stored only on English Wikipedia comes back missing and gets no photo.
   - Benefit: every credit truthfully says "via Wikimedia Commons" and links to a Commons page.
2. **A photo needs a 960px thumbnail.** MediaWiki returns the original instead of a thumbnail when the original is narrower, so an image under 960px gets no photo. It would look soft on a full-width card anyway.
3. **Rejected content is "no photo", not a failure.**
   - A download that isn't a JPEG, PNG or WebP by its first bytes, or is over 2 MB, leaves the row `found` with no photo for 90 days.
   - Network errors, HTTP errors and storage errors cache `failed` (15 minutes), as the spec says for storage.
4. **The server only fetches Wikimedia URLs.**
   - Download URLs must be `https://upload.wikimedia.org/…` and the file page `https://commons.wikimedia.org/…`.
   - Image downloads use `redirect: 'error'`, so a changed API answer can't make the server fetch anything else.
5. **The file type is read from the bytes** (JPEG, PNG and WebP magic numbers), not the `Content-Type` header, and it names the file extension.
6. **A missing `Artist` gives an empty author.** The credit then reads "Photo: Public domain, via Wikimedia Commons". A `NonFree` value other than `false` counts as non-free.
7. **The image name rules match whole words** (`flag`, `flags`, `map`, `maps`, `locator`, `logo`, `logos`, `seal`, `emblem`, `coa`), plus the phrase "coat of arms" and the substring `wappen` (German compounds).
   - "Flagstaff" and "Mapleton" pass.
   - Cost: "Seal_Beach_Pier.jpg" is rejected; that place gets no photo.
8. **Photo sizes:**
   - Route cards and the sheet use the 960px copy (a full-width card is about 1,000 device pixels).
   - Decisions and Home use 500px.
9. **Decision photos align.** When any candidate has a photo, or one may still come, every candidate gets the 80pt slot, with a soft tile where it has none, so the names stay in one row.
10. **Two new theme tokens, `photoScrim` and `photoInk`**, the same in both themes, for text and buttons drawn on photos ("Done" on the sheet, "+N" on Home). Photos look the same in both themes, so what sits on them should too. The stop number on a route photo keeps `userMark`, with a `card`-colored ring.
11. **The sheet shows a soft 244pt placeholder** while its photo may still arrive, as route cards do. This only happens when the sheet opens before the workspace's media answer.
12. **`readRows` asks for at most 100 keys per query.** A PostgREST filter rides in the URL, and Home can ask for up to 300 keys (100 plans × 3). It is usually still one query.
13. **Home never fails because of photos.**
    - A failed cache read logs `[media] Could not load Home photos (<code>).` and the cards come back without photos.
    - Home uses any cached row with a photo, even an expired one, since stored files never move.
14. **The sheet's link callback is renamed.** `onReadMore` becomes `onOpenLink`, used for "Read more on Wikipedia" and the credit, which is one link button at least 44pt tall.
15. **The live check also downloads both sizes** (no storage writes), to confirm each photo is an image we'd accept.
16. **`maxDuration` stays 30.** A lookup now makes up to six requests. One cut off by the time limit writes no row, so it is simply looked up again on the next request.
17. **Deploy order matters for the old iOS build.** The old preview build's strict summary schema rejects the new `key` on strip stops.
    - Once a plan changes after the API deploys, Home on the old build fails to load.
    - Install the new preview build (needed anyway for `expo-image`) when the API deploys.
    - No compatibility path is added (AGENTS.md: no paths for older clients).

## Review Focus

1. **A Commons answer pointing off Wikimedia**: a thumbnail on another host or over `http`, or a file page off Commons. Expected: no photo, and no download is attempted. Pinned by Task 2's `photoSource` test.
2. **Lead images that are symbols under varied names**: "Flag_of_Lower_Austria.svg", "Niederösterreich_Wappen.png", "DEU_Berlin_COA.png", "Locator_map_Kyoto.png", "Lower_Austria_location_map.png". Expected: rejected, while "Flagstaff_downtown.jpg" passes. Pinned by Task 2's `isUsableImage` test.
3. **An upload failing halfway** (the 960px copy stored, the 500px one refused). Expected: the place is cached `failed` with no photo, and the retry writes the same content-named paths. Pinned by Task 4's failed-upload test.
4. **A download that lies**: HTML or GIF bytes sent as `image/jpeg`, or a body over 2 MB. Expected: the row stays `found` with its introduction and no photo, and nothing is uploaded. Pinned by Task 3's download tests and Task 4's rejected-image test.
5. **Home cards whose stops lack photos or keys**: the first stop has none, or the summary predates phase 2. Expected: the other photos with the right "+N", or no band and no cache query at all. Pinned by Task 6's Home route test and Task 7's `photoBand` test.

---

## File Structure

```
supabase/migrations/20261004150000_place_photos_bucket.sql   (create) public place-photos bucket
packages/types/src/media.ts                          (modify) photoCreditSchema, PhotoCredit
packages/types/src/graph.ts                          (modify) strip stops' optional `key`
packages/types/src/api.ts                            (modify) list items' `photos`
apps/api/src/lib/media/rules.ts                      (modify) LOOKUP_VERSION 2, photo rules, rows with photos
apps/api/src/lib/media/wikipedia.ts                  (modify) send(), fileInfo() (request 2), downloadImage()
apps/api/src/lib/media/storage.ts                    (create) copyPhoto, photoPath, publicPhotoUrl, PhotoStorageError
apps/api/src/lib/media/cache.ts                      (modify) photo and credit columns; 100 keys per query
apps/api/src/lib/media/lookup.ts                     (modify) findPhoto in each lookup; bucket URLs in answers
apps/api/src/lib/media/home.ts                       (create) withHomePhotos
apps/api/src/lib/media/index.ts                      (modify) export withHomePhotos
apps/api/src/lib/kinds/trip.ts                       (modify) strip stops carry placeMediaKey
apps/api/src/lib/graph/mappers.ts                    (modify) list items start with photos: []
apps/api/src/app/api/intents/route.ts                (modify) GET fills photos
apps/api/src/lib/supabase/clients.ts, README.md      (modify) admin client comment
scripts/check-place-media.mjs                        (modify) photo expectations
apps/mobile/package.json, pnpm-lock.yaml             (modify) expo-image
apps/mobile/src/theme/theme.ts                       (modify) photoScrim, photoInk
apps/mobile/src/ui/place-photo.tsx, ui/index.ts      (create/modify) PlacePhoto
apps/mobile/src/data/place-media.ts                  (modify) PhotoState, placePhoto, placePhotos
apps/mobile/src/data/queries.ts, data/index.ts       (modify) usePlacePhotos
apps/mobile/src/lib/format.ts, lib/index.ts          (modify) photoCredit
apps/mobile/src/features/home/photo-band.ts          (create) photoBand (pure)
apps/mobile/src/features/home/intent-card.tsx        (modify) the photo band
apps/mobile/src/features/workspace/sections/types.ts (modify) SectionProps.photos
apps/mobile/src/features/workspace/sections/registry.tsx (modify) SectionView passes photos
apps/mobile/src/features/workspace/sections/route-section.tsx (modify) photo cards
apps/mobile/src/features/workspace/sections/comparison-table.tsx (modify) optional column photos
apps/mobile/src/features/workspace/sections/decision-section.tsx (modify) candidate photos
apps/mobile/src/features/place/place-sheet.tsx       (modify) photo header and credit
apps/mobile/src/app/(app)/place.tsx                  (modify) passes the photo
apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx (modify) usePlacePhotos → sections
docs/architecture/place-media.md, docs/architecture/mobile.md (modify) phase 2
tests/place-media-migration.test.mjs                 (modify) bucket checks
tests/place-media-rules.test.mjs                     (modify) photo rules
tests/place-media-photos.test.mjs                    (create) request 2 and downloads
tests/place-media-lookup.test.mjs                    (modify) copy, failures, chunked reads
tests/media-route.test.mjs                           (modify) photos in answers; version 2
tests/support/media.mjs                              (modify) Commons, image and storage stand-ins
tests/support/graph.mjs                              (modify) strip keys on the fixture intent
tests/graph-contracts.test.mjs                       (modify) strip key and photos contract
tests/derive-trip.test.mjs                           (modify) strip keys
tests/intents-route.test.mjs                         (modify) Home photos
tests/theme-tokens.test.mjs                          (modify) new tokens
tests/mobile-place-media.test.mjs, tests/mobile-format.test.mjs (modify) photo state, credit
tests/mobile-photo-band.test.mjs                     (create) photoBand
```

---

### Task 1: The `place-photos` bucket

**Files:**

- Create: `supabase/migrations/20261004150000_place_photos_bucket.sql`
- Modify: `tests/place-media-migration.test.mjs`

**Interfaces:**

- Consumes: nothing.
- Produces: the public bucket `place-photos`, which Task 4 uploads to and Task 6 reads URLs from.

- [ ] **Step 1: Write the failing test**

Append to `tests/place-media-migration.test.mjs`:

```js
const bucket = readFileSync('supabase/migrations/20261004150000_place_photos_bucket.sql', 'utf8');

test('place-photos is a public bucket of JPEG, PNG and WebP files up to 2 MB', () => {
  assert.match(
    bucket,
    /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/,
  );
  assert.match(bucket, /'place-photos', 'place-photos', true, 2097152,/);
  assert.match(bucket, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(bucket, /on conflict \(id\) do update/);
});

test('no policy lets an app user list, upload or change photos', () => {
  assert.doesNotMatch(bucket, /create policy/i);
  assert.doesNotMatch(bucket, /\bgrant\b/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/place-media-migration.test.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open 'supabase/migrations/20261004150000_place_photos_bucket.sql'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261004150000_place_photos_bucket.sql`:

```sql
-- The public bucket for place photos (docs/architecture/place-media.md). The API copies each
-- photo here once from Wikimedia Commons at 960px and 500px, so devices never load Wikimedia.
-- Anyone can read a file by its public URL through Supabase's CDN. There are no policies, so app
-- users can't list, upload or change files; only the API's secret-key client writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --experimental-strip-types --test tests/place-media-migration.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit, and tell the user the migration needs pushing**

```bash
git add supabase/migrations/20261004150000_place_photos_bucket.sql tests/place-media-migration.test.mjs
git commit -m "Add the public place-photos bucket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

In the progress message, tell the user: the smoke test in Task 11 needs this bucket on dev. They should run, from the main checkout linked to dev, `git fetch origin place-photos` and then `pnpm db:push` with this branch's migration. Alternatively they can wait until Task 11 asks. Keep working either way.

---

### Task 2: The photo rules

**Files:**

- Modify: `packages/types/src/media.ts`
- Modify: `apps/api/src/lib/media/rules.ts`
- Modify: `tests/place-media-rules.test.mjs`

**Interfaces:**

- Consumes: phase 1's `rules.ts` (`MediaRow`, `lookupRow`, `toPlaceMedia`, `clipExtract`).
- Produces:
  - In `@nexui/types`: `photoCreditSchema`; `type PhotoCredit = { author: string; license: string; licenseUrl?: string; sourceUrl: string }`.
  - In `rules.ts`:
    - `LOOKUP_VERSION = 2`.
    - `type ImageType = 'jpg' | 'png' | 'webp'` and `PHOTO_TYPES: Record<ImageType, string>`.
    - `interface StoredPhoto { path: string; thumbPath: string; width: number; height: number }`.
    - `interface CopiedPhoto { photo: StoredPhoto; credit: PhotoCredit }`.
    - `interface FileInfo { thumbUrl: string; thumbWidth: number; thumbHeight: number; pageUrl: string; artist: string | null; license: string | null; licenseUrl: string | null; nonFree: boolean }`.
    - `interface PhotoSource { url: string; thumbUrl: string; width: number; height: number; credit: PhotoCredit }`.
    - `MediaRow` gains `photo: StoredPhoto | null` and `credit: PhotoCredit | null`.
    - `isUsableImage(file: string): boolean`, `plainText(html: string): string`, `imageType(bytes: Uint8Array): ImageType | null` and `photoSource(info: FileInfo): PhotoSource | null`.
    - `lookupRow(key: string, match: Article | null, now: Date, copied?: CopiedPhoto | null): MediaRow`.
    - `toPlaceMedia(row: MediaRow, photoUrl: (path: string) => string): PlaceMedia`.

- [ ] **Step 1: Write the failing tests**

In `tests/place-media-rules.test.mjs`:

1. Extend the import from `../apps/api/src/lib/media/rules.ts` with `imageType`, `isUsableImage`, `photoSource` and `plainText`.
2. Add these helpers below the existing `region` constant:

```js
// URLs in our bucket, as `publicPhotoUrl` builds them.
const bucketUrl = (path) => `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`;

// What request 2 says about a usable file, with overrides.
const fileInfo = (overrides = {}) => ({
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
  thumbWidth: 960,
  thumbHeight: 640,
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
  artist: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  nonFree: false,
  ...overrides,
});
```

3. `toPlaceMedia` now takes a URL builder. Change each existing `toPlaceMedia(x)` call to `toPlaceMedia(x, bucketUrl)`. There are four: three in "a found row carries the article…" and one in "an introduction is cut…".
4. Append:

```js
test('phase 2 rows are version 2, so phase 1 rows are looked up again', () => {
  const row = lookupRow('k', north('Hallstatt', town, 1), NOW);

  assert.equal(LOOKUP_VERSION, 2);
  assert.equal(isFresh({ ...row, lookupVersion: 1 }, NOW), false);
});

test('a lead image must look like a photo: no SVG, flag, coat of arms, map, logo, seal or emblem', () => {
  for (const file of [
    'Museumsinsel_Berlin.jpg',
    'Hallstatt_300.jpg',
    'Flagstaff_downtown.jpg',
    'Mapleton_Main_Street.JPG',
  ]) {
    assert.equal(isUsableImage(file), true, file);
  }

  for (const file of [
    'Berlin_skyline.svg',
    'Flag_of_Lower_Austria.svg',
    'Flag of Kenya.png',
    'Coat_of_arms_of_Berlin.png',
    'DEU_Berlin_COA.png',
    'Niederösterreich_Wappen.png',
    'Lower_Austria_location_map.png',
    'Locator_map_Kyoto.png',
    'Tuscany_Map.jpg',
    'Kyoto_city_logo.png',
    'Seal_of_Springfield.png',
    'Emblem_of_Kyoto.png',
  ]) {
    assert.equal(isUsableImage(file), false, file);
  }
});

test('the Artist HTML becomes plain text of at most 120 characters', () => {
  assert.equal(
    plainText(
      '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue" title="User:Kasa Fue">Kasa Fue</a>',
    ),
    'Kasa Fue',
  );
  assert.equal(
    plainText('<span class="fn"><bdi>Jane &amp; John&nbsp;Doe</bdi></span>, own work'),
    'Jane & John Doe, own work',
  );
  assert.equal(plainText('Caf&#233; &#x263A; &bogus;'), 'Café ☺ &bogus;');

  const long = plainText(`<b>${'name '.repeat(40)}</b>`);

  assert.ok(long.length <= 120);
  assert.ok(long.endsWith('name…'));
});

test('the image format comes from its first bytes, never its name or header', () => {
  const text = (value) => new TextEncoder().encode(value);

  assert.equal(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(imageType(text('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(imageType(text('<html></html>')), null);
  assert.equal(imageType(text('GIF89a')), null);
  assert.equal(imageType(new Uint8Array()), null);
});

test('request 2 gives a photo its two sizes and its credit', () => {
  assert.deepEqual(photoSource(fileInfo()), {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
    thumbUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/500px-Berlin.jpg',
    width: 960,
    height: 640,
    credit: {
      author: 'Kasa Fue',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  });
  assert.equal(
    photoSource(fileInfo({ licenseUrl: '//creativecommons.org/publicdomain/zero/1.0/' })).credit
      .licenseUrl,
    'https://creativecommons.org/publicdomain/zero/1.0/',
  );
  assert.deepEqual(
    photoSource(fileInfo({ artist: null, license: 'Public domain', licenseUrl: null })).credit,
    {
      author: '',
      license: 'Public domain',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  );
});

test('no licence, a non-free file, a small original or a link off Wikimedia means no photo', () => {
  for (const overrides of [
    { license: null },
    { license: '   ' },
    { nonFree: true },
    {
      thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Berlin.jpg',
      thumbWidth: 640,
    },
    { thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Berlin.jpg' },
    { thumbUrl: 'https://example.com/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg' },
    {
      thumbUrl:
        'http://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
    },
    { pageUrl: 'https://en.wikipedia.org/wiki/File:Berlin.jpg' },
    { thumbHeight: 0 },
  ]) {
    assert.equal(photoSource(fileInfo(overrides)), null, JSON.stringify(overrides));
  }
});

test('a found row with a stored photo answers with our URLs; anything else has no photo', () => {
  const copied = {
    photo: { path: 'a/b-960.jpg', thumbPath: 'a/b-500.jpg', width: 960, height: 640 },
    credit: photoSource(fileInfo()).credit,
  };
  const row = lookupRow('k', north('Hallstatt', town, 1), NOW, copied);

  assert.deepEqual(row.photo, copied.photo);
  assert.deepEqual(toPlaceMedia(row, bucketUrl).photo, {
    url: bucketUrl('a/b-960.jpg'),
    thumbUrl: bucketUrl('a/b-500.jpg'),
    width: 960,
    height: 640,
    credit: copied.credit,
  });
  assert.equal(
    toPlaceMedia(
      row,
      (path) => `http://127.0.0.1:54321/storage/v1/object/public/place-photos/${path}`,
    ).photo,
    null,
    'a URL the contract rejects drops the photo, not the answer',
  );
  assert.equal(toPlaceMedia({ ...row, status: 'none' }, bucketUrl).photo, null);
  assert.equal(toPlaceMedia({ ...row, credit: null }, bucketUrl).photo, null);
  assert.equal(lookupRow('k', null, NOW).photo, null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/place-media-rules.test.mjs`
Expected: FAIL with `SyntaxError: The requested module '../apps/api/src/lib/media/rules.ts' does not provide an export named 'imageType'`.

- [ ] **Step 3: Add the credit schema to the contract**

In `packages/types/src/media.ts`, replace `photoSchema` with:

```ts
/** Who made a photo and under which licence, shown under it in the stop sheet. */
export const photoCreditSchema = z.strictObject({
  author: z.string().max(120),
  license: z.string().max(60),
  licenseUrl: z.url({ protocol: /^https?$/ }).optional(),
  // The file's page on Commons.
  sourceUrl: z.url({ protocol: /^https$/, hostname: /^commons\.wikimedia\.org$/ }),
});

export const photoSchema = z.strictObject({
  url: storageUrlSchema, // 960px
  thumbUrl: storageUrlSchema, // 500px
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  credit: photoCreditSchema,
});
```

Next to the other type exports at the bottom, add:

```ts
export type PhotoCredit = z.infer<typeof photoCreditSchema>;
```

- [ ] **Step 4: Add the rules**

In `apps/api/src/lib/media/rules.ts`:

1. Replace the import and `LOOKUP_VERSION`:

```ts
import {
  aboutSchema,
  normalizePlaceName,
  photoCreditSchema,
  photoSchema,
  type PhotoCredit,
  type PlaceData,
  type PlaceMedia,
} from '@nexui/types';

/** Bumped when the lookup changes what it stores; rows from an older version count as expired. */
export const LOOKUP_VERSION = 2;
```

2. After the `Article` interface, add:

```ts
/** An image format we copy, named by its file extension. */
export type ImageType = 'jpg' | 'png' | 'webp';

/** Each format's content type, for the upload. */
export const PHOTO_TYPES: Record<ImageType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** A copied photo as `place_media.photo` holds it: paths in the `place-photos` bucket. */
export interface StoredPhoto {
  /** The 960px copy. */
  path: string;
  /** The 500px copy. */
  thumbPath: string;
  width: number;
  height: number;
}

/** What a lookup adds to a `found` row when its photo was copied. */
export interface CopiedPhoto {
  photo: StoredPhoto;
  credit: PhotoCredit;
}

/** What Commons says about a lead image (request 2), before any rule is applied. */
export interface FileInfo {
  /** The 960px thumbnail, or the original when that is narrower. */
  thumbUrl: string;
  thumbWidth: number;
  thumbHeight: number;
  /** The file's description page. */
  pageUrl: string;
  /** `Artist`, as HTML. */
  artist: string | null;
  license: string | null;
  licenseUrl: string | null;
  nonFree: boolean;
}

/** A photo that passed the rules: where to download its two sizes, and its credit. */
export interface PhotoSource {
  /** 960px. */
  url: string;
  /** 500px. */
  thumbUrl: string;
  width: number;
  height: number;
  credit: PhotoCredit;
}
```

3. In `MediaRow`, between `extract` and `expiresAt`, add:

```ts
/** The copied photo, or null: no usable lead image, a rejected file, or not `found`. */
photo: StoredPhoto | null;
credit: PhotoCredit | null;
```

4. After `const MAX_EXTRACT = 600;`, add:

```ts
const MAX_AUTHOR = 120;
const MAX_LICENSE = 60;
const THUMB_WIDTH = 960;

// Words in a lead image's file name that mark a symbol or a map, not a photo of the place.
const NOT_A_PHOTO = new Set([
  'flag',
  'flags',
  'map',
  'maps',
  'locator',
  'logo',
  'logos',
  'seal',
  'emblem',
  'coa',
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
```

5. Replace `clipExtract` with a shared `clip` and a `clipExtract` that uses it:

```ts
// Text on one line, cut at a word to `max` characters with an ellipsis.
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (clean.length <= max) {
    return clean;
  }

  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An introduction on one line, cut to 600 characters at a word with an ellipsis. */
export function clipExtract(text: string): string {
  return clip(text, MAX_EXTRACT);
}
```

6. After `articleUrl`, add the photo rules:

```ts
/**
 * True when a lead image's file name can be a photo (spec section 2): not an SVG, and not
 * named as a flag, coat of arms (`coa`, `Wappen`), map, locator map, logo, seal or emblem.
 * Words match whole, so 'Flagstaff' passes; `wappen` matches inside German compounds.
 *
 * @example
 * isUsableImage('Museumsinsel_Berlin.jpg') // true
 * isUsableImage('Coat_of_arms_of_Berlin.png') // false
 */
export function isUsableImage(file: string): boolean {
  const name = file.toLowerCase();

  if (name.endsWith('.svg') || name.includes('wappen') || /coat[\s_-]+of[\s_-]+arms/.test(name)) {
    return false;
  }

  const words = name.replace(/\.[a-z0-9]+$/, '').split(/[^\p{L}\p{N}]+/u);

  return !words.some((word) => NOT_A_PHOTO.has(word));
}

// One HTML entity as text; an unknown one stays as written.
function decodeEntity(entity: string, name: string): string {
  if (name.startsWith('#')) {
    const hex = name[1]?.toLowerCase() === 'x';
    const code = hex ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  }

  return ENTITIES[name.toLowerCase()] ?? entity;
}

/**
 * Commons' `Artist` HTML as plain text on one line, at most 120 characters: tags dropped and
 * entities decoded.
 *
 * @example
 * plainText('<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>') // 'Kasa Fue'
 */
export function plainText(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => decodeEntity(entity, name))
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:])/g, '$1');

  return clip(text, MAX_AUTHOR);
}

/**
 * The image format from a file's first bytes: JPEG, PNG or WebP, else null.
 *
 * @example imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])) // 'jpg'
 */
export function imageType(bytes: Uint8Array): ImageType | null {
  const text = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to));

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }

  if (text(0, 8) === '\x89PNG\r\n\x1a\n') {
    return 'png';
  }

  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    return 'webp';
  }

  return null;
}

// The URL when it's https on that host, else null.
function httpsOn(value: string, host: string): URL | null {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname === host ? url : null;
  } catch {
    return null;
  }
}

// A licence link as an http(s) URL; Commons sometimes leaves off the scheme.
function licenseLink(value: string | null): string | null {
  const raw = value?.trim() ?? '';

  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The photo that request 2 describes, or null when it fails the rules (spec section 2). It needs:
 * - a licence that isn't marked non-free;
 * - a 960px thumbnail on upload.wikimedia.org;
 * - a file page on Commons.
 *
 * The 500px URL is the 960px one with the width replaced; both are standard Wikimedia widths.
 *
 * @example
 * photoSource(info)?.thumbUrl
 * // 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/500px-Berlin.jpg'
 */
export function photoSource(info: FileInfo): PhotoSource | null {
  const license = clip(info.license ?? '', MAX_LICENSE);
  const large = httpsOn(info.thumbUrl, 'upload.wikimedia.org');
  const page = httpsOn(info.pageUrl, 'commons.wikimedia.org');
  const height = info.thumbHeight;

  if (info.nonFree || license.length === 0 || !large || !page) {
    return null;
  }

  if (info.thumbWidth !== THUMB_WIDTH || !Number.isInteger(height) || height <= 0) {
    return null;
  }

  // A narrower original comes back as itself, with no width in its URL.
  const small = large.href.replace(/\/960px-([^/]+)$/, '/500px-$1');

  if (small === large.href) {
    return null;
  }

  const credit: PhotoCredit = {
    author: plainText(info.artist ?? ''),
    license,
    sourceUrl: page.href,
  };
  const licenseUrl = licenseLink(info.licenseUrl);

  if (licenseUrl) {
    credit.licenseUrl = licenseUrl;
  }

  const parsed = photoCreditSchema.safeParse(credit);

  return parsed.success
    ? { url: large.href, thumbUrl: small, width: THUMB_WIDTH, height, credit: parsed.data }
    : null;
}
```

7. Replace `emptyRow`, `lookupRow` and `toPlaceMedia`:

```ts
function emptyRow(key: string, status: MediaStatus, expires: Date): MediaRow {
  return {
    key,
    status,
    lookupVersion: LOOKUP_VERSION,
    pinned: false,
    pageTitle: null,
    pageUrl: null,
    extract: null,
    photo: null,
    credit: null,
    expiresAt: expires.toISOString(),
  };
}

/** The row a finished lookup writes: the matched article and its copied photo, or `none`. */
export function lookupRow(
  key: string,
  match: Article | null,
  now: Date,
  copied: CopiedPhoto | null = null,
): MediaRow {
  if (!match) {
    return emptyRow(key, 'none', expiresAt('none', now));
  }

  return {
    key,
    status: 'found',
    lookupVersion: LOOKUP_VERSION,
    pinned: false,
    pageTitle: match.title.slice(0, 200),
    pageUrl: articleUrl(match.title),
    extract: clipExtract(match.extract),
    photo: copied?.photo ?? null,
    credit: copied?.credit ?? null,
    expiresAt: expiresAt('found', now).toISOString(),
  };
}
```

Keep `failedRow` as it is; it builds on `emptyRow`.

```ts
/**
 * What the app is told about a row. Only a `found` row has an `about` (with a readable
 * introduction) or a `photo`, whose URLs `photoUrl` builds from the stored paths. A photo the
 * contract rejects, such as one on a local http Supabase, is left out rather than failing the
 * whole answer.
 */
export function toPlaceMedia(row: MediaRow, photoUrl: (path: string) => string): PlaceMedia {
  const found = row.status === 'found';
  const about = found
    ? aboutSchema.safeParse({ title: row.pageTitle, extract: row.extract, url: row.pageUrl })
    : null;
  const photo =
    found && row.photo && row.credit
      ? photoSchema.safeParse({
          url: photoUrl(row.photo.path),
          thumbUrl: photoUrl(row.photo.thumbPath),
          width: row.photo.width,
          height: row.photo.height,
          credit: row.credit,
        })
      : null;

  return {
    status: 'ready',
    about: about?.success && about.data.extract.length > 0 ? about.data : null,
    photo: photo?.success ? photo.data : null,
  };
}
```

- [ ] **Step 5: Run the rules tests to verify they pass**

Run: `node --experimental-strip-types --test tests/place-media-rules.test.mjs`
Expected: PASS, every test.

`pnpm typecheck` now fails in `cache.ts` (rows without `photo`/`credit`) and in `lookup.ts` (`toPlaceMedia` without a URL builder). Task 4 fixes both. To keep this task's commit green, make these two interim edits now:

- In `cache.ts`'s `readRows`, add `photo: null, credit: null,` to the row it builds.
- In `lookup.ts`, pass `() => ''` as the second argument of both of its `toPlaceMedia` calls (in `resolvePlaceMedia`). Task 4 replaces both edits.

In `tests/support/media.mjs`, change `cacheRow`'s default `lookup_version: 1` to `lookup_version: 2`. In `tests/media-route.test.mjs`, change the expected saved row's `lookup_version: 1` to `lookup_version: 2` (in "a miss asks Wikipedia…").

- [ ] **Step 6: Run the full suite and checks**

Run: `pnpm test > .superpowers/task2.log 2>&1; tail -5 .superpowers/task2.log && pnpm typecheck && pnpm lint`
Expected: every test passes; typecheck and lint pass.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add packages/types/src/media.ts apps/api/src/lib/media/rules.ts apps/api/src/lib/media/cache.ts apps/api/src/lib/media/lookup.ts tests/place-media-rules.test.mjs tests/support/media.mjs tests/media-route.test.mjs
git commit -m "Add the photo rules and lookup version 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Request 2 and image downloads

**Files:**

- Modify: `apps/api/src/lib/media/wikipedia.ts`
- Modify: `tests/support/media.mjs`
- Create: `tests/place-media-photos.test.mjs`

**Interfaces:**

- Consumes: `FileInfo`, `ImageType` and `imageType` from Task 2.
- Produces in `wikipedia.ts`:
  - `MAX_PHOTO_BYTES = 2 * 1024 * 1024`.
  - `interface ImageFile { bytes: Uint8Array; type: ImageType }`.
  - `fileInfo(file: string, contact: string): Promise<FileInfo | null>`.
  - `downloadImage(url: string, contact: string): Promise<ImageFile | null>`.
- Produces in `tests/support/media.mjs`: `JPEG` and `fileInfoBody(file, overrides)`.

- [ ] **Step 1: Add the test stand-ins**

In `tests/support/media.mjs`, after `NOW`, add:

```js
/** The first bytes of a JPEG: enough for the lookup to accept it as one. */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/**
 * A Commons imageinfo answer (formatversion 2) for one file, with a 960px thumbnail, a CC BY-SA
 * licence and Kasa Fue as the author. `overrides` replace fields of its `imageinfo` entry.
 */
export function fileInfoBody(file, overrides = {}) {
  return {
    batchcomplete: true,
    query: {
      pages: [
        {
          pageid: 1,
          ns: 6,
          title: `File:${file}`,
          imagerepository: 'local',
          imageinfo: [
            {
              thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/960px-${file}`,
              thumbwidth: 960,
              thumbheight: 640,
              url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
              extmetadata: {
                Artist: {
                  value: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
                  source: 'commons-desc-page',
                },
                LicenseShortName: { value: 'CC BY-SA 4.0', source: 'commons-desc-page' },
                LicenseUrl: {
                  value: 'https://creativecommons.org/licenses/by-sa/4.0',
                  source: 'commons-desc-page',
                },
              },
              ...overrides,
            },
          ],
        },
      ],
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/place-media-photos.test.mjs`:

```js
// Request 2 (a lead image's thumbnail and credit, from Commons) and the image downloads that
// copy a photo, with fetch stubbed.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  downloadImage,
  fileInfo,
  MAX_PHOTO_BYTES,
  WikipediaError,
  WikipediaThrottledError,
} from '../apps/api/src/lib/media/wikipedia.ts';
import { CONTACT, fileInfoBody, JPEG } from './support/media.mjs';

const IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/B.jpg/960px-B.jpg';

// Answers fetch with each of `answers` in turn and records what was asked.
function stub(t, ...answers) {
  const calls = [];

  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init });

    const answer = answers.shift();

    if (answer instanceof Error) {
      throw answer;
    }

    return answer();
  });

  return calls;
}

const jpeg = (body = JPEG, headers = {}) =>
  new Response(body, { headers: { 'Content-Type': 'image/jpeg', ...headers } });

test('request 2 asks Commons for the 960px thumbnail and the credit metadata', async (t) => {
  const calls = stub(t, () => Response.json(fileInfoBody('Berlin.jpg')));

  const info = await fileInfo('Berlin.jpg', CONTACT);
  const [{ url, init }] = calls;

  assert.equal(`${url.origin}${url.pathname}`, 'https://commons.wikimedia.org/w/api.php');
  assert.equal(url.searchParams.get('titles'), 'File:Berlin.jpg');
  assert.equal(url.searchParams.get('prop'), 'imageinfo');
  assert.equal(url.searchParams.get('iiprop'), 'url|size|extmetadata');
  assert.equal(url.searchParams.get('iiurlwidth'), '960');
  assert.equal(
    url.searchParams.get('iiextmetadatafilter'),
    'Artist|LicenseShortName|LicenseUrl|NonFree',
  );
  assert.equal(url.searchParams.get('formatversion'), '2');
  assert.equal(new Headers(init.headers).get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.deepEqual(info, {
    thumbUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Berlin.jpg/960px-Berlin.jpg',
    thumbWidth: 960,
    thumbHeight: 640,
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    artist: '<a href="//commons.wikimedia.org/wiki/User:Kasa_Fue">Kasa Fue</a>',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    nonFree: false,
  });
});

test('NonFree counts unless it says false', async (t) => {
  const marked = (value) =>
    fileInfoBody('Berlin.jpg', {
      extmetadata: { LicenseShortName: { value: 'Fair use' }, NonFree: { value } },
    });

  stub(
    t,
    () => Response.json(marked('true')),
    () => Response.json(marked('false')),
  );

  assert.equal((await fileInfo('Berlin.jpg', CONTACT)).nonFree, true);
  assert.equal((await fileInfo('Berlin.jpg', CONTACT)).nonFree, false);
});

test('a file Commons lacks is no photo; an error answer throws', async (t) => {
  stub(
    t,
    () =>
      Response.json({
        batchcomplete: true,
        query: { pages: [{ ns: 6, title: 'File:Local.jpg', missing: true }] },
      }),
    () => Response.json({ error: { code: 'internal_api_error' } }),
  );

  assert.equal(await fileInfo('Local.jpg', CONTACT), null);
  await assert.rejects(fileInfo('Berlin.jpg', CONTACT), WikipediaError);
});

test('a download sends our User-Agent, refuses redirects and reads the format from the bytes', async (t) => {
  const calls = stub(t, () => jpeg());

  const image = await downloadImage(IMAGE, CONTACT);

  assert.equal(calls[0].url.href, IMAGE);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(new Headers(calls[0].init.headers).get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.equal(image.type, 'jpg');
  assert.deepEqual([...image.bytes], [...JPEG]);
});

test('a download that is not a JPEG, PNG or WebP, or is over 2 MB, is no photo', async (t) => {
  const oversized = new Uint8Array(MAX_PHOTO_BYTES + 1);

  oversized.set(JPEG);
  stub(
    t,
    () => jpeg('<html></html>'),
    () => jpeg('GIF89a'),
    () => jpeg(oversized),
    () => jpeg(JPEG, { 'Content-Length': String(MAX_PHOTO_BYTES + 1) }),
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await downloadImage(IMAGE, CONTACT), null, `attempt ${attempt}`);
  }
});

test('a throttled, failed or redirected download throws, so the lookup is tried again', async (t) => {
  stub(
    t,
    () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    () => new Response(null, { status: 404 }),
    new TypeError('fetch failed: unexpected redirect'),
  );

  await assert.rejects(downloadImage(IMAGE, CONTACT), (error) => {
    assert.ok(error instanceof WikipediaThrottledError);
    assert.equal(error.retryAfter, '120');

    return true;
  });
  await assert.rejects(downloadImage(IMAGE, CONTACT), WikipediaError);
  await assert.rejects(downloadImage(IMAGE, CONTACT), WikipediaError);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/place-media-photos.test.mjs`
Expected: FAIL with `does not provide an export named 'downloadImage'`.

- [ ] **Step 4: Write request 2 and the downloads**

In `apps/api/src/lib/media/wikipedia.ts`:

1. Change the rules import to bring in what the new code needs:

```ts
import { imageType, type Article, type FileInfo, type ImageType } from './rules.ts';
```

2. After `TIMEOUT_MS`, add:

```ts
const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

/** The largest image we copy, in bytes: 2 MB, as the bucket allows. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** A downloaded image: its bytes and the format they show. */
export interface ImageFile {
  bytes: Uint8Array;
  type: ImageType;
}
```

3. Reword the error classes' summaries, keeping the code:

```ts
/** Wikipedia or Commons asked us to slow down (429 or 503). `message` holds only the status code. */
```

```ts
/** Any other failed request: an HTTP error, a timeout, a redirect or an answer we can't read. */
```

4. After `searchSchema`, add:

```ts
const fileInfoSchema = z.object({
  error: z.unknown().optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            missing: z.boolean().optional(),
            imageinfo: z
              .array(
                z.object({
                  thumburl: z.string().optional(),
                  thumbwidth: z.number().optional(),
                  thumbheight: z.number().optional(),
                  descriptionurl: z.string().optional(),
                  extmetadata: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
```

5. Replace `getJson` with `send` and a `getJson` that uses it:

```ts
// One request with our User-Agent and the 4-second timeout. A throttle or an HTTP error throws.
async function send(url: string, contact: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': userAgent(contact) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WikipediaError('Wikipedia did not answer.');
  }

  if (response.status === 429 || response.status === 503) {
    throw new WikipediaThrottledError(response.status, response.headers.get('Retry-After'));
  }

  if (!response.ok) {
    throw new WikipediaError(`Wikipedia answered ${response.status}.`);
  }

  return response;
}

async function getJson(url: string, contact: string): Promise<unknown> {
  const response = await send(url, contact);

  try {
    return await response.json();
  } catch {
    throw new WikipediaError('Wikipedia sent an unreadable answer.');
  }
}
```

6. At the end of the file, add:

```ts
// Request 2: the file's 960px thumbnail and its credit metadata, from Commons.
function fileInfoUrl(file: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|NonFree',
    iiextmetadatalanguage: 'en',
  });

  return `${COMMONS_API_URL}?${params.toString()}`;
}

// One extmetadata field as text, or null when it's missing or blank.
function metaText(
  meta: Record<string, { value: unknown }> | undefined,
  name: string,
): string | null {
  const value = meta?.[name]?.value;

  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * What Commons says about a lead image (spec section 2, request 2), or null when the file isn't
 * on Commons or has no thumbnail. `photoSource` decides whether it's used.
 */
export async function fileInfo(file: string, contact: string): Promise<FileInfo | null> {
  const parsed = fileInfoSchema.safeParse(await getJson(fileInfoUrl(file), contact));

  if (!parsed.success || parsed.data.error !== undefined) {
    throw new WikipediaError('Commons sent an unexpected answer.');
  }

  const page = parsed.data.query?.pages?.[0];
  const info = page?.imageinfo?.[0];

  if (
    !page ||
    page.missing ||
    !info?.thumburl ||
    !info.descriptionurl ||
    info.thumbwidth === undefined ||
    info.thumbheight === undefined
  ) {
    return null;
  }

  const meta = info.extmetadata;
  const nonFree = metaText(meta, 'NonFree');

  return {
    thumbUrl: info.thumburl,
    thumbWidth: info.thumbwidth,
    thumbHeight: info.thumbheight,
    pageUrl: info.descriptionurl,
    artist: metaText(meta, 'Artist'),
    license: metaText(meta, 'LicenseShortName'),
    licenseUrl: metaText(meta, 'LicenseUrl'),
    nonFree: nonFree !== null && nonFree.trim().toLowerCase() !== 'false',
  };
}

/**
 * Downloads one size of a photo, without following redirects. Null when it isn't a JPEG, PNG
 * or WebP by its first bytes, or is over 2 MB: such a file never becomes a photo. A throttle,
 * an HTTP error, a redirect or a timeout throws, so the lookup is tried again.
 */
export async function downloadImage(url: string, contact: string): Promise<ImageFile | null> {
  const response = await send(url, contact, { redirect: 'error' });

  if (Number(response.headers.get('Content-Length') ?? 0) > MAX_PHOTO_BYTES) {
    await response.body?.cancel();

    return null;
  }

  let bytes: Uint8Array;

  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new WikipediaError('Wikipedia did not answer.');
  }

  const type = imageType(bytes);

  return type && bytes.byteLength <= MAX_PHOTO_BYTES ? { bytes, type } : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/place-media-photos.test.mjs tests/place-media-lookup.test.mjs tests/media-route.test.mjs`
Expected: PASS, every test. Phase 1's search tests still pass through `send`.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add apps/api/src/lib/media/wikipedia.ts tests/support/media.mjs tests/place-media-photos.test.mjs
git commit -m "Ask Commons for a lead image's credit and download its sizes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Copy photos in each lookup

**Files:**

- Create: `apps/api/src/lib/media/storage.ts`
- Modify: `apps/api/src/lib/media/cache.ts`
- Modify: `apps/api/src/lib/media/lookup.ts`
- Modify: `tests/support/media.mjs`
- Modify: `tests/place-media-lookup.test.mjs`
- Modify: `tests/media-route.test.mjs`

**Interfaces:**

- Consumes:
  - From Task 2: `isUsableImage`, `photoSource`, `lookupRow(key, match, now, copied)`, `toPlaceMedia(row, photoUrl)`, `PHOTO_TYPES`, `StoredPhoto`, `CopiedPhoto`.
  - From Task 3: `fileInfo`, `downloadImage`, `ImageFile`.
- Produces in `storage.ts`:
  - `PHOTO_BUCKET = 'place-photos'`.
  - `photoPath(key: string, image: ImageFile, width: 960 | 500): string`.
  - `copyPhoto(db: SupabaseClient, contact: string, key: string, source: PhotoSource): Promise<StoredPhoto | null>`.
  - `publicPhotoUrl(db: SupabaseClient, path: string): string`.
  - `class PhotoStorageError`.
- Produces elsewhere:
  - `readRows` returns `photo` and `credit`.
  - `saveRow` writes them.
  - `tests/support/media.mjs`'s `mediaUpstream` gains `commons`, `images` and `failUpload` options and `infos`, `downloads` and `uploads` in its state.

- [ ] **Step 1: Teach the test upstream about Commons, images and storage**

In `tests/support/media.mjs`:

1. Extend `mediaUpstream`'s doc comment with: "`commons(url)` answers request 2 (default: the file is missing), `images(url)` answers each download (default: a JPEG), and `failUpload(path)` makes that upload fail. `state` also records request 2s, downloads and uploads."
2. Change its parameters and state to:

```js
export function mediaUpstream({
  snapshot = null,
  rows = [],
  wikipedia = () => Response.json(searchBody([])),
  commons = () =>
    Response.json({
      batchcomplete: true,
      query: { pages: [{ ns: 6, title: 'File:Missing.jpg', missing: true }] },
    }),
  images = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }),
  failRead = false,
  failWrite = false,
  failUpload = () => false,
} = {}) {
  const state = {
    rows: new Map(rows.map((row) => [row.key, row])),
    searches: [],
    infos: [],
    downloads: [],
    uploads: [],
    saved: [],
    reads: 0,
  };
```

3. In `handler`, after the `en.wikipedia.org` branch, add:

```js
if (url.hostname === 'commons.wikimedia.org') {
  state.infos.push({ url, headers: new Headers(init.headers) });

  return commons(url);
}

if (url.hostname === 'upload.wikimedia.org') {
  state.downloads.push({ url, headers: new Headers(init.headers), redirect: init.redirect });

  return images(url);
}

const stored = url.pathname.match(/^\/storage\/v1\/object\/place-photos\/(.+)$/);

if (stored && method === 'POST') {
  if (failUpload(stored[1])) {
    return Response.json(
      { statusCode: '500', error: 'internal', message: 'internal detail' },
      { status: 500 },
    );
  }

  state.uploads.push({ path: stored[1], headers: new Headers(init.headers), body: init.body });

  return Response.json({ Id: `upload-${state.uploads.length}`, Key: `place-photos/${stored[1]}` });
}
```

- [ ] **Step 2: Write the failing lookup tests**

In `tests/place-media-lookup.test.mjs`:

1. Add `import { createHash } from 'node:crypto';` at the top with the other Node imports.
2. Extend the `./support/media.mjs` import with `fileInfoBody` and `JPEG`.
3. Append:

```js
const BUCKET = 'https://nexui-test.supabase.co/storage/v1/object/public/place-photos';
const hex = (data) => createHash('sha256').update(data).digest('hex');

// A search answer whose one article has a lead image.
const withImage = (name, lng, image) =>
  Response.json(searchBody([{ ...article(name, 0, lng), pageimage: image }]));

test('a usable lead image is copied into the bucket in two sizes and answered with its photo', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    wikipedia: () => withImage('Kyoto', 1, 'Kyoto_Skyline.jpg'),
    commons: () => Response.json(fileInfoBody('Kyoto_Skyline.jpg')),
  });
  const { deps } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);
  const [info] = upstream.state.infos;
  const [saved] = upstream.state.saved;
  const folder = hex(place.key).slice(0, 16);
  const name = hex(JPEG).slice(0, 12);
  const photo = {
    path: `${folder}/${name}-960.jpg`,
    thumbPath: `${folder}/${name}-500.jpg`,
    width: 960,
    height: 640,
  };
  const credit = {
    author: 'Kasa Fue',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Kyoto_Skyline.jpg',
  };

  assert.equal(info.url.searchParams.get('titles'), 'File:Kyoto_Skyline.jpg');
  assert.equal(info.headers.get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.deepEqual(
    upstream.state.downloads.map((download) => download.url.pathname.split('/').at(-1)).sort(),
    ['500px-Kyoto_Skyline.jpg', '960px-Kyoto_Skyline.jpg'],
  );
  assert.ok(upstream.state.downloads.every((download) => download.redirect === 'error'));
  assert.deepEqual(upstream.state.uploads.map((upload) => upload.path).sort(), [
    photo.thumbPath,
    photo.path,
  ]);

  for (const upload of upstream.state.uploads) {
    assert.equal(upload.headers.get('content-type'), 'image/jpeg');
    assert.equal(upload.headers.get('cache-control'), 'max-age=31536000');
    assert.equal(upload.headers.get('x-upsert'), 'true');
  }

  assert.equal(saved.status, 'found');
  assert.deepEqual(saved.photo, photo);
  assert.deepEqual(saved.credit, credit);
  assert.deepEqual(answers[place.id].photo, {
    url: `${BUCKET}/${photo.path}`,
    thumbUrl: `${BUCKET}/${photo.thumbPath}`,
    width: 960,
    height: 640,
    credit,
  });
});

test('a lead image that fails the photo rules keeps the article with no photo', async (t) => {
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);

  oversized.set(JPEG);

  const images = {
    Flagland: 'Flag_of_Kenya.svg',
    Nonfree: 'Nonfree_view.jpg',
    Webpage: 'Webpage_view.jpg',
    Huge: 'Huge_view.jpg',
  };
  const names = Object.keys(images);
  const upstream = mediaUpstream({
    wikipedia: (url) => {
      const name = url.searchParams.get('gsrsearch');

      return withImage(name, names.indexOf(name) + 1, images[name]);
    },
    commons: (url) => {
      const file = url.searchParams.get('titles').slice('File:'.length);
      const nonFree = {
        extmetadata: { LicenseShortName: { value: 'Fair use' }, NonFree: { value: 'true' } },
      };

      return Response.json(fileInfoBody(file, file === 'Nonfree_view.jpg' ? nonFree : {}));
    },
    images: (url) =>
      url.pathname.includes('Webpage')
        ? new Response('<html></html>', { headers: { 'Content-Type': 'image/jpeg' } })
        : new Response(oversized, { headers: { 'Content-Type': 'image/jpeg' } }),
  });
  const { deps } = setup(t, upstream);
  const places = names.map((name, index) => spot(index + 1, name));

  const answers = await resolvePlaceMedia(deps, places);

  assert.deepEqual(
    upstream.state.infos.map((info) => info.url.searchParams.get('titles')).sort(),
    ['File:Huge_view.jpg', 'File:Nonfree_view.jpg', 'File:Webpage_view.jpg'],
    'an SVG never reaches request 2',
  );
  assert.equal(upstream.state.downloads.length, 4, 'a non-free file is never downloaded');
  assert.equal(upstream.state.uploads.length, 0);

  for (const place of places) {
    assert.equal(answers[place.id].about.title, place.name);
    assert.equal(answers[place.id].photo, null);
  }

  assert.ok(
    upstream.state.saved.every(
      (row) => row.status === 'found' && row.photo === null && row.credit === null,
    ),
  );
});

test('a failed upload caches the place as failed, so no photo points at a missing file', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    wikipedia: () => withImage('Kyoto', 1, 'Kyoto_Skyline.jpg'),
    commons: () => Response.json(fileInfoBody('Kyoto_Skyline.jpg')),
    failUpload: (path) => path.endsWith('-500.jpg'),
  });
  const { deps, errors } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);
  const [saved] = upstream.state.saved;

  assert.equal(saved.status, 'failed');
  assert.equal(saved.photo, null);
  assert.equal(Date.parse(saved.expires_at) - NOW.getTime(), 15 * 60_000);
  assert.deepEqual(answers[place.id], { status: 'ready', about: null, photo: null });
  assert.ok(
    errors.mock.calls.some(
      (call) => call.arguments.join(' ') === '[media] Could not store a photo (500).',
    ),
  );
  assert.ok(errors.mock.calls.every((call) => !call.arguments.join(' ').includes('Kyoto')));
});

test('a throttled image download holds back the rest of the request like a throttled search', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: (url) => {
      const name = url.searchParams.get('gsrsearch');

      return withImage(name, Number(name.replace('Place ', '')), 'View.jpg');
    },
    commons: () => Response.json(fileInfoBody('View.jpg')),
    images: () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
  });
  const { deps } = setup(t, upstream);
  const places = Array.from({ length: 6 }, (_, index) => spot(index + 1));

  await resolvePlaceMedia(deps, places);

  assert.equal(upstream.state.searches.length, 4);
  assert.equal(upstream.state.saved.length, 6);

  for (const row of upstream.state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(row.expires_at, new Date(NOW.getTime() + 3_600_000).toISOString());
  }
});
```

4. In `tests/media-route.test.mjs`, append:

```js
test('a cached photo answers with our bucket URLs and its credit; a malformed one is left out', async (t) => {
  useContact(t);

  const stored = {
    path: 'aaaa/bbbb-960.jpg',
    thumbPath: 'aaaa/cccc-500.jpg',
    width: 960,
    height: 640,
  };
  const credit = {
    author: 'Kasa Fue',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg',
  };
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [
      cacheRow(TOKYO_KEY, { photo: stored, credit }),
      cacheRow(KYOTO_KEY, { photo: { ...stored, width: 0 }, credit }),
    ],
  });

  const body = await (await get()).json();
  const bucket = 'https://nexui-test.supabase.co/storage/v1/object/public/place-photos';

  assert.equal(state.searches.length, 0);
  assert.deepEqual(body.places[TOKYO_ID].photo, {
    url: `${bucket}/aaaa/bbbb-960.jpg`,
    thumbUrl: `${bucket}/aaaa/cccc-500.jpg`,
    width: 960,
    height: 640,
    credit,
  });
  assert.equal(body.places[KYOTO_ID].photo, null);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/place-media-lookup.test.mjs tests/media-route.test.mjs`
Expected: FAIL. The four new lookup tests find no infos or uploads (`undefined` for `info`), and the route test's Tokyo `photo` is `null`.

- [ ] **Step 4: Write the storage copy**

Create `apps/api/src/lib/media/storage.ts`:

```ts
import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { PHOTO_TYPES, type PhotoSource, type StoredPhoto } from './rules.ts';
import { downloadImage, type ImageFile } from './wikipedia.ts';

/** The public bucket every place photo is copied into (spec section 3). */
export const PHOTO_BUCKET = 'place-photos';

const ONE_YEAR_SECONDS = '31536000';

/** Storage refused an upload. `message` holds only the HTTP status, for the log. */
export class PhotoStorageError extends Error {
  constructor(status: number | undefined) {
    super(`Could not store a photo${status === undefined ? '' : ` (${status})`}.`);
  }
}

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/**
 * Where one size of a photo lives (spec section 2). The path names its content, so a refresh
 * writes new files and old URLs stay valid.
 *
 * @example
 * photoPath('berlin|DE|52.5|13.4', image, 960) // '<16 hex of the key>/<12 hex of the bytes>-960.jpg'
 */
export function photoPath(key: string, image: ImageFile, width: 960 | 500): string {
  return `${sha256(key).slice(0, 16)}/${sha256(image.bytes).slice(0, 12)}-${width}.${image.type}`;
}

async function upload(db: SupabaseClient, path: string, image: ImageFile): Promise<void> {
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, image.bytes, {
    contentType: PHOTO_TYPES[image.type],
    cacheControl: ONE_YEAR_SECONDS,
    upsert: true,
  });

  if (error) {
    throw new PhotoStorageError(error.status);
  }
}

/**
 * Copies a photo's two sizes into our bucket and returns where they are. Null when either
 * download isn't an image we accept. A failed download or upload throws, so the lookup is
 * cached `failed` and tried again, and a photo URL never points at a missing file.
 */
export async function copyPhoto(
  db: SupabaseClient,
  contact: string,
  key: string,
  source: PhotoSource,
): Promise<StoredPhoto | null> {
  const [large, small] = await Promise.all([
    downloadImage(source.url, contact),
    downloadImage(source.thumbUrl, contact),
  ]);

  if (!large || !small) {
    return null;
  }

  const path = photoPath(key, large, 960);
  const thumbPath = photoPath(key, small, 500);

  await Promise.all([upload(db, path, large), upload(db, thumbPath, small)]);

  return { path, thumbPath, width: source.width, height: source.height };
}

/** A stored photo's public URL, served through Supabase's CDN. */
export function publicPhotoUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
```

- [ ] **Step 5: Read and write the photo columns**

In `apps/api/src/lib/media/cache.ts`:

1. Replace the imports, `COLUMNS` and `rowSchema`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { photoCreditSchema } from '@nexui/types';

import type { MediaRow } from './rules.ts';

const COLUMNS =
  'key, status, lookup_version, pinned, page_title, page_url, extract, photo, credit, expires_at';

const rowSchema = z.object({
  key: z.string(),
  status: z.enum(['found', 'none', 'failed']),
  lookup_version: z.number().int(),
  pinned: z.boolean(),
  page_title: z.string().nullable(),
  page_url: z.string().nullable(),
  extract: z.string().nullable(),
  photo: z.unknown(),
  credit: z.unknown(),
  expires_at: z.string(),
});

// `place_media.photo`. An operator may edit it by hand, so it's checked like the rest.
const storedPhotoSchema = z.object({
  path: z.string().min(1).max(200),
  thumbPath: z.string().min(1).max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
```

2. In `readRows`, replace the interim `photo: null, credit: null,` from Task 2 so the loop body reads:

```ts
if (parsed.success) {
  const row = parsed.data;
  const photo = storedPhotoSchema.safeParse(row.photo);
  const credit = photoCreditSchema.safeParse(row.credit);

  rows.set(row.key, {
    key: row.key,
    status: row.status,
    lookupVersion: row.lookup_version,
    pinned: row.pinned,
    pageTitle: row.page_title,
    pageUrl: row.page_url,
    extract: row.extract,
    photo: photo.success ? photo.data : null,
    credit: credit.success ? credit.data : null,
    expiresAt: row.expires_at,
  });
}
```

3. In `saveRow`, replace `photo: null, credit: null,` with:

```ts
    photo: row.photo,
    credit: row.credit,
```

- [ ] **Step 6: Find and copy the photo in each lookup**

In `apps/api/src/lib/media/lookup.ts`:

1. Replace the `./rules.ts` and `./wikipedia.ts` imports, and add `./storage.ts`:

```ts
import {
  failedRow,
  isFresh,
  isUsableImage,
  lookupRow,
  matchArticle,
  photoSource,
  retryAfterMs,
  toPlaceMedia,
  type Article,
  type CopiedPhoto,
  type LookupPlace,
  type MediaRow,
  type MediaStatus,
} from './rules.ts';
import { copyPhoto, PhotoStorageError, publicPhotoUrl } from './storage.ts';
import { fileInfo, searchArticles, WikipediaError, WikipediaThrottledError } from './wikipedia.ts';
```

2. After `store`, add:

```ts
// The match's photo, copied into our bucket, or null when it has no usable lead image (spec
// section 2's photo rules). Throws when Wikimedia or storage fails, like the search does.
async function findPhoto(
  deps: MediaDeps,
  contact: string,
  key: string,
  match: Article,
): Promise<CopiedPhoto | null> {
  if (!match.image || !isUsableImage(match.image)) {
    return null;
  }

  const info = await fileInfo(match.image, contact);
  const source = info ? photoSource(info) : null;

  if (!source) {
    return null;
  }

  const photo = await copyPhoto(deps.db, contact, key, source);

  return photo ? { photo, credit: source.credit } : null;
}
```

3. In `lookUp`, replace the `try` block and the log call:

```ts
try {
  const match = matchArticle(place, await searchArticles(place.name, contact));
  const photo = match ? await findPhoto(deps, contact, place.key, match) : null;

  row = lookupRow(place.key, match, now, photo);
} catch (error) {
  if (error instanceof WikipediaThrottledError) {
    retryAfter = retryAfterMs(error.retryAfter, now);
    row = failedRow(place.key, now, retryAfter);
  } else {
    row = failedRow(place.key, now);
  }

  const known =
    error instanceof WikipediaError ||
    error instanceof WikipediaThrottledError ||
    error instanceof PhotoStorageError;

  console.error('[media]', known ? error.message : 'A lookup failed.');
}
```

4. Update the doc comment of `lookUp` to "One lookup: search, match, copy the photo and cache. Never throws; a failure becomes a `failed` row."
5. In `resolvePlaceMedia`, after `const { contact } = deps;`, add:

```ts
const photoUrl = (path: string): string => publicPhotoUrl(deps.db, path);
```

6. Replace the interim `() => ''` from Task 2 with `photoUrl` in both `toPlaceMedia` calls.
7. Update the doc comment of `resolvePlaceMedia`: after "A fresh cache row answers at once.", add "Photos answer with our bucket's URLs."

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/place-media-lookup.test.mjs tests/media-route.test.mjs tests/place-media-photos.test.mjs`
Expected: PASS, every test.

- [ ] **Step 8: Run the full suite and checks**

Run: `pnpm test > .superpowers/task4.log 2>&1; tail -5 .superpowers/task4.log && pnpm typecheck && pnpm lint`
Expected: every test passes; typecheck and lint pass.

- [ ] **Step 9: Commit**

```bash
pnpm fix
git add apps/api/src/lib/media tests/support/media.mjs tests/place-media-lookup.test.mjs tests/media-route.test.mjs
git commit -m "Copy each place's photo into our bucket and answer with its URLs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The live check gets photo expectations

**Files:**

- Modify: `scripts/check-place-media.mjs`

**Interfaces:**

- Consumes: `isUsableImage`, `photoSource`, `fileInfo` and `downloadImage` (Tasks 2–3).
- Produces: a manual gate that prints a pass or fail per case.

- [ ] **Step 1: Rewrite the script**

Replace `scripts/check-place-media.mjs` with:

```js
// Checks the place media lookup against live Wikipedia and Commons, with no cache or storage
// writes, and prints a pass or fail per case. Each place must:
// - match the right article, with an introduction;
// - get a photo, or none, as expected, with both sizes downloaded and accepted.
// A manual gate like `pnpm eval:travel`, not part of `pnpm test`.
// Needs WIKIMEDIA_CONTACT, from the environment or apps/api/.env.local.
import { existsSync } from 'node:fs';

import { readMediaConfig } from '../apps/api/src/lib/media/config.ts';
import { isUsableImage, matchArticle, photoSource } from '../apps/api/src/lib/media/rules.ts';
import { downloadImage, fileInfo, searchArticles } from '../apps/api/src/lib/media/wikipedia.ts';
import { normalizePlaceName, roundCoordinate } from '../packages/types/src/media.ts';

// `photo`: true when the place must get one, false when it must not, absent when either is fine.
const CASES = [
  {
    place: { name: 'Berlin', placeType: 'city', lat: 52.52, lng: 13.405 },
    title: 'Berlin',
    photo: true,
  },
  {
    place: { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 },
    title: 'Hallstatt',
    photo: true,
  },
  {
    place: { name: 'Springfield', placeType: 'city', lat: 39.7817, lng: -89.6501 },
    title: 'Springfield, Illinois',
  },
  {
    place: { name: 'Springfield', placeType: 'city', lat: 42.1015, lng: -72.5898 },
    title: 'Springfield, Massachusetts',
  },
  {
    place: { name: 'Lower Austria', placeType: 'region', lat: 48.2, lng: 15.6 },
    title: 'Lower Austria',
    photo: false,
  },
  {
    place: { name: 'Amalfi Coast', placeType: 'area', lat: 40.633, lng: 14.602 },
    title: 'Amalfi Coast',
  },
  {
    place: { name: 'Kyoto', placeType: 'city', lat: 35.0116, lng: 135.7681 },
    title: 'Kyoto',
    photo: true,
  },
  {
    place: { name: 'Dolomites', placeType: 'region', lat: 46.41, lng: 11.84 },
    title: 'Dolomites',
    photo: true,
  },
];

if (!process.env.WIKIMEDIA_CONTACT && existsSync('apps/api/.env.local')) {
  process.loadEnvFile('apps/api/.env.local');
}

const { contact } = readMediaConfig();

if (!contact) {
  console.error('Set WIKIMEDIA_CONTACT (an email address or URL) in apps/api/.env.local.');
  process.exit(1);
}

// The match's photo as the lookup would copy it (downloaded, not stored), or why there's none.
async function livePhoto(match) {
  if (!match.image) {
    return { source: null, why: 'no lead image' };
  }

  if (!isUsableImage(match.image)) {
    return { source: null, why: `${match.image} is not a photo` };
  }

  const info = await fileInfo(match.image, contact);
  const source = info ? photoSource(info) : null;

  if (!source) {
    return { source: null, why: `${match.image} fails the licence or size rules` };
  }

  const sizes = await Promise.all([
    downloadImage(source.url, contact),
    downloadImage(source.thumbUrl, contact),
  ]);

  if (sizes.includes(null)) {
    return { source: null, why: `${match.image} downloads are not accepted images` };
  }

  return { source, why: '' };
}

// What a failed case expected, for its FAIL line.
function expected(title, photo) {
  if (photo === undefined) {
    return title;
  }

  return photo ? `${title} with a photo` : `${title} with no photo`;
}

let failures = 0;

for (const { place, title, photo } of CASES) {
  const label = `${place.name} (${place.lat}, ${place.lng})`;

  try {
    // As the lookup does it: the key's normalized name and rounded coordinates.
    const keyed = {
      ...place,
      name: normalizePlaceName(place.name),
      lat: roundCoordinate(place.lat),
      lng: roundCoordinate(place.lng),
    };
    const match = matchArticle(keyed, await searchArticles(keyed.name, contact));
    const found = match ? await livePhoto(match) : { source: null, why: 'no match' };
    const matched = match?.title === title && match.extract.length > 0;
    const pass = matched && (photo === undefined || photo === (found.source !== null));
    const credit = found.source?.credit;
    const shown = credit
      ? `photo by ${credit.author || 'unknown'} (${credit.license})`
      : `no photo: ${found.why}`;
    const verdict = pass ? 'pass' : 'FAIL';
    const wanted = pass ? '' : `; expected ${expected(title, photo)}`;

    if (!pass) {
      failures += 1;
    }

    console.log(`${verdict}  ${label}: ${match?.title ?? 'no match'}, ${shown}${wanted}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${label}: ${error.message}`);
  }
}

console.log(
  failures === 0
    ? `All ${CASES.length} cases pass.`
    : `${failures} of ${CASES.length} cases failed.`,
);
process.exitCode = failures === 0 ? 0 : 1;
```

- [ ] **Step 2: Run the live check**

The worktree needs the API's env first. If `apps/api/.env.local` is missing here, copy it from the main checkout (it's gitignored): `cp /Users/farajsiddique/Developer/nexui/apps/api/.env.local apps/api/.env.local`.

Run: `node scripts/check-place-media.mjs`
Expected: `All 8 cases pass.`

If a photo case fails on live data, read its printed reason before changing anything. The spec's eight cases are the gate:

- A rule bug is fixed in `rules.ts`, with a test.
- A Wikipedia fact that changed (for example, Lower Austria's lead image is now a landscape photo) is a ruling for the ledger and a question for the user. Don't weaken the rule to pass.

- [ ] **Step 3: Commit**

```bash
pnpm fix
git add scripts/check-place-media.mjs
git commit -m "Check photos in the live place media gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Photos on Home's cards

**Files:**

- Modify: `packages/types/src/graph.ts`
- Modify: `packages/types/src/api.ts`
- Modify: `apps/api/src/lib/kinds/trip.ts`
- Modify: `apps/api/src/lib/graph/mappers.ts`
- Modify: `apps/api/src/lib/media/cache.ts`
- Create: `apps/api/src/lib/media/home.ts`
- Modify: `apps/api/src/lib/media/index.ts`
- Modify: `apps/api/src/app/api/intents/route.ts`
- Modify: `apps/api/src/lib/supabase/clients.ts`
- Modify: `apps/api/src/lib/supabase/README.md`
- Modify: `tests/support/graph.mjs`
- Modify: `tests/graph-contracts.test.mjs`
- Modify: `tests/derive-trip.test.mjs`
- Modify: `tests/intents-route.test.mjs`
- Modify: `tests/place-media-lookup.test.mjs`

**Interfaces:**

- Consumes: `readRows` and `publicPhotoUrl` (Task 4); `placeMediaKey` and `storageUrlSchema` (phase 1).
- Produces:
  - `intentSummarySchema.strip[]` gains `key?: string` (1 to 200 characters).
  - `intentListItemSchema` gains `photos: string[]` (at most 3 bucket URLs).
  - `withHomePhotos(db: SupabaseClient, items: IntentListItem[]): Promise<IntentListItem[]>` from `#lib/media`.

- [ ] **Step 1: Write the failing contract test**

In `tests/graph-contracts.test.mjs`:

1. Add `intentListItemSchema` and `intentSummarySchema` to the import from `../packages/types/src/index.ts`.
2. Add `intentRow` to the import from `./support/graph.mjs`.
3. Append:

```js
test('a Home strip stop may carry its media key; a list item carries up to three bucket photos', () => {
  const summary = (strip) => intentSummarySchema.safeParse({ line: 'x', strip });
  const item = (photos) =>
    intentListItemSchema.safeParse({
      id: intentRow.id,
      goal: intentRow.goal,
      template: 'travel',
      status: 'exploring',
      summary: { line: 'x' },
      lastActivityAt: intentRow.last_activity_at,
      photos,
    });
  const photo = 'https://x.supabase.co/storage/v1/object/public/place-photos/a/b-500.jpg';

  assert.equal(summary([{ label: 'Tokyo', ai: false, key: 'tokyo|JP|35.7|139.7' }]).success, true);
  assert.equal(summary([{ label: 'Tokyo', ai: false }]).success, true);
  assert.equal(summary([{ label: 'Tokyo', ai: false, key: 'x'.repeat(201) }]).success, false);
  assert.equal(item([photo]).success, true);
  assert.equal(item([]).success, true);
  assert.equal(item(undefined).success, false);
  assert.equal(item(['https://upload.wikimedia.org/x.jpg']).success, false);
  assert.equal(item([photo, photo, photo, photo]).success, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test tests/graph-contracts.test.mjs`
Expected: FAIL on the first `true` assertion (`key` is unrecognized).

- [ ] **Step 3: Extend the contracts**

In `packages/types/src/graph.ts`, replace `strip` in `intentSummarySchema`:

```ts
  strip: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(100),
        ai: z.boolean(),
        // The stop's media key (`placeMediaKey`), for Home's photos. A summary saved before
        // photos has none until its plan's next change.
        key: z.string().min(1).max(200).optional(),
      }),
    )
    .max(12)
    .optional(),
```

In `packages/types/src/api.ts`:

1. Import `storageUrlSchema` from `./media.ts`.
2. Add to `intentListItemSchema`, after `lastActivityAt`:

```ts
  // The 500px photos of the plan's first three stops that have one, from the media cache.
  photos: z.array(storageUrlSchema).max(3),
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `node --experimental-strip-types --test tests/graph-contracts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing derive and Home tests**

1. In `tests/support/graph.mjs`, give `intentRow.summary.strip` the keys `derive.trip` will write:

```js
    strip: [
      { label: 'Tokyo', ai: false, key: 'tokyo|JP|35.7|139.7' },
      { label: 'Kyoto', ai: false, key: 'kyoto|JP|35.0|135.8' },
    ],
```

2. In `tests/derive-trip.test.mjs`, change every expected strip entry the same way: Tokyo gains `key: 'tokyo|JP|35.7|139.7'` and Kyoto `key: 'kyoto|JP|35.0|135.8'`. Find them with `grep -n "label: '" tests/derive-trip.test.mjs`. Any other place-named entry gains the key `placeMediaKey` gives that test's place data.
3. In `tests/intents-route.test.mjs`:
   - Import `cacheRow` from `./support/media.mjs`.
   - Add `'table:place_media': () => [],` to the `postgrest({...})` handlers of "Home lists intents, most recent first" and "Home shows "Drafting" while a run works on an intent".
   - Add `photos: [],` after `lastActivityAt` in the first test's expected item.
   - Append:

```js
const BUCKET = 'https://nexui-test.supabase.co/storage/v1/object/public/place-photos';
const OLDER_ID = 'a1b2c3d4-0000-4000-8000-000000000301';

test('Home fills each card with its first stops’ cached photos and never looks anything up', async (t) => {
  const [tokyo, kyoto] = intentRow.summary.strip.map((stop) => stop.key);
  const older = {
    ...intentRow,
    id: OLDER_ID,
    summary: { line: '1 stop', strip: [{ label: 'Paris', ai: false }] },
  };
  let asked;
  const upstream = mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow, older],
      'table:runs': () => [],
      'table:place_media': (query) => {
        asked = query;

        return [
          cacheRow(tokyo, {
            photo: { path: 'a/b-960.jpg', thumbPath: 'a/b-500.jpg', width: 960, height: 640 },
            credit: {
              author: 'Kasa Fue',
              license: 'CC BY-SA 4.0',
              sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg',
            },
          }),
          cacheRow(kyoto, { status: 'none', page_title: null, page_url: null, extract: null }),
        ];
      },
    }),
  );

  const { items } = await (await GET(authed(url))).json();
  const hosts = upstream.mock.calls.map((call) => {
    const [input] = call.arguments;

    return new URL(input instanceof Request ? input.url : String(input)).hostname;
  });

  assert.deepEqual(
    items.map((item) => item.photos),
    [[`${BUCKET}/a/b-500.jpg`], []],
  );
  assert.ok(asked.searchParams.get('key').includes(tokyo));
  assert.ok(
    hosts.every((host) => host === 'nexui-test.supabase.co'),
    'nothing is looked up',
  );
});

test('a failed photo read still lists the plans, without photos', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': () => [intentRow],
      'table:runs': () => [],
      'table:place_media': () => pgError('XX000', 500),
    }),
  );

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items[0].photos, []);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'Could not load Home photos (XX000).',
  ]);
});
```

4. In `tests/place-media-lookup.test.mjs`, import `readRows` from `../apps/api/src/lib/media/cache.ts` and append:

```js
test('the cache is read at most 100 keys per query', async (t) => {
  const upstream = mediaUpstream({ rows: [cacheRow('k 150')] });

  t.mock.method(globalThis, 'fetch', upstream.handler);

  const rows = await readRows(
    adminDb(),
    Array.from({ length: 250 }, (_, index) => `k ${index}`),
  );

  assert.equal(upstream.state.reads, 3);
  assert.deepEqual([...rows.keys()], ['k 150']);
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/derive-trip.test.mjs tests/intents-route.test.mjs tests/place-media-lookup.test.mjs`
Expected: FAIL.

- `derive-trip`'s "a trip whose figures and summary are current derives nothing" gets an `update_intent` op, because the derived strip has no keys.
- The Home tests fail on `photos`: absent, which the schema rejects with a 500.
- The chunking test sees 1 read, not 3.

- [ ] **Step 7: Write the keys, the chunked read and the Home photos**

1. In `apps/api/src/lib/kinds/trip.ts`, add `placeMediaKey` to the `@nexui/types` import and replace the strip in `tripSummary`:

```ts
if (places.length > 0) {
  summary.strip = places.slice(0, 12).map((place) => {
    const data = place.data as PlaceData;

    return {
      label: data.name.slice(0, 100),
      ai: place.source?.type === 'ai' && !place.source.reviewedAt,
      key: placeMediaKey(data),
    };
  });
}
```

2. In `apps/api/src/lib/graph/mappers.ts`, in `mapIntentListRow`, add after `lastActivityAt`:

```ts
    // Filled from the media cache by the list route (`withHomePhotos`).
    photos: [],
```

3. In `apps/api/src/lib/media/cache.ts`, add after `COLUMNS`:

```ts
// Keys per query: a PostgREST filter rides in the URL, and Home can ask for 300 keys.
const KEYS_PER_QUERY = 100;
```

Then replace `readRows` with this version. The early return for no keys goes, since no keys now means no chunks and no query:

```ts
/** The cached rows for some keys, 100 keys per query. A row that doesn't parse is left out. */
export async function readRows(
  db: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, MediaRow>> {
  const rows = new Map<string, MediaRow>();
  const chunks: string[][] = [];

  for (let start = 0; start < keys.length; start += KEYS_PER_QUERY) {
    chunks.push(keys.slice(start, start + KEYS_PER_QUERY));
  }

  const answers = await Promise.all(
    chunks.map((chunk) => db.from('place_media').select(COLUMNS).in('key', chunk)),
  );

  for (const { data, error } of answers) {
    if (error) {
      throw new MediaCacheError(error.code);
    }

    for (const raw of data) {
      const parsed = rowSchema.safeParse(raw);

      if (parsed.success) {
        const row = parsed.data;
        const photo = storedPhotoSchema.safeParse(row.photo);
        const credit = photoCreditSchema.safeParse(row.credit);

        rows.set(row.key, {
          key: row.key,
          status: row.status,
          lookupVersion: row.lookup_version,
          pinned: row.pinned,
          pageTitle: row.page_title,
          pageUrl: row.page_url,
          extract: row.extract,
          photo: photo.success ? photo.data : null,
          credit: credit.success ? credit.data : null,
          expiresAt: row.expires_at,
        });
      }
    }
  }

  return rows;
}
```

4. Create `apps/api/src/lib/media/home.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { storageUrlSchema, type IntentListItem } from '@nexui/types';

import { logLine } from '#lib/graph';

import { readRows } from './cache.ts';
import type { MediaRow } from './rules.ts';
import { publicPhotoUrl } from './storage.ts';

/** A Home card shows the photos of its plan's first three stops (spec section 4). */
const CARD_STOPS = 3;

function cardKeys(item: IntentListItem): string[] {
  return (item.summary.strip ?? [])
    .slice(0, CARD_STOPS)
    .flatMap((stop) => (stop.key ? [stop.key] : []));
}

// A stop's 500px photo URL from its cached row, or nothing.
function cardPhoto(db: SupabaseClient, row: MediaRow | undefined): string[] {
  if (row?.status !== 'found' || !row.photo || !row.credit) {
    return [];
  }

  const url = storageUrlSchema.safeParse(publicPhotoUrl(db, row.photo.thumbPath));

  return url.success ? [url.data] : [];
}

/**
 * Home's cards with their photos (spec section 4): the 500px copies of each plan's first three
 * stops, read from the cache in one go. Nothing is looked up, so Home stays fast. A stop with
 * no cached photo, or a summary from before photos, is simply left out, and expired rows still
 * count, since stored files never move. A failed read is logged, and the cards keep no photos.
 */
export async function withHomePhotos(
  db: SupabaseClient,
  items: IntentListItem[],
): Promise<IntentListItem[]> {
  const keys = [...new Set(items.flatMap(cardKeys))];

  if (keys.length === 0) {
    return items;
  }

  let rows: Map<string, MediaRow>;

  try {
    rows = await readRows(db, keys);
  } catch (error) {
    console.error('[media]', logLine(error, 'Could not load Home photos'));

    return items;
  }

  return items.map((item) => ({
    ...item,
    photos: cardKeys(item).flatMap((key) => cardPhoto(db, rows.get(key))),
  }));
}
```

5. In `apps/api/src/lib/media/index.ts`, add:

```ts
export { withHomePhotos } from './home.ts';
```

6. In `apps/api/src/app/api/intents/route.ts`:
   - Import `withHomePhotos` from `#lib/media`, and add `getAdminClient` to the `#lib/supabase` import.
   - In `GET`, replace the `items` line:

```ts
const listed = await listIntents(getUserClient(user.accessToken));
// The user's own summaries name the keys; the secret-key client reads the shared cache.
const items = await withHomePhotos(getAdminClient(), listed);
```

- Update `GET`'s doc comment to "Home's cards, with their stops' cached photos."

7. In `apps/api/src/lib/supabase/clients.ts`, update `getAdminClient`'s comment:

```ts
// Bypasses row-level security. Only use it for account deletion, the run worker, whose
// database functions scope every write to the run it holds, and the shared place media cache
// and its photo bucket, after the route has loaded the caller's own plans.
```

In `apps/api/src/lib/supabase/README.md`, replace "the shared place media cache (after the route checks the caller owns the plan)" with "the shared place media cache and its photo bucket (after the route has loaded the caller's own plans)".

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/derive-trip.test.mjs tests/intents-route.test.mjs tests/place-media-lookup.test.mjs tests/graph-contracts.test.mjs`
Expected: PASS, every test.

- [ ] **Step 9: Run the full suite and checks**

Run: `pnpm test > .superpowers/task6.log 2>&1; tail -5 .superpowers/task6.log && pnpm typecheck && pnpm lint`
Expected: every test passes. Any other test that pins a derived summary now expects `key` on its strip entries: add the key from `placeMediaKey` for that test's place, and ledger which ones changed. Typecheck and lint pass; the mobile app ignores the new fields until Task 9.

- [ ] **Step 10: Commit**

```bash
pnpm fix
git add packages/types/src apps/api/src tests
git commit -m "Show cached place photos on Home's cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The mobile photo building blocks

**Files:**

- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml` (via `expo install`)
- Modify: `apps/mobile/src/theme/theme.ts`
- Modify: `tests/theme-tokens.test.mjs`
- Modify: `apps/mobile/src/data/place-media.ts`
- Modify: `apps/mobile/src/data/queries.ts`
- Modify: `apps/mobile/src/data/index.ts`
- Modify: `apps/mobile/src/lib/format.ts`
- Modify: `apps/mobile/src/lib/index.ts`
- Create: `apps/mobile/src/features/home/photo-band.ts`
- Create: `apps/mobile/src/ui/place-photo.tsx`
- Modify: `apps/mobile/src/ui/index.ts`
- Modify: `tests/mobile-place-media.test.mjs`
- Modify: `tests/mobile-format.test.mjs`
- Create: `tests/mobile-photo-band.test.mjs`

**Interfaces:**

- Consumes: `PlacePhoto`, `PhotoCredit` and `IntentListItem` (with `photos`) from `@nexui/types`.
- Produces:
  - Tokens `photoScrim` and `photoInk`.
  - From `#data`: `type PhotoState = PlacePhoto | 'pending' | null`; `placePhoto(media, placeId, query): PhotoState`; `placePhotos(media, placeIds, query): Record<string, PhotoState>`; `usePlacePhotos(intentId: string, placeIds: readonly string[]): Readonly<Record<string, PhotoState>>`.
  - From `#lib`: `photoCredit(credit: Pick<PhotoCredit, 'author' | 'license'>): string`.
  - `photoBand(item: Pick<IntentListItem, 'photos' | 'summary'>): PhotoBand`, where `PhotoBand = { photos: string[]; more: number }`.
  - From `#ui`: `PlacePhoto({ uri: string | null; height: number; radius?: number; label?: string })`.

- [ ] **Step 1: Write the failing tests**

1. In `tests/theme-tokens.test.mjs`:
   - Add to both `expected.light` and `expected.dark`, after `skyCrater`:

```js
    photoScrim: 'rgba(30, 26, 43, 0.72)',
    photoInk: '#FFFFFF',
```

- Add `['photoInk', 'photoScrim'],` to `textPairs`.

2. In `tests/mobile-place-media.test.mjs`, add `placePhoto` and `placePhotos` to the `place-media.ts` import and append:

```js
test('a photo slot shows the photo, pending while it may still come, or nothing', () => {
  const photo = {
    url: 'https://x.supabase.co/storage/v1/object/public/place-photos/a/b-960.jpg',
    thumbUrl: 'https://x.supabase.co/storage/v1/object/public/place-photos/a/b-500.jpg',
    width: 960,
    height: 640,
    credit: {
      author: 'Kasa Fue',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg',
    },
  };
  const media = {
    places: { [TOKYO_ID]: { ...ready, photo }, [KYOTO_ID]: { status: 'pending' } },
  };
  const asking = { loading: false, answers: 1 };

  assert.equal(placePhoto(media, TOKYO_ID, asking), photo);
  assert.equal(placePhoto(media, KYOTO_ID, asking), 'pending');
  assert.equal(placePhoto(media, KYOTO_ID, { loading: false, answers: MEDIA_POLLS + 1 }), null);
  assert.equal(placePhoto({ places: { [TOKYO_ID]: ready } }, TOKYO_ID, asking), null);
  assert.equal(placePhoto(undefined, TOKYO_ID, { loading: true, answers: 0 }), 'pending');
  assert.equal(placePhoto(undefined, TOKYO_ID, { loading: false, answers: 0 }), null);
  assert.deepEqual(placePhotos(media, [TOKYO_ID, KYOTO_ID], asking), {
    [TOKYO_ID]: photo,
    [KYOTO_ID]: 'pending',
  });
});
```

3. In `tests/mobile-format.test.mjs`, add `photoCredit` to the import that brings in `capitalize` and the other format helpers, and append:

```js
test('a photo credit names the author and licence, via Wikimedia Commons', () => {
  assert.equal(
    photoCredit({ author: 'Kasa Fue', license: 'CC BY-SA 4.0' }),
    'Photo: Kasa Fue, CC BY-SA 4.0, via Wikimedia Commons',
  );
  assert.equal(
    photoCredit({ author: '', license: 'Public domain' }),
    'Photo: Public domain, via Wikimedia Commons',
  );
});
```

4. Create `tests/mobile-photo-band.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { photoBand } from '../apps/mobile/src/features/home/photo-band.ts';

const stops = (count) =>
  Array.from({ length: count }, (_, index) => ({ label: `Stop ${index + 1}`, ai: false }));
const card = (photos, count) => ({ photos, summary: { line: '', strip: stops(count) } });

test('a Home card shows its photos, with "+N" for the stops beyond them', () => {
  assert.deepEqual(photoBand(card(['a', 'b', 'c'], 4)), { photos: ['a', 'b', 'c'], more: 1 });
  assert.deepEqual(photoBand(card(['a', 'c'], 4)), { photos: ['a', 'c'], more: 2 });
  assert.deepEqual(photoBand(card(['a'], 1)), { photos: ['a'], more: 0 });
});

test('a card with no photos has no band, so no "+N"', () => {
  assert.deepEqual(photoBand(card([], 3)), { photos: [], more: 0 });
  assert.deepEqual(photoBand({ photos: [], summary: { line: '' } }), { photos: [], more: 0 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --experimental-strip-types --test tests/theme-tokens.test.mjs tests/mobile-place-media.test.mjs tests/mobile-format.test.mjs tests/mobile-photo-band.test.mjs`
Expected: FAIL.

- The token test fails because `photoScrim` is missing.
- The other three files fail on missing exports `placePhoto`, `photoCredit`, and the missing module `photo-band.ts`.

- [ ] **Step 3: Add the tokens**

In `apps/mobile/src/theme/theme.ts`, add to `light` after `skyCrater`:

```ts
  photoScrim: 'rgba(30, 26, 43, 0.72)', // behind text and buttons drawn on a photo, both schemes
  photoInk: '#FFFFFF', // text on photoScrim
```

Add the same two values to `dark`, after its `skyCrater`:

```ts
  photoScrim: 'rgba(30, 26, 43, 0.72)',
  photoInk: '#FFFFFF',
```

- [ ] **Step 4: Add the photo state**

In `apps/mobile/src/data/place-media.ts`:

1. Change the type import to `import type { GraphSnapshot, IntentMedia, PlaceAbout, PlaceMedia, PlacePhoto } from '@nexui/types';`.
2. Replace `placeAbout` with:

```ts
/** How far the media query has got: still loading, and how many answers it has had. */
export interface MediaQueryState {
  loading: boolean;
  answers: number;
}

/** What a photo slot shows: the photo, `'pending'` while it may still come, or null. */
export type PhotoState = PlacePhoto | 'pending' | null;

type ReadyMedia = Extract<PlaceMedia, { status: 'ready' }>;

// One place's answer through `pick`. A ready answer shows. A pending lookup shows as pending
// while the app is still polling, and nothing once the polls run out. With no answer yet, it's
// pending while the request loads.
function placeEntry<T>(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
  pick: (entry: ReadyMedia) => T,
): T | 'pending' | null {
  const entry = media?.places[placeId];

  if (entry?.status === 'ready') {
    return pick(entry);
  }

  if (entry?.status === 'pending') {
    return mediaPollInterval(media, query.answers) === false ? null : 'pending';
  }

  return query.loading ? 'pending' : null;
}

/**
 * What the stop sheet's About shows for one place: its introduction, `'pending'` while the
 * answer loads or the lookup runs and the app is still polling, or null (no article, a failed
 * lookup, a failed request, or polls that ran out).
 */
export function placeAbout(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
): PlaceAbout | 'pending' | null {
  return placeEntry(media, placeId, query, (entry) => entry.about);
}

/** One place's photo slot, by the same rules as `placeAbout`. */
export function placePhoto(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
): PhotoState {
  return placeEntry(media, placeId, query, (entry) => entry.photo);
}

/** Every place's photo slot by id, for the workspace's sections and the stop sheet. */
export function placePhotos(
  media: IntentMedia | undefined,
  placeIds: readonly string[],
  query: MediaQueryState,
): Record<string, PhotoState> {
  return Object.fromEntries(placeIds.map((id) => [id, placePhoto(media, id, query)]));
}
```

3. In `apps/mobile/src/data/queries.ts`:
   - Change the `./place-media` import to bring in `placePhotos` and `type PhotoState` as well, and `type MediaQueryState`.
   - Replace `usePlaceAbout` with:

```ts
// One intent's media and how far its query has got, for `placeAbout` and `placePhotos`.
function useMediaAnswers(
  intentId: string,
  placeIds: readonly string[],
): { media: IntentMedia | undefined; query: MediaQueryState } {
  const client = useQueryClient();
  const media = usePlaceMedia(intentId, placeIds);
  const answers =
    client.getQueryState(queryKeys.media(intentId, mediaKeyIds(placeIds)))?.dataUpdateCount ?? 0;

  return {
    media: media.data,
    query: { loading: media.isPending || media.isPlaceholderData, answers },
  };
}

/**
 * What a stop sheet's About shows for one place (`placeAbout`), from the same query as
 * `usePlaceMedia`. A lookup still pending once the polls have run out shows nothing.
 */
export function usePlaceAbout(
  intentId: string,
  placeIds: readonly string[],
  placeId: string,
): PlaceAbout | 'pending' | null {
  const { media, query } = useMediaAnswers(intentId, placeIds);

  return placeAbout(media, placeId, query);
}

/**
 * Every place's photo slot by id (`placePhotos`), from the same query as `usePlaceMedia`, so
 * calling it also starts the plan's lookups.
 */
export function usePlacePhotos(
  intentId: string,
  placeIds: readonly string[],
): Readonly<Record<string, PhotoState>> {
  const { media, query } = useMediaAnswers(intentId, placeIds);

  return placePhotos(media, placeIds, query);
}
```

- Make sure `IntentMedia` is in the `@nexui/types` type import.

4. In `apps/mobile/src/data/index.ts`, add `usePlacePhotos` to the `./queries` export list, and below the `mediaPlaceIds` export add:

```ts
export type { PhotoState } from './place-media';
```

- [ ] **Step 5: Add the credit line and the band**

1. In `apps/mobile/src/lib/format.ts`, add `type PhotoCredit` to the `@nexui/types` import and append:

```ts
/**
 * A photo's credit line, as the stop sheet shows it under the photo.
 *
 * @example
 * photoCredit({ author: 'Kasa Fue', license: 'CC BY-SA 4.0' })
 * // 'Photo: Kasa Fue, CC BY-SA 4.0, via Wikimedia Commons'
 */
export function photoCredit(credit: Pick<PhotoCredit, 'author' | 'license'>): string {
  const who = [credit.author, credit.license].filter(Boolean).join(', ');

  return `Photo: ${who}, via Wikimedia Commons`;
}
```

Add `photoCredit,` to the `./format.ts` export list in `apps/mobile/src/lib/index.ts`, in alphabetical order.

2. Create `apps/mobile/src/features/home/photo-band.ts`:

```ts
import type { IntentListItem } from '@nexui/types';

/** A Home card's photo band: its photos, and how many more stops the plan has (the "+N"). */
export interface PhotoBand {
  photos: string[];
  more: number;
}

/**
 * The band for a card (spec section 5): the photos the API sent, and "+N" for the plan's stops
 * beyond them. A card with no photos has no band. The summary's strip holds at most 12 stops.
 *
 * @example
 * photoBand({ photos: [berlin, prague, vienna], summary }) // { photos: [...], more: 1 } for 4 stops
 */
export function photoBand(item: Pick<IntentListItem, 'photos' | 'summary'>): PhotoBand {
  if (item.photos.length === 0) {
    return { photos: [], more: 0 };
  }

  const stops = item.summary.strip?.length ?? 0;

  return { photos: item.photos, more: Math.max(0, stops - item.photos.length) };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test tests/theme-tokens.test.mjs tests/mobile-place-media.test.mjs tests/mobile-format.test.mjs tests/mobile-photo-band.test.mjs`
Expected: PASS, every test.

- [ ] **Step 7: Install expo-image and write `PlacePhoto`**

Run: `pnpm --dir apps/mobile exec expo install expo-image`
Expected: `apps/mobile/package.json` gains `"expo-image": "~57.0.<n>"` (the SDK 57 version `expo install` picks), and `pnpm-lock.yaml` changes. Confirm with `git diff --stat`.

Create `apps/mobile/src/ui/place-photo.tsx`:

```tsx
import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import { createThemedStyles } from '#theme';

/**
 * A place photo from our storage, `height` points tall and filling its width. It shows a soft
 * tile while the image loads, or when `uri` is null (still being looked up, or none beside
 * others that have one). The photo fades in and is cached on disk.
 *
 * It is decorative unless it has a `label`, such as "Photo of Berlin".
 *
 * @example
 * <PlacePhoto uri={photo.url} height={148} radius={16} />
 */
export function PlacePhoto({
  uri,
  height,
  radius = 0,
  label,
}: {
  uri: string | null;
  height: number;
  radius?: number;
  label?: string;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? undefined : 'image'}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      style={[styles.frame, { height, borderRadius: radius }]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          accessible={false}
          alt=""
          style={styles.image}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  frame: { overflow: 'hidden', backgroundColor: colors.soft },
  image: { width: '100%', height: '100%' },
}));
```

If `expo-image`'s installed types name the alternative-text prop differently from `alt`, use the prop they define for web alt text and ledger it.

Add to `apps/mobile/src/ui/index.ts`, in alphabetical order:

```ts
export { PlacePhoto } from './place-photo';
```

- [ ] **Step 8: Run the full suite and checks**

Run: `pnpm test > .superpowers/task7.log 2>&1; tail -5 .superpowers/task7.log && pnpm typecheck && pnpm lint`
Expected: every test passes; typecheck and lint pass.

- [ ] **Step 9: Commit**

```bash
pnpm fix
git add apps/mobile pnpm-lock.yaml tests/theme-tokens.test.mjs tests/mobile-place-media.test.mjs tests/mobile-format.test.mjs tests/mobile-photo-band.test.mjs
git commit -m "Add expo-image, photo tokens and the photo state for the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Photo cards on the route and photos on decision options

**Files:**

- Modify: `apps/mobile/src/features/workspace/sections/types.ts`
- Modify: `apps/mobile/src/features/workspace/sections/registry.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`
- Modify: `apps/mobile/src/features/workspace/sections/route-section.tsx`
- Modify: `apps/mobile/src/features/workspace/sections/comparison-table.tsx`
- Modify: `apps/mobile/src/features/workspace/sections/decision-section.tsx`

**Interfaces:**

- Consumes: `usePlacePhotos`, `PhotoState` (`#data`) and `PlacePhoto` (`#ui`) from Task 7.
- Produces:
  - `SectionProps.photos: Readonly<Record<string, PhotoState>>`.
  - `SectionView` takes `photos`.
  - `ComparisonColumn.photo?: string | null`.

- [ ] **Step 1: Pass the photos to every section**

1. In `sections/types.ts`, import `type PhotoState` from `#data` (between the `@nexui/types` import and the relative ones, per the import order) and add to `SectionProps`:

```ts
/** Each place's photo slot by id; a place missing from it has none. */
photos: Readonly<Record<string, PhotoState>>;
```

2. In `sections/registry.tsx`, import `type PhotoState` from `#data`. Add `photos` to `SectionView`'s props (`photos: Readonly<Record<string, PhotoState>>;`) and pass `photos={photos}` to `<Primitive …/>`.
3. In the workspace screen `intent/[id].tsx`:
   - Replace `usePlaceMedia` with `usePlacePhotos` in the `#data` import.
   - Replace the `usePlaceMedia(id, placeIds);` line and its comment with:

```ts
// Looks the plan's places up as soon as it's open, so stops show their photos and a stop's
// sheet opens with its details.
const photos = usePlacePhotos(id, placeIds);
```

- Pass `photos={photos}` to both `<SectionView …/>` elements.

- [ ] **Step 2: Turn route stops with photos into cards**

In `sections/route-section.tsx`:

1. Add `import type { PhotoState } from '#data';` before the `#lib` import, and add `PlacePhoto` to the `#ui` import.
2. Replace `StopRow`'s doc comment, props and body:

```tsx
/**
 * One stop. With a photo, or while one may still come, it's a card: the photo full width with
 * the stop's number on it, then the name, type and `why`. Without one it's the compact row.
 * Either way the text is one button that opens the stop's details, with the order and day
 * controls on a line below.
 */
function StopRow({
  stop,
  photo,
  was,
  canDays,
  canOrder,
  isFirst,
  isLast,
  onDays,
  onMove,
  onOpen,
}: {
  stop: RouteStop;
  photo: PhotoState;
  was: number | undefined;
  canDays: boolean;
  canOrder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onDays: (days: number) => void;
  onMove: (by: -1 | 1) => void;
  onOpen: () => void;
}): ReactElement {
  const styles = useStyles();
  const data = stop.place.data as PlaceData;
  const name = placeName(stop.place);
  const card = photo !== null;

  return (
    <View style={styles.stop}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopButtonLabel(name, stop.order, data.days)}
        onPress={onOpen}
        style={({ pressed }) => [card ? styles.card : styles.open, pressed && styles.pressed]}
      >
        {photo === null ? (
          <View style={styles.number}>
            <Text style={styles.numberText}>{stop.order}</Text>
          </View>
        ) : (
          <View>
            <PlacePhoto uri={photo === 'pending' ? null : photo.url} height={148} radius={16} />
            <View style={[styles.number, styles.photoNumber]}>
              <Text style={styles.numberText}>{stop.order}</Text>
            </View>
          </View>
        )}
        <View style={card ? styles.cardBody : styles.body}>
          <View style={styles.nameRow}>
            <View style={styles.nameText}>
              <AiText text={name} highlight={aiMarkFor(stop.place).highlight} style={styles.name} />
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
          <Text style={styles.kind}>{stopKind(data)}</Text>
          {data.why ? (
            <Text style={styles.detail} numberOfLines={2}>
              {data.why}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={[styles.controls, card && styles.cardControls]}>
        {canOrder ? (
          <View style={styles.moves}>
            <SmallButton
              glyph="↑"
              label={`Move ${name} earlier`}
              disabled={isFirst}
              onPress={() => onMove(-1)}
            />
            <SmallButton
              glyph="↓"
              label={`Move ${name} later`}
              disabled={isLast}
              onPress={() => onMove(1)}
            />
          </View>
        ) : (
          <View />
        )}
        {canDays ? (
          <DayStepper name={name} days={data.days} was={was} onDays={onDays} />
        ) : (
          <Text style={styles.days}>{formatDays(data.days)}</Text>
        )}
      </View>
    </View>
  );
}
```

3. In `RouteSection`:
   - Destructure `photos`: `{ section, data, onAction, photos }: SectionProps<'route'>`.
   - Pass `photo={photos[stop.place.id] ?? null}` to `<StopRow …/>`.
   - Update its doc comment to: "The stops in order, with legs between them; a stop with a photo is a photo card. Days and order are editable when allowed, and each stop opens its details."
4. In `useStyles`, add after `open`:

```ts
  card: { gap: 10, minHeight: 44 },
  // The number on a photo: the route's stop number, ringed so it reads on any photo.
  photoNumber: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 0,
    borderWidth: 2,
    borderColor: colors.card,
  },
```

After `body`, add `cardBody: { gap: 2 },`. After `controls`, add `cardControls: { paddingLeft: 0, paddingTop: 4 },`.

- [ ] **Step 3: Give comparison columns an optional photo**

In `sections/comparison-table.tsx`:

1. Add `PlacePhoto` to the `#ui` import.
2. Add to `ComparisonColumn`:

```ts
  /**
   * A photo above the title: its URL, null for a soft tile (loading, or none beside columns
   * that have one), or absent. The photo row shows when any column has one.
   */
  photo?: string | null;
```

3. In `ComparisonTable`, after `const styles = useStyles();`, add:

```ts
const photos = columns.some((column) => column.photo !== undefined);
```

4. Replace the head cell's `<View key={column.id} …>`:

```tsx
<View
  key={column.id}
  style={[styles.cell, column.tentative && styles.tentative, photos && styles.photoCell]}
>
  {photos ? <PlacePhoto uri={column.photo ?? null} height={80} radius={8} /> : null}
  <AiText text={column.title} highlight={column.highlight} tag={false} style={styles.head} />
</View>
```

5. Add to `useStyles`, after `tentative`:

```ts
  photoCell: { gap: 6, paddingVertical: 6 },
```

6. Update the component's doc comment, appending: "Columns may carry a photo, shown above their titles (spec section 5's decision options)."

- [ ] **Step 4: Pass each candidate's photo**

In `sections/decision-section.tsx`:

1. Add `import type { PhotoState } from '#data';` before the `#lib` import.
2. Add above `decisionRows`:

```ts
// A candidate's photo slot (spec section 5): its 500px copy, a soft tile while it may still
// come, or none.
function candidatePhoto(state: PhotoState | undefined): string | null | undefined {
  if (state === 'pending') {
    return null;
  }

  return state ? state.thumbUrl : undefined;
}
```

3. Destructure `photos` in `DecisionSection`'s props (`{ section, data, onAction, busy, photos }`).
4. Add to each column in `columns`:

```ts
    photo: candidatePhoto(entry.place ? photos[entry.place.id] : undefined),
```

- [ ] **Step 5: Run the checks**

Run: `pnpm typecheck && pnpm lint && pnpm test > .superpowers/task8.log 2>&1; tail -5 .superpowers/task8.log`
Expected: typecheck and lint pass; every test passes. These are presentational changes. Task 11's smoke test checks them on screen; no Node test loads `.tsx`.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add apps/mobile/src
git commit -m "Show photo cards on the route and photos on decision options

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The sheet's photo and Home's band

**Files:**

- Modify: `apps/mobile/src/features/place/place-sheet.tsx`
- Modify: `apps/mobile/src/app/(app)/place.tsx`
- Modify: `apps/mobile/src/features/home/intent-card.tsx`

**Interfaces:**

- Consumes: `PhotoState`, `usePlacePhotos`, `PlacePhoto`, `photoCredit` and `photoBand` (Task 7).
- Produces: `PlaceSheet` gains `photo: PhotoState`, and `onReadMore` is renamed `onOpenLink: (url: string) => void`.

- [ ] **Step 1: Open the sheet on its photo**

In `features/place/place-sheet.tsx`:

1. Import `type PhotoState` from `#data` (before `#lib`), add `photoCredit` to the `#lib` import and `PlacePhoto` to the `#ui` import, and add `PhotoCredit` to the `@nexui/types` type import.
2. In `About`, rename the prop `onReadMore` to `onOpenLink`, in its type and its use.
3. After `About`, add:

```tsx
function Credit({ credit, onPress }: { credit: PhotoCredit; onPress: () => void }): ReactElement {
  const styles = useStyles();
  const line = photoCredit(credit);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${line}. Open the photo's page`}
      onPress={onPress}
      style={({ pressed }) => [styles.credit, pressed && styles.pressed]}
    >
      <Text style={styles.creditText}>{line}</Text>
    </Pressable>
  );
}
```

4. Update `PlaceSheet`:
   - Doc comment: "A route stop's details (spec section 5): its photo and credit, its name and place on the route, days and daily cost, why it's on the route, Wikipedia's introduction, the next stop and where you'll stay. It only reports taps; the place screen does the work."
   - Props: add `photo` after `about`, and rename `onReadMore` to `onOpenLink`:

```tsx
  photo: PhotoState;
  …
  /** Opens a link outside the app: the Wikipedia article or the photo's Commons page. */
  onOpenLink: (url: string) => void;
```

- Replace the `<Button label="Done" … />` line at the top of the returned `<View>`:

```tsx
{
  photo === null ? (
    <Button label="Done" onPress={onDone} style={styles.done} />
  ) : (
    <View style={styles.hero}>
      <PlacePhoto
        uri={photo === 'pending' ? null : photo.url}
        height={244}
        label={photo === 'pending' ? undefined : `Photo of ${name}`}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onDone}
        style={({ pressed }) => [styles.photoDone, pressed && styles.pressed]}
      >
        <Text style={styles.photoDoneText}>Done</Text>
      </Pressable>
    </View>
  );
}
{
  photo !== null && photo !== 'pending' ? (
    <Credit credit={photo.credit} onPress={() => onOpenLink(photo.credit.sourceUrl)} />
  ) : null;
}
```

- Change `<About name={name} about={about} onReadMore={onReadMore} />` to pass `onOpenLink={onOpenLink}`.

5. Add to `useStyles`, after `done`:

```ts
  // Bleeds through the place screen's padding (20 at the sides, 12 on top) to the sheet's edges.
  hero: { marginHorizontal: -20, marginTop: -12 },
  photoDone: {
    position: 'absolute',
    top: 16,
    right: 14,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: colors.photoScrim,
  },
  photoDoneText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.photoInk },
  credit: { minHeight: 44, justifyContent: 'center' },
  creditText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.faint,
    textDecorationLine: 'underline',
  },
```

- [ ] **Step 2: Give the sheet its photo**

In `app/(app)/place.tsx`:

1. Add `usePlacePhotos` to the `#data` import.
2. After `const about = …`, add:

```ts
const photo = usePlacePhotos(intentId, placeIds)[placeId] ?? null;
```

3. In `<PlaceSheet …/>`:
   - Add `photo={photo}` after `about={about}`.
   - Replace `onReadMore={(url) => void Linking.openURL(url).catch(() => undefined)}` with `onOpenLink={(url) => void Linking.openURL(url).catch(() => undefined)}`.
4. Update the screen's doc comment: "…the place's Wikipedia details and photo from the media query…".

The hero's negative margins depend on `styles.content`'s `paddingHorizontal: 20` and `paddingTop: 12` here. Add to that style's line the comment `// PlaceSheet's photo bleeds through this padding.`

- [ ] **Step 3: Add the photo band to Home's cards**

Replace `features/home/intent-card.tsx` with:

```tsx
import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { IntentListItem } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { AiText, PlacePhoto, Pill } from '#ui';

import { photoBand, type PhotoBand } from './photo-band';

/** Up to three photos across the top of a card, with "+N" on the last for the stops beyond. */
function Band({ band }: { band: PhotoBand }): ReactElement {
  const styles = useStyles();
  const last = band.photos.length - 1;

  return (
    <View style={styles.band}>
      {band.photos.map((uri, index) => (
        <View key={`${index}-${uri}`} style={styles.tile}>
          <PlacePhoto uri={uri} height={108} />
          {index === last && band.more > 0 ? (
            <View style={styles.more}>
              <Text style={styles.moreText}>+{band.more}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * A plan on Home: a band of its stops' photos when it has any, then its goal, badge, summary
 * line and a mini route of its stops. With `onDelete`, screen readers also offer a Delete
 * action, the counterpart of swiping the card away.
 */
export function IntentCard({
  item,
  onPress,
  onDelete,
}: {
  item: IntentListItem;
  onPress: () => void;
  onDelete?: () => void;
}): ReactElement {
  const styles = useStyles();
  const { summary } = item;
  const strip = summary.strip ?? [];
  const band = photoBand(item);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.goal, summary.badge?.text, summary.line].filter(Boolean).join(', ')}
      accessibilityActions={onDelete ? [{ name: 'delete', label: 'Delete' }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') {
          onDelete?.();
        }
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {band.photos.length > 0 ? <Band band={band} /> : null}
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.goal} numberOfLines={2}>
            {item.goal}
          </Text>
          {summary.badge ? <Pill text={summary.badge.text} tone={summary.badge.tone} /> : null}
        </View>
        {summary.line ? <Text style={styles.line}>{summary.line}</Text> : null}
        {strip.length > 0 ? (
          <View style={styles.strip}>
            {strip.map((stop, index) => (
              <Fragment key={`${stop.label}-${index}`}>
                {index > 0 ? <View style={styles.connector} /> : null}
                <AiText text={stop.label} highlight={stop.ai} tag={false} style={styles.stop} />
              </Fragment>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.card },
  pressed: { opacity: 0.8 },
  band: { flexDirection: 'row', gap: 2, height: 108 },
  tile: { flex: 1 },
  more: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: colors.photoScrim,
  },
  moreText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.photoInk },
  body: { gap: 8, padding: 16 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  goal: { flex: 1, fontFamily: fonts.heading, fontSize: 18, lineHeight: 23, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  connector: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.line },
  stop: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
}));
```

`photo-band.ts` sits in the same feature folder, so it's imported directly. The feature barrel `features/home/index.ts` doesn't need to export it.

- [ ] **Step 4: Run the checks**

Run: `pnpm typecheck && pnpm lint && pnpm test > .superpowers/task9.log 2>&1; tail -5 .superpowers/task9.log`
Expected: typecheck and lint pass; every test passes.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/mobile/src
git commit -m "Open the stop sheet on its photo and show photo bands on Home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs

**Files:**

- Modify: `docs/architecture/place-media.md`
- Modify: `docs/architecture/mobile.md`
- Modify (if `docs-keeper` finds them stale): `AGENTS.md`, `README.md`, `docs/architecture/intent-graph.md`

**Interfaces:**

- Consumes: everything above.
- Produces: docs that describe phase 2 as it now is.

- [ ] **Step 1: Update `docs/architecture/place-media.md`**

Rewrite it to describe phases 1 and 2 as built. Keep its structure and add or change:

- **Intro:** the sheet's introduction and the photos on route cards, decision options, Home cards and the sheet all come from the same cache. Drop "this doc covers … (phase 1)".
- **The lookup:**
  - `isUsableImage`, then request 2 on Commons (`fileInfo`, its parameters).
  - `photoSource`: licence, non-free, 960px thumbnail on `upload.wikimedia.org`, file page on Commons, the 500px URL by replacing the width, author from `Artist` via `plainText`.
  - `downloadImage`: `redirect: 'error'`, the format from the bytes, at most 2 MB.
  - `storage.ts`'s `copyPhoto` and `photoPath`, with the path formula, one-year cache and upsert.
  - Which failures are "no photo" (rejected content) and which are `failed` (HTTP, network, storage, throttles).
- **The cache:**
  - `lookup_version` is 2.
  - `photo` holds `{ path, thumbPath, width, height }` and `credit` holds `{ author, license, licenseUrl?, sourceUrl }`.
  - Stored files are never deleted: a refresh writes new content-named files.
  - "Fixing a wrong match" adds `photo = null, credit = null` to the example. Swapping a photo means uploading a file and pointing `photo` at it, then pinning.
- **The bucket:** `20261004150000_place_photos_bucket.sql`, public, the three types, 2 MB, no policies; URLs come from `getPublicUrl`.
- **The route:** answers carry `photo` with bucket URLs. A photo whose URL the contract rejects is dropped from the answer.
- **Home:** `derive.trip` writes `key` on summary stops. `withHomePhotos` reads the first three keys per card (100 keys per query, never a lookup) and fills `photos`. A failed read logs `[media] Could not load Home photos (<code>).`
- **The app:**
  - `usePlacePhotos` and `PhotoState`; `SectionProps.photos`.
  - Route photo cards (148pt, 960px).
  - Decision photos (80pt, 500px, aligned slots).
  - The sheet's 244pt photo with Done and the credit link.
  - Home's 108pt band with "+N".
  - `ui/place-photo.tsx` on `expo-image`; the `photoScrim`/`photoInk` tokens.
- **Checking it:** the new tests (`place-media-photos`, `mobile-photo-band`), and the live check now covering photos.
- **Native:** `expo-image` needs a new dev client and preview build.

- [ ] **Step 2: Run `docs-keeper`**

Dispatch the `docs-keeper` agent with:

> Phase 2 of place media (photos) is implemented on branch `place-photos`; diff against `origin/main`. Update `docs/architecture/mobile.md`:
>
> - `ui/place-photo.tsx`;
> - `features/home/photo-band.ts` as a pure file;
> - `SectionProps.photos`;
> - `usePlacePhotos`;
> - the new tokens;
> - `expo-image` needing a new dev client.
>
> Also update any of `AGENTS.md`, `README.md`, `apps/api/AGENTS.md` and `docs/architecture/intent-graph.md` that mention place media, the summary strip or Home's list contract (`photos`). `docs/architecture/place-media.md` is already updated; check it against the code. Don't change code.

Review its edits with `git diff docs AGENTS.md README.md apps/api/AGENTS.md`.

- [ ] **Step 3: Check formatting and commit**

```bash
pnpm format:check
git add docs AGENTS.md README.md apps/api/AGENTS.md
git commit -m "Document place photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stage only the files that changed.

---

### Task 11: Verify, smoke test, review and hand off

**Files:** none new (fixes go where findings point).

- [ ] **Step 1: Full checks**

Run each and read its output:

```bash
pnpm test > .superpowers/final-test.log 2>&1; tail -5 .superpowers/final-test.log
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build > .superpowers/final-build.log 2>&1; tail -20 .superpowers/final-build.log
node scripts/check-place-media.mjs
```

Expected:

- Every test passes.
- Typecheck, lint and formatting are clean (outside `.superpowers/` and `.qa/`).
- The Next.js build and the Expo web export succeed.
- The live check prints `All 8 cases pass.`

- [ ] **Step 2: Make sure the bucket exists on dev**

The smoke test writes photos to dev's `place-photos` bucket. If the user hasn't run `pnpm db:push` for `20261004150000_place_photos_bucket.sql` on dev, stop and ask them to. Once they confirm, continue.

- [ ] **Step 3: Smoke test on Expo web**

1. Start the API on port 3010 (`pnpm --filter @nexui/api exec next dev --port 3010`) with `apps/api/.env.local` copied from the main checkout.
2. Start Expo web on 8091 with `EXPO_PUBLIC_API_URL=http://localhost:3010`.
3. Sign in as the QA user with `node scripts/qa-session.mjs > .qa/session.json`.
4. With a QA plan that has several stops (create one with `node scripts/try-run.mjs goal "Ten days in Central Europe by train"` if none exists), check each of these, in light and dark, saving screenshots under `.qa/`:
   - Route cards: the placeholders, then the photos, the number badges, and a compact card for a place with no photo. Add Lower Austria with + if no stop lacks a photo.
   - The stop sheet: the photo, Done on it, the credit text, and the credit opening the Commons page. A stop without a photo opens on Done and the name.
   - A decision with candidate photos: ask + "I have a spare day, any day trips from Prague?" and check the soft tiles align.
   - Home: the band after the plan's next change writes keys, "+N" on the last tile, and a plan with no photos looking as before.
5. Finish with `node scripts/qa-session.mjs --revoke .qa/session.json`.

Restart Expo with `--clear` after any fix (Metro doesn't watch worktrees).

- [ ] **Step 4: Smoke test on the iOS simulator**

`expo-image` needs a new dev client. Build one for the simulator with `pnpm --dir apps/mobile exec expo run:ios --device 14C5F94F-658A-4974-8D47-85860B318046 --port 8091`. This prebuilds into the gitignored `apps/mobile/ios/` and replaces the simulator's dev build with one that also has `expo-image`. The user's main-branch Metro still works with it.

Repeat Step 3's checks with `axe` and `xcrun simctl io … screenshot` (see the iOS simulator notes in memory). Then point the dev client back at the user's 8081.

If the native build fails or takes over 30 minutes, stop and report. Don't work around it: native photos then wait on the user's EAS preview build.

- [ ] **Step 5: Reviews**

Dispatch `api-reviewer`, `mobile-reviewer` and `security-reviewer` in parallel on `git diff origin/main...HEAD`. Name for them:

- the new outbound calls (Commons, `upload.wikimedia.org`);
- the uploads with the secret-key client;
- the Home route's new admin read;
- the contract changes.

Then dispatch the final whole-branch code review per the executing skill. Fix Critical and Important findings with a failing test first; ledger the rest.

- [ ] **Step 6: Push and open the draft PR**

Commands:

1. `git push -u origin place-photos`
2. `gh pr create --draft --base main --title "Place photos (phase 2)" --body-file <file>`

The body:

- explains the change;
- lists validation (test counts, live check, smoke tests with screenshots);
- names the user's steps:
  - `pnpm db:push` for the bucket migration on dev and prod;
  - `pnpm build:preview` for a new preview build with `expo-image`, installed when the API deploys (Decision 17);
- ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
