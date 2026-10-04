# Place Details (Phase 1 of Place Photos and Stop Details) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a stop on the route opens a sheet with everything about it: the full `why`, a short Wikipedia introduction, days, daily cost, the next leg and where you'll stay. The introduction comes from a shared, cached Wikipedia lookup that phase 2 extends with photos.

**Architecture:** A new `place_media` table caches one row per place key (normalized name, country, coordinates to 0.1°) for every user. `GET /api/intents/:id/media` loads the plan as the user (the ownership check), reads the plan's cache rows with the secret-key client, and looks up missing or expired places on English Wikipedia, at most 20 per request and four at a time, within a 6-second budget; lookups past the budget finish in `after()`. Plan data, Changes and Undo are untouched. On mobile, `usePlaceMedia` fetches the media while the workspace is open, route rows become buttons that report a new `openPlace` action, and a new `place` sheet (an iOS form sheet, a modal elsewhere) shows the details, with the same day stepper, optimistic edit and Undo as the route.

**Tech Stack:** Next.js 16 route handlers with `after()`, Supabase Postgres and supabase-js 2, the MediaWiki Action API, Zod 4 contracts in `@nexui/types`, Expo Router, TanStack Query 5, Node 24's test runner with type stripping.

**Spec:** `docs/superpowers/specs/2026-10-04-place-photos-and-details-design.md`, phase 1 (section 7). It adds to `docs/superpowers/specs/2026-09-27-intent-graph-design.md`. Read both. Phase 2 (photos) gets its own plan once this lands.

## Global Constraints

- Node.js 24, pnpm 10.34.5. Run every command from the worktree root. A single test file runs with `node --experimental-strip-types --test tests/<file>.test.mjs`.
- **Phasing:** phase 1 returns only the Wikipedia introduction. `photo` is in the contract but always `null`. `LOOKUP_VERSION = 1`. One migration creates the table with every column, so phase 2 changes no schema.
- **Source:** English Wikipedia only. Every request sends `User-Agent: Nexui/1.0 (<WIKIMEDIA_CONTACT>)` and times out after 4 seconds.
- **Match rules (verbatim):** keep articles within 25 km, or 75 km when `placeType` is `region` or `area`; prefer the article whose normalized title equals the normalized name, or starts with it followed by a comma; otherwise the nearest; nothing in range is `none`. The lookup never guesses.
- **Expiry:** `found` 90 days, `none` 30 days, `failed` 15 minutes or the `Retry-After` time, whichever is later. A row with an older `lookup_version` counts as expired. Refreshes skip a `pinned` row.
- **Request limits:** at most 20 lookups start per request, four at a time, within a 6-second budget. A 429 or 503 stops the request starting new lookups. `maxDuration = 30`.
- **Access:** RLS on `place_media` with no policies; `anon` and `authenticated` hold no grants. Only `getAdminClient()` reads or writes it, and only after `loadSnapshot` with the user's client has succeeded.
- **Safety:** Wikipedia text never enters the graph or a model prompt; the app shows it as plain text. Logs carry the `[media]` tag, counts and HTTP status codes only: no place names, response bodies or URLs.
- **Primitives never call the API.** Section components get `{ section, data, snapshot, onAction, busy }` and report a `WorkspaceAction`. Only screens use query hooks.
- **Pure mobile modules** (`lib/format.ts`, `features/workspace/stop-details.ts`, `workspace-actions.ts`, `data/place-media.ts`) import no `react-native` or `expo-*`; they import siblings with `.ts` paths and no barrel but `#lib`, so `tests/mobile-*.test.mjs` load them under Node.
- **Colors come only from tokens** (`createThemedStyles`, `useColors`). Touch targets stay 44 pt or more.
- **Copy (verbatim from the spec or its mock):** "Done"; "{Type} in {Country}, the {nth} of {n} stops" (the mock's "the first of 4 stops"); "Days here"; "Daily cost"; "Why it’s on your route"; "About {name}"; "Read more on Wikipedia"; "Next stop" with "Train to Prague" and "4h 15m, ≈ $40"; "Where you’ll stay"; "No place to stay yet."; "Find a stay with Nexui", which opens + with "Find a stay in {name}"; the stop row's label "Berlin, stop 1, 3 days. Show details".
- Style: strict TypeScript with `noUncheckedIndexedAccess`; braces on every `if`, `else` and loop; a blank line before `return`, after blocks and after declaration groups; explicit parameter and return types on exported functions; no nested ternaries; kebab-case filenames. `.claude/hooks/format.sh` runs Prettier and ESLint after each edit; run `pnpm fix` before each commit anyway.
- Each task keeps `pnpm lint`, `pnpm typecheck` and `pnpm test` passing.
- Commit messages: a concise imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ask before anything outward-facing:** `pnpm db:push` is the user's to run (agents are refused it). Pushing the branch and opening the draft PR are covered by the session's instructions.

## Decisions this plan makes (flagged for review)

1. **The key folds punctuation to spaces, not just whitespace.** `placeMediaKey` replaces each run of characters that aren't letters or digits with one space, so "Washington, D.C." and "St. Moritz" make keys with no commas, quotes or parentheses. supabase-js doesn't escape quotes inside a PostgREST `in.(…)` filter, so a key with `"` would break the cache read. The name part is capped at 150 characters so the key stays under the table's 200.
2. **Link URLs in the contract are pinned to their sites.** `about.url` must be `https://en.wikipedia.org/…` and a photo credit's `sourceUrl` `https://commons.wikimedia.org/…`, so an edited row can never make "Read more" open a `javascript:` URL on web.
3. **`Retry-After` is capped at a day.** A header asking for a week still retries after 24 hours.
4. **A Wikipedia `error` answer or an unreadable body is `failed`, not `none`.** It retries in 15 minutes instead of hiding the place for 30 days.
5. **The per-request summary logs as an error only when a lookup failed.** `[media] looked up 3: 2 found, 1 none, 0 failed.` goes to `console.info` outside production, and to `console.error` whenever `failed > 0`, following the API's rule that `console.info` is for development diagnostics. The share of `none` rows is read from the table, not the logs.
6. **A malformed `WIKIMEDIA_CONTACT` is a `MediaConfigurationError`.** The route logs its message and answers 500; the app then hides "About". Unset is not an error: lookups are off and the route logs `[media] Lookups are off…` once.
7. **The 6-second-budget test calls the lookup directly** (`tests/place-media-lookup.test.mjs`, `budgetMs: 50`). The route's budget isn't injectable, and a 6-second route test would slow `pnpm test`.
8. **The workspace screen prefetches media.** Opening a plan calls `usePlaceMedia` for all its places, so lookups start when the plan is first viewed (spec section 4's assumption) and the sheet usually opens with its introduction ready. The route rows don't render media until phase 2.
9. **The stop-details logic lives in `features/workspace/stop-details.ts`.** It needs `legBetween` from `workspace-layout.ts`, and pure modules can't import another feature's barrel. The sheet's components live in `features/place/`, as the spec says.
10. **`DayStepper` moves to `features/workspace/day-stepper.tsx`** and is exported, so the sheet uses the route's stepper. A `surface` prop gives it card-colored buttons on the sheet's soft panel, as the mock shows.
11. **The live check ships now, with match cases only.** `scripts/check-place-media.mjs` checks each of the spec's eight places matches the right article with an introduction; phase 2 adds the photo expectations.
12. **An expired row answers `pending` while it's refreshed** (the spec's rule), so the About placeholder shows briefly for a stale row.

## Review Focus

1. **Place names with punctuation or quotes** ("Washington, D.C.", "Xi'an", "Saint-Tropez"). Expected: the cache read works and the place is answered like any other. Pinned by Task 1's key test and Task 5's route test with "Washington, D.C.".
2. **The same place twice in one plan** (a decision candidate that is also a stop, or a city visited twice). Expected: one Wikipedia lookup, and every id answered alike. Pinned by Task 4's duplicate test and Task 5's candidate test.
3. **Wikipedia answering 200 with an `error` body, HTML, or pages without coordinates.** Expected: `failed` for 15 minutes for the first two, `none` for the third, never a 500. Pinned by Task 4's malformed-answer test.
4. **A plan with more than 20 uncached places, or a throttle mid-request.** Expected: at most 20 lookups start, no new ones after a 429, and the rest answer `pending` and start on the app's next poll. Pinned by Task 4's cap and throttle tests.
5. **A stop removed while its sheet is open** (a run, another device, or Undo). Expected: the sheet says "This stop is no longer on your route." with Done, instead of crashing. Pinned by Task 7's `stopDetails` null test.

---

## File Structure

```
packages/types/src/media.ts                          (create) placeMediaKey, normalizePlaceName, contract schemas
packages/types/src/index.ts                          (modify) export media
supabase/migrations/20261004120000_place_media.sql   (create) place_media table, RLS, no grants
apps/api/src/lib/media/rules.ts                      (create) pure: match, expiry, freshness, rows, toPlaceMedia
apps/api/src/lib/media/wikipedia.ts                  (create) request 1 (search), errors, User-Agent
apps/api/src/lib/media/cache.ts                      (create) readRows, saveRow
apps/api/src/lib/media/lookup.ts                     (create) mediaPlaces, resolvePlaceMedia (budget, pool, defer)
apps/api/src/lib/media/schedule.ts                   (create) scheduleMediaTask / setMediaScheduler around after()
apps/api/src/lib/media/config.ts                     (create) readMediaConfig, MediaConfigurationError
apps/api/src/lib/media/index.ts                      (create) barrel
apps/api/src/lib/supabase/clients.ts                 (modify) admin client's message and comment
apps/api/src/app/api/intents/[id]/media/route.ts     (create) GET handler
apps/api/.env.example                                (modify) WIKIMEDIA_CONTACT
scripts/check-place-media.mjs                        (create) live match check
apps/mobile/src/lib/format.ts, index.ts              (modify) capitalize, ordinalWord, countryName, travelTo, legFigures
apps/mobile/src/features/workspace/workspace-layout.ts  (modify) export legBetween
apps/mobile/src/features/workspace/stop-details.ts   (create) stopDetails, stopKind, stopSubtitle, stopButtonLabel, stayLine
apps/mobile/src/features/workspace/workspace-actions.ts (modify) openPlace, daysAction
apps/mobile/src/features/workspace/day-stepper.tsx   (create) SmallButton, DayStepper (moved from route-section)
apps/mobile/src/features/workspace/sections/route-section.tsx (modify) stop rows open the sheet
apps/mobile/src/features/workspace/index.ts          (modify) exports for the sheet
apps/mobile/src/data/place-media.ts                  (create) pure: mediaPlaceIds, mediaKeyIds, polling
apps/mobile/src/data/api.ts, queries.ts, index.ts    (modify) getPlaceMedia, usePlaceMedia
apps/mobile/src/features/place/place-sheet.tsx       (create) PlaceSheet and its sections
apps/mobile/src/features/place/index.ts              (create) barrel
apps/mobile/src/app/(app)/place.tsx                  (create) the place screen
apps/mobile/src/app/(app)/_layout.tsx                (modify) register place with the sheet options
apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx (modify) openPlace, media prefetch
tests/place-media-key.test.mjs                       (create)
tests/place-media-migration.test.mjs                 (create)
tests/place-media-rules.test.mjs                     (create)
tests/place-media-lookup.test.mjs                    (create)
tests/media-route.test.mjs                           (create)
tests/support/media.mjs                              (create) Supabase and Wikipedia stand-ins
tests/mobile-stop-details.test.mjs                   (create)
tests/mobile-place-media.test.mjs                    (create)
tests/mobile-format.test.mjs, mobile-workspace-actions.test.mjs (modify)
docs/architecture/place-media.md                     (create)
docs/architecture/mobile.md, AGENTS.md               (modify) via docs-keeper
```

---

### Task 1: The shared media contract

**Files:**

- Create: `packages/types/src/media.ts`
- Modify: `packages/types/src/index.ts`
- Test: `tests/place-media-key.test.mjs`

**Interfaces:**

- Produces: `normalizePlaceName(name: string): string`; `placeMediaKey(place: Pick<PlaceData, 'name' | 'country' | 'lat' | 'lng'>): string`; `PLACE_PHOTO_PATH`; `storageUrlSchema`, `aboutSchema`, `photoSchema`, `placeMediaSchema`, `intentMediaSchema`; types `PlaceAbout`, `PlacePhoto`, `PlaceMedia`, `IntentMedia`.

- [ ] **Step 1: Write the failing test**

`tests/place-media-key.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePlaceName, placeMediaKey } from '../packages/types/src/media.ts';

test('the key is the normalized name, country and coordinates to 0.1°', () => {
  assert.equal(
    placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 }),
    'cesky krumlov|CZ|48.8|14.3',
  );
});

test('case, accents and spacing make no difference', () => {
  const berlin = { country: 'DE', lat: 52.52, lng: 13.405 };

  assert.equal(
    placeMediaKey({ ...berlin, name: '  BERLIN ' }),
    placeMediaKey({ ...berlin, name: 'Berlin' }),
  );
  assert.equal(normalizePlaceName('Zürich'), 'zurich');
  assert.equal(normalizePlaceName('Kraków\tOld   Town'), 'krakow old town');
});

test('punctuation folds to spaces, so a key is safe in a PostgREST in-filter', () => {
  const key = placeMediaKey({
    name: 'Washington, D.C.',
    country: 'US',
    lat: 38.9072,
    lng: -77.0369,
  });

  assert.equal(key, 'washington d c|US|38.9|-77.0');
  assert.doesNotMatch(key, /[,()"]/);
  assert.equal(normalizePlaceName("Xi'an"), 'xi an');
});

test('coordinates round to one decimal place, so nearby points share a key', () => {
  const at = (lat, lng) => placeMediaKey({ name: 'Hallstatt', country: 'AT', lat, lng });

  assert.equal(at(47.5622, 13.6493), at(47.5501, 13.6012));
  assert.notEqual(at(47.54, 13.6), at(47.56, 13.6));
  assert.equal(at(35, 139), 'hallstatt|AT|35.0|139.0');
  assert.equal(at(-0.04, 0.01), 'hallstatt|AT|0.0|0.0');
});

test('a very long name still makes a key the table accepts', () => {
  const key = placeMediaKey({ name: '㎞'.repeat(100), country: 'JP', lat: 35, lng: 139 });

  assert.ok(key.length <= 200);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tests/place-media-key.test.mjs`
Expected: FAIL with `Cannot find module '…/packages/types/src/media.ts'`.

- [ ] **Step 3: Write the contract**

`packages/types/src/media.ts`:

```ts
import { z } from 'zod';

import type { PlaceData } from './kinds/travel.ts';
import { idSchema } from './primitives.ts';

/** Every place photo lives under this path in our Supabase Storage (spec section 4). */
export const PLACE_PHOTO_PATH = '/storage/v1/object/public/place-photos/';

/**
 * A place name as the media cache compares it: case and accents dropped, and each run of
 * punctuation or whitespace turned into one space, so a key is safe in a PostgREST filter.
 *
 * @example
 * normalizePlaceName('  Český   Krumlov ') // 'cesky krumlov'
 * normalizePlaceName('Washington, D.C.') // 'washington d c'
 */
export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .slice(0, 150)
    .trim();
}

// One decimal place is about 11 km. Adding 0 turns -0 into 0.
function roundCoordinate(value: number): string {
  return (Math.round(value * 10) / 10 + 0).toFixed(1);
}

/**
 * The media cache key for a place: its normalized name, country and coordinates rounded to
 * 0.1°, so the same place in any plan shares one Wikipedia lookup.
 *
 * @example
 * placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 });
 * // 'cesky krumlov|CZ|48.8|14.3'
 */
export function placeMediaKey(place: Pick<PlaceData, 'name' | 'country' | 'lat' | 'lng'>): string {
  return [
    normalizePlaceName(place.name),
    place.country,
    roundCoordinate(place.lat),
    roundCoordinate(place.lng),
  ].join('|');
}

function isPlacePhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.pathname.startsWith(PLACE_PHOTO_PATH);
  } catch {
    return false;
  }
}

/** A URL in our `place-photos` bucket. Nothing else may appear as a photo. */
export const storageUrlSchema = z
  .string()
  .max(2000)
  .refine(isPlacePhotoUrl, 'Not a place photo URL.');

/** The Wikipedia introduction the stop sheet shows under "About". */
export const aboutSchema = z.strictObject({
  title: z.string().max(200),
  extract: z.string().max(600),
  // The article, which "Read more on Wikipedia" opens.
  url: z.url({ protocol: /^https$/, hostname: /^en\.wikipedia\.org$/ }),
});

export const photoSchema = z.strictObject({
  url: storageUrlSchema, // 960px
  thumbUrl: storageUrlSchema, // 500px
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  credit: z.strictObject({
    author: z.string().max(120),
    license: z.string().max(60),
    licenseUrl: z.url({ protocol: /^https?$/ }).optional(),
    // The file's page on Commons.
    sourceUrl: z.url({ protocol: /^https$/, hostname: /^commons\.wikimedia\.org$/ }),
  }),
});

/** One place's media: `pending` while its lookup hasn't finished. */
export const placeMediaSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    about: aboutSchema.nullable(),
    photo: photoSchema.nullable(),
  }),
  z.strictObject({ status: z.literal('pending') }),
]);

// GET /api/intents/:id/media: every place in the plan by id, decision candidates included.
export const intentMediaSchema = z.strictObject({
  places: z.record(idSchema, placeMediaSchema),
});

export type PlaceAbout = z.infer<typeof aboutSchema>;
export type PlacePhoto = z.infer<typeof photoSchema>;
export type PlaceMedia = z.infer<typeof placeMediaSchema>;
export type IntentMedia = z.infer<typeof intentMediaSchema>;
```

In `packages/types/src/index.ts`, add after `export * from './apply-ops.ts';`:

```ts
export * from './media.ts';
```

- [ ] **Step 4: Run the test and the type check**

Run: `node --experimental-strip-types --test tests/place-media-key.test.mjs && pnpm --filter @nexui/types typecheck`
Expected: 5 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/types/src/media.ts packages/types/src/index.ts tests/place-media-key.test.mjs
git commit -m "Add the place media key and contract"
```

---

### Task 2: The `place_media` table

**Files:**

- Create: `supabase/migrations/20261004120000_place_media.sql`
- Test: `tests/place-media-migration.test.mjs`

**Interfaces:**

- Produces: table `public.place_media` (columns exactly as spec section 3). Task 4's cache code reads `key, status, lookup_version, pinned, page_title, page_url, extract, expires_at` and upserts every column except `pinned`.

- [ ] **Step 1: Write the failing test**

`tests/place-media-migration.test.mjs`:

```js
// Static checks on the place media cache: one shared row per place, which only the API's
// secret-key client can read or write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20261004120000_place_media.sql', 'utf8');

test('place_media has every column phase 2 needs, with its limits', () => {
  assert.match(sql, /create table public\.place_media \(/);
  assert.match(sql, /key\s+text primary key check \(char_length\(key\) <= 200\)/);
  assert.match(sql, /status\s+text not null check \(status in \('found', 'none', 'failed'\)\)/);
  assert.match(sql, /lookup_version\s+int\s+not null/);
  assert.match(sql, /pinned\s+boolean not null default false/);
  assert.match(sql, /extract\s+text check \(char_length\(extract\) <= 600\)/);
  assert.match(sql, /fetched_at\s+timestamptz not null default now\(\)/);
  assert.match(sql, /expires_at\s+timestamptz not null/);

  for (const column of ['page_title', 'page_url', 'photo', 'credit']) {
    assert.match(sql, new RegExp(`\\n\\s+${column}\\s`), column);
  }
});

test('only the secret-key client can reach it', () => {
  assert.match(sql, /alter table public\.place_media enable row level security;/);
  assert.match(sql, /revoke all on public\.place_media from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\bgrant\b/i);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tests/place-media-migration.test.mjs`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261004120000_place_media.sql`:

```sql
-- The shared cache of what Wikipedia says about each place (docs/architecture/place-media.md).
-- One row per place key for every user. Only the API's secret-key client reads or writes it,
-- after loading the plan as the user. An operator corrects a wrong match by editing the row and
-- setting `pinned`, which stops refreshes overwriting it. Phase 2 fills `photo` and `credit`.

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

- [ ] **Step 4: Run the test**

Run: `node --experimental-strip-types --test tests/place-media-migration.test.mjs`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261004120000_place_media.sql tests/place-media-migration.test.mjs
git commit -m "Add the place_media cache table"
```

The user applies it later with `pnpm db:push` on dev, then prod (Task 12).

---

### Task 3: Match, expiry and row rules

**Files:**

- Create: `apps/api/src/lib/media/rules.ts`
- Test: `tests/place-media-rules.test.mjs`

**Interfaces:**

- Consumes: `normalizePlaceName`, `aboutSchema`, `PlaceData`, `PlaceMedia` from `@nexui/types` (Task 1).
- Produces:
  - `LOOKUP_VERSION = 1`; `type MediaStatus = 'found' | 'none' | 'failed'`;
  - `interface Article { title: string; lat: number; lng: number; image: string | null; extract: string }`;
  - `type LookupPlace = Pick<PlaceData, 'name' | 'placeType' | 'lat' | 'lng'>`;
  - `interface MediaRow { key; status: MediaStatus; lookupVersion: number; pinned: boolean; pageTitle: string | null; pageUrl: string | null; extract: string | null; expiresAt: string }`;
  - `distanceKm(a, b): number`, `matchRadiusKm(placeType): number`, `matchArticle(place: LookupPlace, articles: readonly Article[]): Article | null`;
  - `expiresAt(status, now: Date, retryAfterMs = 0): Date`, `isFresh(row: MediaRow, now: Date): boolean`, `retryAfterMs(header: string | null, now: Date): number`;
  - `clipExtract(text: string): string`, `articleUrl(title: string): string`;
  - `lookupRow(key: string, match: Article | null, now: Date): MediaRow`, `failedRow(key: string, now: Date, retryAfter = 0): MediaRow`;
  - `toPlaceMedia(row: MediaRow): PlaceMedia`.

- [ ] **Step 1: Write the failing test**

`tests/place-media-rules.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleUrl,
  clipExtract,
  distanceKm,
  expiresAt,
  failedRow,
  isFresh,
  LOOKUP_VERSION,
  lookupRow,
  matchArticle,
  retryAfterMs,
  toPlaceMedia,
} from '../apps/api/src/lib/media/rules.ts';

const NOW = new Date('2026-10-04T12:00:00Z');
const MINUTE = 60_000;
const DAY = 86_400_000;

// An article `km` kilometres due north of a place: 1° of latitude is about 111.2 km.
const north = (title, from, km) => ({
  title,
  lat: from.lat + km / 111.195,
  lng: from.lng,
  image: null,
  extract: `${title} is a place.`,
});

const town = { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 };
const region = { name: 'Lower Austria', placeType: 'region', lat: 48.2, lng: 15.6 };

test('distances are great-circle kilometres', () => {
  const berlinToParis = distanceKm({ lat: 52.52, lng: 13.405 }, { lat: 48.8566, lng: 2.3522 });

  assert.ok(Math.abs(berlinToParis - 878) < 5);
  assert.ok(Math.abs(distanceKm(town, north('x', town, 20)) - 20) < 0.1);
});

test('a town matches articles within 25 km, a region or area within 75 km', () => {
  assert.equal(matchArticle(town, [north('Hallstatt', town, 20)])?.title, 'Hallstatt');
  assert.equal(matchArticle(town, [north('Hallstatt', town, 30)]), null);
  assert.equal(matchArticle(region, [north('Lower Austria', region, 60)])?.title, 'Lower Austria');
  assert.equal(
    matchArticle({ ...region, placeType: 'area' }, [north('Lower Austria', region, 74)])?.title,
    'Lower Austria',
  );
  assert.equal(matchArticle(region, [north('Lower Austria', region, 80)]), null);
});

test('an article titled with the name wins over a nearer one', () => {
  const amalfi = { name: 'Amalfi Coast', placeType: 'area', lat: 40.63, lng: 14.6 };
  const articles = [north('Duchy of Amalfi', amalfi, 2), north('Amalfi Coast', amalfi, 12)];

  assert.equal(matchArticle(amalfi, articles)?.title, 'Amalfi Coast');
});

test('"Springfield, Illinois" names Springfield; otherwise the nearest article wins', () => {
  const springfield = { name: 'Springfield', placeType: 'city', lat: 39.8, lng: -89.65 };
  const named = [
    north('Lincoln Home', springfield, 1),
    north('Springfield, Illinois', springfield, 3),
  ];
  const unnamed = [
    north('Springfield Armory', springfield, 5),
    north('Lincoln Home', springfield, 1),
  ];

  assert.equal(matchArticle(springfield, named)?.title, 'Springfield, Illinois');
  assert.equal(matchArticle(springfield, unnamed)?.title, 'Lincoln Home');
});

test('nothing in range means no match, never a guess', () => {
  assert.equal(matchArticle(town, []), null);
  assert.equal(matchArticle(town, [north('Hallstatt', town, 400)]), null);
});

test('rows expire by status: found 90 days, none 30, failed 15 minutes or Retry-After', () => {
  const wait = (date) => date.getTime() - NOW.getTime();

  assert.equal(wait(expiresAt('found', NOW)), 90 * DAY);
  assert.equal(wait(expiresAt('none', NOW)), 30 * DAY);
  assert.equal(wait(expiresAt('failed', NOW)), 15 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 60 * MINUTE)), 60 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 5 * MINUTE)), 15 * MINUTE);
  assert.equal(wait(expiresAt('failed', NOW, 30 * DAY)), DAY);
});

test('Retry-After reads as seconds or an HTTP date', () => {
  assert.equal(retryAfterMs('120', NOW), 120_000);
  assert.equal(retryAfterMs('Sun, 04 Oct 2026 13:00:00 GMT', NOW), 60 * MINUTE);
  assert.equal(retryAfterMs('soon', NOW), 0);
  assert.equal(retryAfterMs(null, NOW), 0);
});

test('a row is fresh while current; pinned rows always; an older version never', () => {
  const row = lookupRow('hallstatt|AT|47.6|13.6', north('Hallstatt', town, 1), NOW);
  const later = new Date(NOW.getTime() + 91 * DAY);

  assert.equal(isFresh(row, NOW), true);
  assert.equal(isFresh(row, later), false);
  assert.equal(isFresh({ ...row, pinned: true }, later), true);
  assert.equal(isFresh({ ...row, lookupVersion: LOOKUP_VERSION - 1 }, NOW), false);
  assert.equal(isFresh({ ...row, lookupVersion: LOOKUP_VERSION - 1, pinned: true }, NOW), true);
});

test('a found row carries the article; none and failed rows carry nothing', () => {
  const found = lookupRow('k', north('Springfield, Illinois', town, 1), NOW);

  assert.equal(found.status, 'found');
  assert.equal(found.lookupVersion, LOOKUP_VERSION);
  assert.equal(found.pageUrl, 'https://en.wikipedia.org/wiki/Springfield%2C_Illinois');
  assert.deepEqual(toPlaceMedia(found), {
    status: 'ready',
    about: {
      title: 'Springfield, Illinois',
      extract: 'Springfield, Illinois is a place.',
      url: found.pageUrl,
    },
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(lookupRow('k', null, NOW)), {
    status: 'ready',
    about: null,
    photo: null,
  });
  assert.deepEqual(toPlaceMedia(failedRow('k', NOW)), {
    status: 'ready',
    about: null,
    photo: null,
  });
});

test('an introduction is cut to 600 characters at a word, and an unsafe link is dropped', () => {
  const long = clipExtract('word '.repeat(200));

  assert.ok(long.length <= 600);
  assert.ok(long.endsWith('word…'));
  assert.equal(clipExtract(' Two\n\nlines. '), 'Two lines.');
  assert.equal(
    articleUrl('Český Krumlov'),
    'https://en.wikipedia.org/wiki/%C4%8Cesk%C3%BD_Krumlov',
  );

  const edited = {
    ...lookupRow('k', north('Hallstatt', town, 1), NOW),
    pageUrl: 'javascript:alert(1)',
  };

  assert.equal(toPlaceMedia(edited).about, null);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tests/place-media-rules.test.mjs`
Expected: FAIL with `Cannot find module '…/apps/api/src/lib/media/rules.ts'`.

- [ ] **Step 3: Write the rules**

`apps/api/src/lib/media/rules.ts`:

```ts
import { aboutSchema, normalizePlaceName, type PlaceData, type PlaceMedia } from '@nexui/types';

/** Bumped when the lookup changes what it stores; rows from an older version count as expired. */
export const LOOKUP_VERSION = 1;

export type MediaStatus = 'found' | 'none' | 'failed';

/** A Wikipedia article from the search, with its primary coordinates. */
export interface Article {
  title: string;
  lat: number;
  lng: number;
  /** The lead image's file name from the page-image API, which only gives free files. */
  image: string | null;
  /** The plain-text introduction, up to three sentences; may be empty. */
  extract: string;
}

/** What the lookup reads from a place. */
export type LookupPlace = Pick<PlaceData, 'name' | 'placeType' | 'lat' | 'lng'>;

/** One `place_media` row as the code reads and writes it. */
export interface MediaRow {
  key: string;
  status: MediaStatus;
  lookupVersion: number;
  /** Set by an operator to keep a corrected row; refreshes skip it. */
  pinned: boolean;
  pageTitle: string | null;
  pageUrl: string | null;
  extract: string | null;
  expiresAt: string;
}

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_EXTRACT = 600;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How far an article may sit from the place: 75 km for a region or area, else 25 km. */
export function matchRadiusKm(placeType: PlaceData['placeType']): number {
  return placeType === 'region' || placeType === 'area' ? 75 : 25;
}

// 'Springfield' names 'Springfield' and 'Springfield, Illinois', not 'Springfield Armory'.
function titleNames(title: string, name: string): boolean {
  const wanted = normalizePlaceName(name);
  const comma = title.indexOf(',');

  return (
    normalizePlaceName(title) === wanted ||
    (comma > 0 && normalizePlaceName(title.slice(0, comma)) === wanted)
  );
}

/**
 * The article about a place, or null (spec section 2). Only articles within the radius count;
 * one titled with the place's name wins, else the nearest. Nothing in range means no match.
 *
 * @example
 * matchArticle({ name: 'Amalfi Coast', placeType: 'area', lat: 40.63, lng: 14.6 }, articles);
 * // the 'Amalfi Coast' article, even when 'Duchy of Amalfi' is nearer
 */
export function matchArticle(place: LookupPlace, articles: readonly Article[]): Article | null {
  const radius = matchRadiusKm(place.placeType);
  const inRange = articles
    .map((article) => ({ article, km: distanceKm(place, article) }))
    .filter((entry) => entry.km <= radius)
    .sort((a, b) => a.km - b.km)
    .map((entry) => entry.article);

  return inRange.find((article) => titleNames(article.title, place.name)) ?? inRange[0] ?? null;
}

/**
 * When a row should be looked up again: `found` after 90 days, `none` after 30, and `failed`
 * after 15 minutes or the Retry-After wait, whichever is later (at most a day).
 */
export function expiresAt(status: MediaStatus, now: Date, retryAfterMs = 0): Date {
  switch (status) {
    case 'found':
      return new Date(now.getTime() + 90 * DAY_MS);
    case 'none':
      return new Date(now.getTime() + 30 * DAY_MS);
    case 'failed':
      return new Date(now.getTime() + Math.min(Math.max(15 * MINUTE_MS, retryAfterMs), DAY_MS));
  }
}

/** A pinned row is always used; any other while it's current and from this lookup version. */
export function isFresh(row: MediaRow, now: Date): boolean {
  return (
    row.pinned || (row.lookupVersion >= LOOKUP_VERSION && Date.parse(row.expiresAt) > now.getTime())
  );
}

/**
 * The wait a Retry-After header asks for, in milliseconds: delay-seconds or an HTTP date. 0
 * when it's missing or unreadable.
 *
 * @example
 * retryAfterMs('120', new Date()) // 120000
 */
export function retryAfterMs(header: string | null, now: Date): number {
  const value = header?.trim() ?? '';

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const date = Date.parse(value);

  return Number.isNaN(date) ? 0 : Math.max(0, date - now.getTime());
}

/** An introduction on one line, cut to 600 characters at a word with an ellipsis. */
export function clipExtract(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (clean.length <= MAX_EXTRACT) {
    return clean;
  }

  const cut = clean.slice(0, MAX_EXTRACT - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * @example
 * articleUrl('Springfield, Illinois') // 'https://en.wikipedia.org/wiki/Springfield%2C_Illinois'
 */
export function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function emptyRow(key: string, status: MediaStatus, expires: Date): MediaRow {
  return {
    key,
    status,
    lookupVersion: LOOKUP_VERSION,
    pinned: false,
    pageTitle: null,
    pageUrl: null,
    extract: null,
    expiresAt: expires.toISOString(),
  };
}

/** The row a finished lookup writes: the matched article, or `none`. */
export function lookupRow(key: string, match: Article | null, now: Date): MediaRow {
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
    expiresAt: expiresAt('found', now).toISOString(),
  };
}

/** The row a failed lookup writes; it's tried again after 15 minutes or the Retry-After wait. */
export function failedRow(key: string, now: Date, retryAfter = 0): MediaRow {
  return emptyRow(key, 'failed', expiresAt('failed', now, retryAfter));
}

/**
 * What the app is told about a row. Only a `found` row with a readable introduction has an
 * `about`; `none` and `failed` rows show nothing. Photos come in phase 2.
 */
export function toPlaceMedia(row: MediaRow): PlaceMedia {
  const about =
    row.status === 'found'
      ? aboutSchema.safeParse({ title: row.pageTitle, extract: row.extract, url: row.pageUrl })
      : null;

  return {
    status: 'ready',
    about: about?.success && about.data.extract.length > 0 ? about.data : null,
    photo: null,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --experimental-strip-types --test tests/place-media-rules.test.mjs`
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add apps/api/src/lib/media/rules.ts tests/place-media-rules.test.mjs
git commit -m "Add the place media match and expiry rules"
```

---

### Task 4: The Wikipedia client, the cache and the lookup

**Files:**

- Create: `apps/api/src/lib/media/wikipedia.ts`, `cache.ts`, `lookup.ts`, `schedule.ts`
- Create: `tests/support/media.mjs`
- Test: `tests/place-media-lookup.test.mjs`

**Interfaces:**

- Consumes: Task 3's rules; `logLine` from `#lib/graph`; `placeDataSchema`, `placeMediaKey`, `GraphSnapshot`, `PlaceMedia` from `@nexui/types`.
- Produces:
  - `searchArticles(name: string, contact: string): Promise<Article[]>`; `userAgent(contact: string): string`; `WikipediaThrottledError` (`retryAfter: string | null`), `WikipediaError`.
  - `readRows(db: SupabaseClient, keys: readonly string[]): Promise<Map<string, MediaRow>>`; `saveRow(db: SupabaseClient, row: MediaRow, now: Date): Promise<void>`; `MediaCacheError` (`code`).
  - `interface MediaPlace extends LookupPlace { id: string; key: string }`; `mediaPlaces(snapshot: GraphSnapshot): MediaPlace[]`.
  - `interface MediaDeps { db: SupabaseClient; contact: string | null; defer: (task: () => Promise<void>) => void; now?: () => Date; budgetMs?: number }`.
  - `resolvePlaceMedia(deps: MediaDeps, places: readonly MediaPlace[]): Promise<Record<string, PlaceMedia>>`; `MAX_LOOKUPS = 20`.
  - `scheduleMediaTask(task: MediaTask): void`; `setMediaScheduler(next: Scheduler | null): void`.

- [ ] **Step 1: Write the shared test support**

`tests/support/media.mjs`:

```js
// Stand-ins for the place media code's network: Supabase's snapshot function and
// `place_media` table, and Wikipedia's API. Used by the lookup and media route tests.
import { getAdminClient } from '../../apps/api/src/lib/supabase/clients.ts';
import { pgError } from './graph-api.mjs';
import { supabaseEnv } from './supabase-auth.mjs';

export const CONTACT = 'ops@nexui.test';
export const NOW = new Date('2026-10-04T12:00:00Z');

/** A Wikipedia search answer (formatversion 2) with these pages, in search order. */
export function searchBody(pages) {
  return {
    batchcomplete: true,
    query: {
      pages: pages.map((page, index) => ({ pageid: index + 1, ns: 0, index: index + 1, ...page })),
    },
  };
}

/** One search result with its primary coordinates. */
export function article(title, lat, lon, extract = `${title} is a place.`) {
  return { title, coordinates: [{ lat, lon, primary: true, globe: 'earth' }], extract };
}

/** A `place_media` row as PostgREST returns it: `found` and current unless overridden. */
export function cacheRow(key, overrides = {}) {
  return {
    key,
    status: 'found',
    lookup_version: 1,
    pinned: false,
    page_title: 'Tokyo',
    page_url: 'https://en.wikipedia.org/wiki/Tokyo',
    extract: 'Tokyo is the capital of Japan.',
    photo: null,
    credit: null,
    fetched_at: '2026-10-01T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// The values of PostgREST's `in.(a,b,"c,d")` filter, as supabase-js writes it.
function inList(filter) {
  const inner = filter?.match(/^in\.\((.*)\)$/)?.[1] ?? '';

  return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map(
    ([, quoted, plain]) => quoted ?? plain,
  );
}

/**
 * Routes fetch for the media code. `snapshot` answers `get_intent_snapshot`, `rows` seed the
 * cache, and `wikipedia(url)` answers each search with a Response or a promise of one.
 * `failRead` and `failWrite` make the cache's reads or writes fail. `state` records the
 * searches made and the rows saved.
 */
export function mediaUpstream({
  snapshot = null,
  rows = [],
  wikipedia = () => Response.json(searchBody([])),
  failRead = false,
  failWrite = false,
} = {}) {
  const state = {
    rows: new Map(rows.map((row) => [row.key, row])),
    searches: [],
    saved: [],
    reads: 0,
  };

  const handler = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');

    if (url.hostname === 'en.wikipedia.org') {
      state.searches.push({ url, headers: new Headers(init.headers) });

      return wikipedia(url);
    }

    if (url.pathname === '/rest/v1/rpc/get_intent_snapshot') {
      return Response.json(snapshot);
    }

    if (url.pathname === '/rest/v1/place_media' && method === 'GET') {
      state.reads += 1;

      if (failRead) {
        return pgError('XX000', 500);
      }

      const keys = inList(url.searchParams.get('key'));

      return Response.json(
        keys.flatMap((key) => (state.rows.has(key) ? [state.rows.get(key)] : [])),
      );
    }

    if (url.pathname === '/rest/v1/place_media' && method === 'POST') {
      if (failWrite) {
        return pgError('42501', 403);
      }

      const row = JSON.parse(init.body);

      state.saved.push(row);
      state.rows.set(row.key, { pinned: false, ...row });

      return new Response(null, { status: 201 });
    }

    return Response.json({ message: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  return { state, handler };
}

/** Sets WIKIMEDIA_CONTACT for one test; `null` unsets it. */
export function useContact(t, value = CONTACT) {
  const previous = process.env.WIKIMEDIA_CONTACT;

  if (value === null) {
    delete process.env.WIKIMEDIA_CONTACT;
  } else {
    process.env.WIKIMEDIA_CONTACT = value;
  }

  t.after(() => {
    if (previous === undefined) {
      delete process.env.WIKIMEDIA_CONTACT;
    } else {
      process.env.WIKIMEDIA_CONTACT = previous;
    }
  });
}

/** The secret-key client the route uses, for calling the lookup directly. */
export function adminDb() {
  return getAdminClient(supabaseEnv);
}
```

- [ ] **Step 2: Write the failing test**

`tests/place-media-lookup.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { mediaPlaces, resolvePlaceMedia } from '../apps/api/src/lib/media/lookup.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { placeMediaKey } from '../packages/types/src/media.ts';
import {
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';
import {
  adminDb,
  article,
  cacheRow,
  CONTACT,
  mediaUpstream,
  NOW,
  searchBody,
} from './support/media.mjs';

// A town `index` degrees east along the equator, so each one has its own key.
function spot(index, name = `Place ${index}`) {
  const place = { name, country: 'KE', placeType: 'town', lat: 0, lng: index };

  return {
    id: `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    key: placeMediaKey(place),
    ...place,
  };
}

// Stubs fetch with `upstream` and quiets the logs; returns the deps and the deferred tasks.
function setup(t, upstream, overrides = {}) {
  const deferred = [];

  t.mock.method(globalThis, 'fetch', upstream.handler);
  t.mock.method(console, 'info', () => {});

  return {
    deps: {
      db: adminDb(),
      contact: CONTACT,
      defer: (task) => deferred.push(task),
      now: () => NOW,
      ...overrides,
    },
    deferred,
    errors: t.mock.method(console, 'error', () => {}),
  };
}

test('lookups that outlast the budget answer pending and finish after the response', async (t) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const upstream = mediaUpstream({
    wikipedia: async (url) => {
      const name = url.searchParams.get('gsrsearch');

      if (name === 'Slow') {
        await held;
      }

      return Response.json(searchBody([article(name, 0, name === 'Slow' ? 2 : 1)]));
    },
  });
  const { deps, deferred } = setup(t, upstream, { budgetMs: 50 });
  const fast = spot(1, 'Fast');
  const slow = spot(2, 'Slow');

  const answers = await resolvePlaceMedia(deps, [fast, slow]);

  assert.equal(answers[fast.id].about.title, 'Fast');
  assert.deepEqual(answers[slow.id], { status: 'pending' });
  assert.equal(deferred.length, 1);

  release();
  await deferred[0]();

  assert.deepEqual(
    upstream.state.saved.map((row) => [row.key, row.status]),
    [
      [fast.key, 'found'],
      [slow.key, 'found'],
    ],
  );
});

test('at most 20 lookups start per request; the rest answer pending', async (t) => {
  const upstream = mediaUpstream();
  const { deps, deferred } = setup(t, upstream);
  const places = Array.from({ length: 25 }, (_, index) => spot(index + 1));

  const answers = await resolvePlaceMedia(deps, places);
  const statuses = Object.values(answers).map((answer) => answer.status);

  assert.equal(upstream.state.searches.length, 20);
  assert.equal(statuses.filter((status) => status === 'pending').length, 5);
  assert.equal(deferred.length, 0);
});

test('a throttle stops new lookups and caches failed until Retry-After', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: () => new Response('slow down', { status: 429, headers: { 'Retry-After': '3600' } }),
  });
  const { deps, errors } = setup(t, upstream);
  const places = Array.from({ length: 6 }, (_, index) => spot(index + 1));

  const answers = await resolvePlaceMedia(deps, places);

  assert.equal(upstream.state.searches.length, 4);
  assert.equal(upstream.state.saved.length, 4);

  for (const row of upstream.state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(row.expires_at, new Date(NOW.getTime() + 3_600_000).toISOString());
  }

  assert.deepEqual(
    Object.values(answers)
      .map((answer) => answer.status)
      .sort(),
    ['pending', 'pending', 'ready', 'ready', 'ready', 'ready'],
  );
  assert.ok(
    errors.mock.calls.every((call) => !call.arguments.join(' ').includes('Place')),
    'logs never name a place',
  );
});

test('a place twice in a plan is looked up once and answered for both ids', async (t) => {
  const upstream = mediaUpstream({
    wikipedia: () => Response.json(searchBody([article('Kyoto', 0, 1)])),
  });
  const { deps } = setup(t, upstream);
  const first = spot(1, 'Kyoto');
  const again = { ...first, id: 'b0000000-0000-4000-8000-000000000099' };

  const answers = await resolvePlaceMedia(deps, [first, again]);

  assert.equal(upstream.state.searches.length, 1);
  assert.equal(answers[first.id].about.title, 'Kyoto');
  assert.deepEqual(answers[again.id], answers[first.id]);
});

test('a pinned row is used even when expired or from an older lookup', async (t) => {
  const place = spot(1, 'Kyoto');
  const upstream = mediaUpstream({
    rows: [
      cacheRow(place.key, {
        pinned: true,
        status: 'none',
        lookup_version: 0,
        page_title: null,
        page_url: null,
        extract: null,
        expires_at: '2020-01-01T00:00:00.000Z',
      }),
    ],
  });
  const { deps } = setup(t, upstream);

  const answers = await resolvePlaceMedia(deps, [place]);

  assert.equal(upstream.state.searches.length, 0);
  assert.deepEqual(answers[place.id], { status: 'ready', about: null, photo: null });
});

test('an error answer or unreadable body is failed; pages without coordinates are none', async (t) => {
  const answers = {
    'Place 1': () => Response.json({ error: { code: 'maxlag', info: 'Waiting for a replica' } }),
    'Place 2': () => new Response('<html>', { status: 200 }),
    'Place 3': () => Response.json(searchBody([{ title: 'Place 3', extract: 'No coordinates.' }])),
  };
  const upstream = mediaUpstream({
    wikipedia: (url) => answers[url.searchParams.get('gsrsearch')](),
  });
  const { deps } = setup(t, upstream);

  await resolvePlaceMedia(deps, [spot(1), spot(2), spot(3)]);

  assert.deepEqual(Object.fromEntries(upstream.state.saved.map((row) => [row.key, row.status])), {
    [spot(1).key]: 'failed',
    [spot(2).key]: 'failed',
    [spot(3).key]: 'none',
  });
});

test('a failed cache write still answers, and logs only a code', async (t) => {
  const upstream = mediaUpstream({
    failWrite: true,
    wikipedia: () => Response.json(searchBody([article('Kyoto', 0, 1)])),
  });
  const { deps, errors } = setup(t, upstream);
  const place = spot(1, 'Kyoto');

  const answers = await resolvePlaceMedia(deps, [place]);

  assert.equal(answers[place.id].about.title, 'Kyoto');
  assert.deepEqual(
    errors.mock.calls.map((call) => call.arguments),
    [['[media]', 'Could not cache a lookup (42501).']],
  );
});

test('without a contact nothing is looked up; cached rows still answer', async (t) => {
  const cached = spot(1, 'Kyoto');
  const upstream = mediaUpstream({ rows: [cacheRow(cached.key, { lookup_version: 0 })] });
  const { deps } = setup(t, upstream, { contact: null });

  const answers = await resolvePlaceMedia(deps, [cached, spot(2)]);

  assert.equal(upstream.state.searches.length, 0);
  assert.equal(answers[cached.id].about.title, 'Tokyo');
  assert.deepEqual(answers[spot(2).id], { status: 'ready', about: null, photo: null });
});

test('every valid place is asked about, decision candidates included', () => {
  const candidate = objectRow('a1b2c3d4-0000-4000-8000-000000000101', 'place', {
    ...kyotoData,
    name: 'Nara',
    lat: 34.69,
    lng: 135.8,
  });
  const broken = objectRow('a1b2c3d4-0000-4000-8000-000000000102', 'place', { name: 'Broken' });
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [tripRow, tokyoRow, kyotoRow, candidate, broken],
    }),
  );

  assert.deepEqual(
    mediaPlaces(snapshot).map((place) => place.key),
    ['tokyo|JP|35.7|139.7', 'kyoto|JP|35.0|135.8', 'nara|JP|34.7|135.8'],
  );
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tests/place-media-lookup.test.mjs`
Expected: FAIL with `Cannot find module '…/apps/api/src/lib/media/lookup.ts'`.

- [ ] **Step 4: Write the Wikipedia client**

`apps/api/src/lib/media/wikipedia.ts`:

```ts
import { z } from 'zod';

import type { Article } from './rules.ts';

const API_URL = 'https://en.wikipedia.org/w/api.php';
const TIMEOUT_MS = 4_000;

/** Wikipedia asked us to slow down (429 or 503). `message` holds only the status code. */
export class WikipediaThrottledError extends Error {
  readonly retryAfter: string | null;

  constructor(status: number, retryAfter: string | null) {
    super(`Wikipedia answered ${status}.`);
    this.retryAfter = retryAfter;
  }
}

/** Any other failed request: an HTTP error, a timeout or an answer we can't read. */
export class WikipediaError extends Error {}

const searchSchema = z.object({
  error: z.unknown().optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            title: z.string(),
            index: z.number().optional(),
            coordinates: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
            pageimage: z.string().optional(),
            extract: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/** The User-Agent Wikimedia asks every client to send, with a way to reach us. */
export function userAgent(contact: string): string {
  return `Nexui/1.0 (${contact})`;
}

// Request 1: search, with each result's coordinates, lead image and three-sentence intro.
function searchUrl(name: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: name,
    gsrnamespace: '0',
    gsrlimit: '5',
    prop: 'pageimages|coordinates|extracts',
    piprop: 'name',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '5',
  });

  return `${API_URL}?${params.toString()}`;
}

async function getJson(url: string, contact: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
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

  try {
    return await response.json();
  } catch {
    throw new WikipediaError('Wikipedia sent an unreadable answer.');
  }
}

/**
 * The top five articles for a name (spec section 2, request 1), in search order. Articles
 * without coordinates are left out, since they can't be matched.
 */
export async function searchArticles(name: string, contact: string): Promise<Article[]> {
  const parsed = searchSchema.safeParse(await getJson(searchUrl(name), contact));

  if (!parsed.success || parsed.data.error !== undefined) {
    throw new WikipediaError('Wikipedia sent an unexpected answer.');
  }

  const pages = [...(parsed.data.query?.pages ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );

  return pages.flatMap((page): Article[] => {
    const point = page.coordinates?.[0];

    if (!point) {
      return [];
    }

    return [
      {
        title: page.title,
        lat: point.lat,
        lng: point.lon,
        image: page.pageimage ?? null,
        extract: page.extract ?? '',
      },
    ];
  });
}
```

- [ ] **Step 5: Write the cache**

`apps/api/src/lib/media/cache.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { MediaRow } from './rules.ts';

const COLUMNS = 'key, status, lookup_version, pinned, page_title, page_url, extract, expires_at';

const rowSchema = z.object({
  key: z.string(),
  status: z.enum(['found', 'none', 'failed']),
  lookup_version: z.number().int(),
  pinned: z.boolean(),
  page_title: z.string().nullable(),
  page_url: z.string().nullable(),
  extract: z.string().nullable(),
  expires_at: z.string(),
});

/** A database error from the cache. Keeps only its code, for the log. */
export class MediaCacheError extends Error {
  readonly code: string | undefined;

  constructor(code: string | undefined) {
    super('The place media cache failed.');
    this.code = code;
  }
}

/** The cached rows for some keys, in one query. A row that doesn't parse is left out. */
export async function readRows(
  db: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, MediaRow>> {
  const rows = new Map<string, MediaRow>();

  if (keys.length === 0) {
    return rows;
  }

  const { data, error } = await db
    .from('place_media')
    .select(COLUMNS)
    .in('key', [...keys]);

  if (error) {
    throw new MediaCacheError(error.code);
  }

  for (const raw of data ?? []) {
    const parsed = rowSchema.safeParse(raw);

    if (parsed.success) {
      const row = parsed.data;

      rows.set(row.key, {
        key: row.key,
        status: row.status,
        lookupVersion: row.lookup_version,
        pinned: row.pinned,
        pageTitle: row.page_title,
        pageUrl: row.page_url,
        extract: row.extract,
        expiresAt: row.expires_at,
      });
    }
  }

  return rows;
}

/** Writes one lookup's result. `pinned` is never sent, so an operator's pin survives. */
export async function saveRow(db: SupabaseClient, row: MediaRow, now: Date): Promise<void> {
  const { error } = await db.from('place_media').upsert({
    key: row.key,
    status: row.status,
    lookup_version: row.lookupVersion,
    page_title: row.pageTitle,
    page_url: row.pageUrl,
    extract: row.extract,
    photo: null,
    credit: null,
    fetched_at: now.toISOString(),
    expires_at: row.expiresAt,
  });

  if (error) {
    throw new MediaCacheError(error.code);
  }
}
```

- [ ] **Step 6: Write the scheduler**

`apps/api/src/lib/media/schedule.ts`:

```ts
// `next/server` has no ESM export map; the `.js` path loads under Node's test runner too.
import { after } from 'next/server.js';

export type MediaTask = () => Promise<void>;

type Scheduler = (task: MediaTask) => void;

const afterResponse: Scheduler = (task) => {
  after(task);
};

let scheduler: Scheduler = afterResponse;

/** Finishes lookups that outlast the request, once its response has been sent. */
export function scheduleMediaTask(task: MediaTask): void {
  scheduler(task);
}

/**
 * Tests replace `after()`, which only works inside a Next.js request. Pass `null` to restore it.
 */
export function setMediaScheduler(next: Scheduler | null): void {
  scheduler = next ?? afterResponse;
}
```

- [ ] **Step 7: Write the lookup**

`apps/api/src/lib/media/lookup.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { placeDataSchema, placeMediaKey, type GraphSnapshot, type PlaceMedia } from '@nexui/types';

import { logLine } from '#lib/graph';

import { readRows, saveRow } from './cache.ts';
import {
  failedRow,
  isFresh,
  lookupRow,
  matchArticle,
  retryAfterMs,
  toPlaceMedia,
  type LookupPlace,
  type MediaRow,
  type MediaStatus,
} from './rules.ts';
import { searchArticles, WikipediaError, WikipediaThrottledError } from './wikipedia.ts';

/** At most this many lookups start per request, four at a time (spec section 4). */
export const MAX_LOOKUPS = 20;
const CONCURRENCY = 4;
const BUDGET_MS = 6_000;

const PENDING: PlaceMedia = { status: 'pending' };
const NOTHING: PlaceMedia = { status: 'ready', about: null, photo: null };

/** A place to answer for: its graph id, its cache key and what the lookup reads. */
export interface MediaPlace extends LookupPlace {
  id: string;
  key: string;
}

export interface MediaDeps {
  /** The secret-key client: the only one that can read or write `place_media`. */
  db: SupabaseClient;
  /** `WIKIMEDIA_CONTACT`. Null turns lookups off, so only cached places get details. */
  contact: string | null;
  /** Finishes work after the response is sent: `after()` in the route. */
  defer: (task: () => Promise<void>) => void;
  now?: () => Date;
  /** How long the request waits for lookups: 6 seconds unless a test says otherwise. */
  budgetMs?: number;
}

interface LookupResult {
  row: MediaRow;
  throttled: boolean;
}

let warnedOff = false;

/** Every valid place in a snapshot, decision candidates included, with its cache key. */
export function mediaPlaces(snapshot: GraphSnapshot): MediaPlace[] {
  return snapshot.objects.flatMap((object): MediaPlace[] => {
    const parsed = object.kind === 'place' ? placeDataSchema.safeParse(object.data) : null;

    if (!parsed?.success) {
      return [];
    }

    const { name, placeType, lat, lng } = parsed.data;

    return [{ id: object.id, key: placeMediaKey(parsed.data), name, placeType, lat, lng }];
  });
}

function warnLookupsOff(): void {
  if (!warnedOff) {
    warnedOff = true;
    console.error('[media]', 'Lookups are off: WIKIMEDIA_CONTACT is not set.');
  }
}

// Counts only. A failure is worth an error line; otherwise it's a development diagnostic.
function logCounts(counts: Record<MediaStatus, number>): void {
  const total = counts.found + counts.none + counts.failed;
  const line = `looked up ${total}: ${counts.found} found, ${counts.none} none, ${counts.failed} failed.`;

  if (counts.failed > 0) {
    console.error('[media]', line);
  } else if (total > 0 && process.env.NODE_ENV !== 'production') {
    console.info('[media]', line);
  }
}

// One lookup: search, match and cache. Never throws; a failure becomes a `failed` row.
async function lookUp(deps: MediaDeps, contact: string, place: MediaPlace): Promise<LookupResult> {
  const now = deps.now?.() ?? new Date();
  let row: MediaRow;
  let throttled = false;

  try {
    const articles = await searchArticles(place.name, contact);

    row = lookupRow(place.key, matchArticle(place, articles), now);
  } catch (error) {
    if (error instanceof WikipediaThrottledError) {
      throttled = true;
      row = failedRow(place.key, now, retryAfterMs(error.retryAfter, now));
    } else {
      row = failedRow(place.key, now);
    }

    console.error(
      '[media]',
      error instanceof WikipediaError || error instanceof WikipediaThrottledError
        ? error.message
        : 'A lookup failed.',
    );
  }

  try {
    await saveRow(deps.db, row, now);
  } catch (error) {
    console.error('[media]', logLine(error, 'Could not cache a lookup'));
  }

  return { row, throttled };
}

// True when `work` settles within `ms`.
async function settlesWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([work.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Looks places up four at a time until the queue is empty, the budget runs out or Wikipedia
// throttles us. Returns the rows finished within the budget; the rest finish through `defer`.
async function lookUpWithin(
  deps: MediaDeps,
  contact: string,
  places: readonly MediaPlace[],
): Promise<Map<string, MediaRow>> {
  const finished = new Map<string, MediaRow>();
  const queue = places.slice(0, MAX_LOOKUPS);
  const budget = deps.budgetMs ?? BUDGET_MS;
  const deadline = Date.now() + budget;
  const counts: Record<MediaStatus, number> = { found: 0, none: 0, failed: 0 };
  let throttled = false;

  const worker = async (): Promise<void> => {
    for (let place = queue.shift(); place; place = queue.shift()) {
      if (throttled || Date.now() >= deadline) {
        return;
      }

      const result = await lookUp(deps, contact, place);

      finished.set(place.key, result.row);
      counts[result.row.status] += 1;
      throttled ||= result.throttled;
    }
  };

  const work = Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() =>
    logCounts(counts),
  );

  if (!(await settlesWithin(work, budget))) {
    deps.defer(() => work);
  }

  return finished;
}

/**
 * Each place's media for the app, by place id (spec section 4). A fresh cache row answers at
 * once. Missing or expired ones are looked up, at most 20 per request and four at a time;
 * those done within the budget answer `ready` and the rest `pending`. Lookups still running at
 * the deadline finish after the response through `defer`; ones never started wait for the
 * app's next request. Without a contact nothing is looked up, and an uncached place answers
 * `ready` with nothing to show.
 */
export async function resolvePlaceMedia(
  deps: MediaDeps,
  places: readonly MediaPlace[],
): Promise<Record<string, PlaceMedia>> {
  const now = deps.now?.() ?? new Date();
  const unique = [...new Map(places.map((place) => [place.key, place])).values()];
  const cached = await readRows(
    deps.db,
    unique.map((place) => place.key),
  );
  const stale = unique.filter((place) => {
    const row = cached.get(place.key);

    return !row || !isFresh(row, now);
  });
  const { contact } = deps;

  if (!contact && stale.length > 0) {
    warnLookupsOff();
  }

  const looked = contact ? await lookUpWithin(deps, contact, stale) : new Map<string, MediaRow>();
  const answers: Record<string, PlaceMedia> = {};

  for (const place of places) {
    const done = looked.get(place.key);
    const row = cached.get(place.key);

    if (done) {
      answers[place.id] = toPlaceMedia(done);
    } else if (row && (!contact || isFresh(row, now))) {
      answers[place.id] = toPlaceMedia(row);
    } else {
      answers[place.id] = contact ? PENDING : NOTHING;
    }
  }

  return answers;
}
```

- [ ] **Step 8: Run the test**

Run: `node --experimental-strip-types --test tests/place-media-lookup.test.mjs`
Expected: 9 tests pass.

- [ ] **Step 9: Commit**

```bash
pnpm fix
git add apps/api/src/lib/media tests/support/media.mjs tests/place-media-lookup.test.mjs
git commit -m "Look places up on Wikipedia and cache the result"
```

---

### Task 5: The media route

**Files:**

- Create: `apps/api/src/lib/media/config.ts`, `apps/api/src/lib/media/index.ts`
- Create: `apps/api/src/app/api/intents/[id]/media/route.ts`
- Modify: `apps/api/src/lib/supabase/clients.ts:46-53`, `apps/api/.env.example`
- Test: `tests/media-route.test.mjs`

**Interfaces:**

- Consumes: Task 4's `mediaPlaces`, `resolvePlaceMedia`, `scheduleMediaTask`; `loadSnapshot`, `graphErrorResponse` from `#lib/graph`; `getAdminClient`, `getUserClient`, `verifyRequest` from `#lib/supabase`; `intentMediaSchema`, `idSchema` from `@nexui/types`.
- Produces: `GET /api/intents/:id/media` answering `IntentMedia`; `readMediaConfig(env = process.env): MediaConfig` (`{ contact: string | null }`); `MediaConfigurationError`.

- [ ] **Step 1: Write the failing test**

`tests/media-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/intents/[id]/media/route.ts';
import { setMediaScheduler } from '../apps/api/src/lib/media/schedule.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { intentMediaSchema, placeMediaKey } from '../packages/types/src/media.ts';
import { authed } from './support/graph-api.mjs';
import {
  INTENT_ID,
  KYOTO_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';
import {
  article,
  cacheRow,
  CONTACT,
  mediaUpstream,
  searchBody,
  useContact,
} from './support/media.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const DAY = 86_400_000;
const TOKYO_KEY = placeMediaKey(tokyoData);
const KYOTO_KEY = placeMediaKey(kyotoData);
const context = (id) => ({ params: Promise.resolve({ id }) });
const plan = (overrides) => snapshotRow(travelWorkspace(TRIP_ID), overrides);
const get = (id = INTENT_ID) =>
  GET(authed(`http://localhost/api/intents/${id}/media`), context(id));

// Each search answers with an article named like the search, at that fixture place.
function wikipedia(url) {
  const name = url.searchParams.get('gsrsearch');
  const place = name === 'Tokyo' ? tokyoData : kyotoData;

  return Response.json(searchBody([article(name, place.lat, place.lng)]));
}

// Lookups past the budget would call after(), which needs a Next.js request.
function setup(t, options) {
  const upstream = mediaUpstream(options);

  mockSupabaseAuth(t, upstream.handler);
  setMediaScheduler(() => {});
  t.after(() => setMediaScheduler(null));
  t.mock.method(console, 'info', () => {});

  return { state: upstream.state, errors: t.mock.method(console, 'error', () => {}) };
}

test('the media route requires a token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const response = await GET(
    new Request(`http://localhost/api/intents/${INTENT_ID}/media`),
    context(INTENT_ID),
  );

  assert.equal(response.status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test("another user's plan or a bad id is 404, and nothing is read or looked up", async (t) => {
  useContact(t);
  const { state } = setup(t, { snapshot: null, wikipedia });

  assert.equal((await get()).status, 404);
  assert.equal((await get('nope')).status, 404);
  assert.equal(state.reads, 0);
  assert.equal(state.searches.length, 0);
});

test('a cache hit answers from the row without calling Wikipedia', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [
      cacheRow(TOKYO_KEY),
      cacheRow(KYOTO_KEY, { status: 'none', page_title: null, page_url: null, extract: null }),
    ],
  });

  const response = await get();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.searches.length, 0);
  assert.deepEqual(body, {
    places: {
      [TOKYO_ID]: {
        status: 'ready',
        about: {
          title: 'Tokyo',
          extract: 'Tokyo is the capital of Japan.',
          url: 'https://en.wikipedia.org/wiki/Tokyo',
        },
        photo: null,
      },
      [KYOTO_ID]: { status: 'ready', about: null, photo: null },
    },
  });
});

test('a miss asks Wikipedia with our User-Agent and caches the row', async (t) => {
  useContact(t);
  const { state } = setup(t, { snapshot: plan(), wikipedia });

  const body = await (await get()).json();
  const tokyo = state.saved.find((row) => row.key === TOKYO_KEY);
  const search = state.searches[0];

  assert.equal(state.searches.length, 2);
  assert.equal(search.headers.get('User-Agent'), `Nexui/1.0 (${CONTACT})`);
  assert.equal(search.url.searchParams.get('generator'), 'search');
  assert.equal(search.url.searchParams.get('gsrlimit'), '5');
  assert.equal(search.url.searchParams.get('prop'), 'pageimages|coordinates|extracts');
  assert.equal(search.url.searchParams.get('exsentences'), '3');
  assert.equal(search.url.searchParams.get('explaintext'), '1');
  assert.deepEqual(
    { ...tokyo, fetched_at: undefined, expires_at: undefined },
    {
      key: TOKYO_KEY,
      status: 'found',
      lookup_version: 1,
      page_title: 'Tokyo',
      page_url: 'https://en.wikipedia.org/wiki/Tokyo',
      extract: 'Tokyo is a place.',
      photo: null,
      credit: null,
      fetched_at: undefined,
      expires_at: undefined,
    },
  );
  assert.equal(Date.parse(tokyo.expires_at) - Date.parse(tokyo.fetched_at), 90 * DAY);
  assert.equal(body.places[TOKYO_ID].about.title, 'Tokyo');
  assert.equal(body.places[KYOTO_ID].about.title, 'Kyoto');
});

test('a row from an older lookup version is looked up again', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [cacheRow(TOKYO_KEY, { lookup_version: 0 }), cacheRow(KYOTO_KEY)],
  });

  await get();

  assert.deepEqual(
    state.searches.map((search) => search.url.searchParams.get('gsrsearch')),
    ['Tokyo'],
  );
});

test('a 429 caches the place as failed until Retry-After', async (t) => {
  useContact(t);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia: () => new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
  });

  const body = await (await get()).json();

  assert.equal(state.saved.length, 2);

  for (const row of state.saved) {
    assert.equal(row.status, 'failed');
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.fetched_at), 3_600_000);
  }

  assert.deepEqual(body.places[TOKYO_ID], { status: 'ready', about: null, photo: null });
});

test('without WIKIMEDIA_CONTACT nothing is looked up; cached rows still answer', async (t) => {
  useContact(t, null);
  const { state } = setup(t, {
    snapshot: plan(),
    wikipedia,
    rows: [cacheRow(TOKYO_KEY, { expires_at: '2020-01-01T00:00:00.000Z' })],
  });

  const body = await (await get()).json();

  assert.equal(state.searches.length, 0);
  assert.equal(body.places[TOKYO_ID].about.title, 'Tokyo');
  assert.deepEqual(body.places[KYOTO_ID], { status: 'ready', about: null, photo: null });
});

test('candidates are answered too: punctuation is fine and a repeated place is asked once', async (t) => {
  useContact(t);
  const washington = {
    ...tokyoData,
    name: 'Washington, D.C.',
    country: 'US',
    lat: 38.9,
    lng: -77.04,
  };
  const candidate = 'a1b2c3d4-0000-4000-8000-000000000101';
  const repeat = 'a1b2c3d4-0000-4000-8000-000000000102';
  const { state } = setup(t, {
    snapshot: plan({
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(candidate, 'place', washington),
        objectRow(repeat, 'place', kyotoData),
      ],
    }),
    wikipedia,
    rows: [
      cacheRow(placeMediaKey(washington), {
        page_title: 'Washington, D.C.',
        page_url: 'https://en.wikipedia.org/wiki/Washington%2C_D.C.',
        extract: 'Washington, D.C. is the capital of the United States.',
      }),
    ],
  });

  const body = await (await get()).json();

  assert.equal(state.searches.length, 2);
  assert.equal(body.places[candidate].about.title, 'Washington, D.C.');
  assert.deepEqual(body.places[repeat], body.places[KYOTO_ID]);
});

test('a cache failure is a safe 500 that logs only a code', async (t) => {
  useContact(t);
  const { errors } = setup(t, { snapshot: plan(), wikipedia, failRead: true });

  const response = await get();

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not load place details. Try again.');
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'Could not load place details (XX000).',
  ]);
});

test('a malformed WIKIMEDIA_CONTACT is a 500 that names the variable', async (t) => {
  useContact(t, 'not a contact');
  const { errors } = setup(t, { snapshot: plan(), wikipedia });

  const response = await get();

  assert.equal(response.status, 500);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    '[media]',
    'WIKIMEDIA_CONTACT must be an email address or a URL.',
  ]);
});

test('the contract accepts only our bucket for photos and Wikipedia for articles', () => {
  const photo = (url) => ({
    url,
    thumbUrl: url,
    width: 960,
    height: 640,
    credit: {
      author: 'Kasa Fue',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Berlin.jpg',
    },
  });
  const media = (entry) => intentMediaSchema.safeParse({ places: { [TOKYO_ID]: entry } });
  const ready = (overrides) => ({ status: 'ready', about: null, photo: null, ...overrides });
  const ours = 'https://x.supabase.co/storage/v1/object/public/place-photos/ab/cd-960.jpg';

  assert.equal(media(ready({ photo: photo(ours) })).success, true);
  assert.equal(media(ready({ photo: photo('https://upload.wikimedia.org/x.jpg') })).success, false);
  assert.equal(
    media(ready({ photo: photo('https://x.supabase.co/storage/v1/object/public/avatars/a.jpg') }))
      .success,
    false,
  );
  assert.equal(
    media(
      ready({
        photo: photo(
          'https://x.supabase.co/storage/v1/object/public/place-photos/../avatars/a.jpg',
        ),
      }),
    ).success,
    false,
  );
  assert.equal(
    media(ready({ about: { title: 'x', extract: 'x', url: 'javascript:alert(1)' } })).success,
    false,
  );
  assert.equal(media({ status: 'pending' }).success, true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --test tests/media-route.test.mjs`
Expected: FAIL with `Cannot find module '…/media/route.ts'`.

- [ ] **Step 3: Write the config and the barrel**

`apps/api/src/lib/media/config.ts`:

```ts
type Env = Record<string, string | undefined>;

/** The media settings are malformed. `message` names the variable, never its value. */
export class MediaConfigurationError extends Error {}

export interface MediaConfig {
  /** Who Wikimedia can contact about our requests, sent in the User-Agent. Null: lookups off. */
  contact: string | null;
}

const EMAIL = /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/;
const WEB_ADDRESS = /^https?:\/\/[^\s()]+$/;

/**
 * Reads the media settings. Without `WIKIMEDIA_CONTACT` (an email address or URL Wikimedia can
 * reach us at), lookups are off and only places already cached get details.
 *
 * @example
 * readMediaConfig({ WIKIMEDIA_CONTACT: 'ops@nexui.app' }).contact // 'ops@nexui.app'
 */
export function readMediaConfig(env: Env = process.env): MediaConfig {
  const contact = env.WIKIMEDIA_CONTACT?.trim() ?? '';

  if (contact.length === 0) {
    return { contact: null };
  }

  if (contact.length > 200 || !(EMAIL.test(contact) || WEB_ADDRESS.test(contact))) {
    throw new MediaConfigurationError('WIKIMEDIA_CONTACT must be an email address or a URL.');
  }

  return { contact };
}
```

`apps/api/src/lib/media/index.ts`:

```ts
export { MediaConfigurationError, readMediaConfig } from './config.ts';
export type { MediaConfig } from './config.ts';
export { mediaPlaces, resolvePlaceMedia } from './lookup.ts';
export type { MediaDeps, MediaPlace } from './lookup.ts';
export { scheduleMediaTask } from './schedule.ts';
```

- [ ] **Step 4: Write the route**

`apps/api/src/app/api/intents/[id]/media/route.ts`:

```ts
import { idSchema, intentMediaSchema } from '@nexui/types';

import { graphErrorResponse, loadSnapshot } from '#lib/graph';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import {
  MediaConfigurationError,
  mediaPlaces,
  readMediaConfig,
  resolvePlaceMedia,
  scheduleMediaTask,
} from '#lib/media';
import { getAdminClient, getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['GET'], ['Authorization']);

// Lookups that outlast the 6-second budget finish in `after()`.
export const maxDuration = 30;

interface MediaRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Wikipedia details for every place in one of the caller's plans (spec section 4). Loading the
 * plan as the user is the ownership check; only then does the secret-key client read the shared
 * cache and look up what's missing.
 */
export async function GET(request: Request, { params }: MediaRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const { contact } = readMediaConfig();
    const snapshot = await loadSnapshot(getUserClient(user.accessToken), id);
    const places = await resolvePlaceMedia(
      { db: getAdminClient(), contact, defer: scheduleMediaTask },
      mediaPlaces(snapshot),
    );

    return Response.json(intentMediaSchema.parse({ places }), { headers });
  } catch (error) {
    if (error instanceof MediaConfigurationError) {
      console.error('[media]', error.message);

      return jsonError('Could not load place details. Try again.', 500, headers);
    }

    return graphErrorResponse(error, '[media]', 'Could not load place details', headers);
  }
}
```

In `apps/api/src/lib/supabase/clients.ts`, the admin client now serves the media cache too. Replace:

```ts
// Bypasses row-level security. Only use it for admin actions such as account deletion.
export function getAdminClient(env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_SECRET_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError('SUPABASE_SECRET_KEY is required for account deletion.');
  }
```

with:

```ts
// Bypasses row-level security. Only use it for admin actions (account deletion) and for the
// shared place media cache, after the route has checked the caller owns the plan.
export function getAdminClient(env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_SECRET_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError(
      'SUPABASE_SECRET_KEY is required for account deletion and place details.',
    );
  }
```

In `apps/api/.env.example`, change the `SUPABASE_SECRET_KEY` comment and add the contact after the AI block:

```bash
# sb_secret_… — server only; used for account deletion and the place media cache. Never expose
# to the mobile app.
SUPABASE_SECRET_KEY=
```

```bash
# An email address or URL Wikimedia can reach us at, sent in the User-Agent of Wikipedia
# lookups for stop details. Leave it empty to turn lookups off (cached places still show).
WIKIMEDIA_CONTACT=
```

- [ ] **Step 5: Run the tests and the type check**

Run: `node --experimental-strip-types --test tests/media-route.test.mjs && pnpm --filter @nexui/api typecheck && pnpm --filter @nexui/api lint`
Expected: 11 tests pass; no type or lint errors.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add apps/api tests/media-route.test.mjs
git commit -m "Add GET /api/intents/:id/media"
```

---

### Task 6: The live match check

**Files:**

- Create: `scripts/check-place-media.mjs`

**Interfaces:**

- Consumes: `searchArticles` (Task 4), `matchArticle` (Task 3), `readMediaConfig` (Task 5).

- [ ] **Step 1: Write the script**

`scripts/check-place-media.mjs`:

```js
// Checks the place media lookup against live Wikipedia, with no cache writes, and prints a pass
// or fail per case: each place must match the right article, with an introduction. A manual
// gate like `pnpm eval:travel`, not part of `pnpm test`. Phase 2 adds the photo expectations.
// Needs WIKIMEDIA_CONTACT, from the environment or apps/api/.env.local.
import { existsSync } from 'node:fs';

import { readMediaConfig } from '../apps/api/src/lib/media/config.ts';
import { matchArticle } from '../apps/api/src/lib/media/rules.ts';
import { searchArticles } from '../apps/api/src/lib/media/wikipedia.ts';

const CASES = [
  { place: { name: 'Berlin', placeType: 'city', lat: 52.52, lng: 13.405 }, title: 'Berlin' },
  {
    place: { name: 'Hallstatt', placeType: 'town', lat: 47.5622, lng: 13.6493 },
    title: 'Hallstatt',
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
  },
  {
    place: { name: 'Amalfi Coast', placeType: 'area', lat: 40.633, lng: 14.602 },
    title: 'Amalfi Coast',
  },
  { place: { name: 'Kyoto', placeType: 'city', lat: 35.0116, lng: 135.7681 }, title: 'Kyoto' },
  { place: { name: 'Dolomites', placeType: 'region', lat: 46.41, lng: 11.84 }, title: 'Dolomites' },
];

if (!process.env.WIKIMEDIA_CONTACT && existsSync('apps/api/.env.local')) {
  process.loadEnvFile('apps/api/.env.local');
}

const { contact } = readMediaConfig();

if (!contact) {
  console.error('Set WIKIMEDIA_CONTACT (an email address or URL) in apps/api/.env.local.');
  process.exit(1);
}

let failures = 0;

for (const { place, title } of CASES) {
  const label = `${place.name} (${place.lat}, ${place.lng})`;

  try {
    const match = matchArticle(place, await searchArticles(place.name, contact));
    const pass = match?.title === title && match.extract.length > 0;

    if (!pass) {
      failures += 1;
    }

    const found = match ? `${match.title}${match.extract ? '' : ' (no introduction)'}` : 'no match';

    console.log(
      `${pass ? 'pass' : 'FAIL'}  ${label}: ${found}${pass ? '' : `, expected ${title}`}`,
    );
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

- [ ] **Step 2: Run it live**

Run: `WIKIMEDIA_CONTACT=<contact> node scripts/check-place-media.mjs`
Expected: eight `pass` lines and `All 8 cases pass.` If a case fails, fix the rule in `rules.ts` (and its unit test) rather than the case, unless the expectation is wrong; note any change in the PR.

- [ ] **Step 3: Commit**

```bash
pnpm fix
git add scripts/check-place-media.mjs
git commit -m "Add the live place media check"
```

---

### Task 7: The mobile pure layer

**Files:**

- Modify: `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/index.ts`
- Modify: `apps/mobile/src/features/workspace/workspace-layout.ts` (export `legBetween`)
- Create: `apps/mobile/src/features/workspace/stop-details.ts`
- Modify: `apps/mobile/src/features/workspace/workspace-actions.ts`
- Create: `apps/mobile/src/data/place-media.ts`
- Test: `tests/mobile-stop-details.test.mjs`, `tests/mobile-place-media.test.mjs`; modify `tests/mobile-format.test.mjs`, `tests/mobile-workspace-actions.test.mjs`

**Interfaces:**

- Consumes: `tripParts`, `IntentMedia`, `GraphSnapshot`, `LegData`, `PlaceData`, `StayData` from `@nexui/types`.
- Produces:
  - `#lib`: `capitalize(text): string`, `ordinalWord(n): string`, `countryName(code): string`, `travelTo(mode: LegData['mode'], name: string): string`, `legFigures(leg: LegData): string`.
  - `workspace-layout.ts`: `legBetween(snapshot, fromId, toId): GraphObject | null` (exported).
  - `stop-details.ts`: `interface StopDetails { place; data: PlaceData; order; count; next: { place; leg: GraphObject | null } | null; stays: GraphObject[]; canEditDays: boolean }`; `stopDetails(snapshot, placeId): StopDetails | null`; `stopKind(data): string`; `stopSubtitle(details): string`; `stopButtonLabel(name, order, days): string`; `stayLine(data): string`.
  - `workspace-actions.ts`: `WorkspaceAction` gains `{ type: 'openPlace'; placeId: string }`; `ServerAction` excludes it; `daysAction(place: GraphObject, days: number): SetDaysAction | null`.
  - `data/place-media.ts`: `MEDIA_POLLS = 10`; `mediaPlaceIds(snapshot): string[]`; `mediaKeyIds(placeIds): string`; `hasPendingMedia(media): boolean`; `mediaPollInterval(media, answers): number | false`.

- [ ] **Step 1: Write the failing tests**

`tests/mobile-stop-details.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  stayLine,
  stopButtonLabel,
  stopDetails,
  stopSubtitle,
} from '../apps/mobile/src/features/workspace/stop-details.ts';
import {
  KYOTO_ID,
  KYOTO_REL_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  relationshipRow,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const id = (n) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LEG_ID = id(201);
const STAY_ID = id(202);
const NARA_ID = id(203);

// Tokyo, then Kyoto by train with a stay there, and Nara as a decision candidate off the route.
function plan() {
  return mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(LEG_ID, 'leg', {
          mode: 'train',
          estHours: 2.25,
          estCost: { amount: 95, currency: 'USD' },
        }),
        objectRow(STAY_ID, 'stay', {
          name: 'Hotel Kanra',
          placeId: KYOTO_ID,
          nights: 3,
          estNightly: { amount: 120, currency: 'USD' },
        }),
        objectRow(NARA_ID, 'place', { ...kyotoData, name: 'Nara', lat: 34.69, lng: 135.8 }),
      ],
      relationships: [
        relationshipRow(TOKYO_REL_ID, TOKYO_ID, TRIP_ID),
        relationshipRow(KYOTO_REL_ID, KYOTO_ID, TRIP_ID),
        relationshipRow(id(211), LEG_ID, TRIP_ID),
        relationshipRow(id(212), LEG_ID, TOKYO_ID, 'leg_from'),
        relationshipRow(id(213), LEG_ID, KYOTO_ID, 'leg_to'),
        relationshipRow(id(214), STAY_ID, TRIP_ID),
      ],
    }),
  );
}

test('a stop knows its place on the route, the next stop and the leg there', () => {
  const tokyo = stopDetails(plan(), TOKYO_ID);

  assert.equal(tokyo.order, 1);
  assert.equal(tokyo.count, 2);
  assert.equal(tokyo.next.place.id, KYOTO_ID);
  assert.equal(tokyo.next.leg.id, LEG_ID);
  assert.deepEqual(tokyo.stays, []);
  assert.equal(tokyo.canEditDays, true);
  assert.equal(stopSubtitle(tokyo), 'City in Japan, the first of 2 stops');
});

test('the last stop has no next stop and lists its stays', () => {
  const kyoto = stopDetails(plan(), KYOTO_ID);

  assert.equal(kyoto.next, null);
  assert.deepEqual(
    kyoto.stays.map((stay) => stay.id),
    [STAY_ID],
  );
  assert.equal(stayLine(kyoto.stays[0].data), '3 nights, ≈ $120 a night');
});

test('a candidate off the route, a removed stop or a plan with no workspace has no details', () => {
  assert.equal(stopDetails(plan(), NARA_ID), null);
  assert.equal(stopDetails(plan(), id(999)), null);
  assert.equal(stopDetails({ ...plan(), workspace: null }, TOKYO_ID), null);
});

test('labels and lines read naturally', () => {
  assert.equal(stopButtonLabel('Berlin', 1, 3), 'Berlin, stop 1, 3 days. Show details');
  assert.equal(
    stopSubtitle({ data: { placeType: 'region', country: 'AT' }, order: 1, count: 1 }),
    'Region in Austria, the only stop',
  );
  assert.equal(
    stopSubtitle({ data: { placeType: 'town', country: 'IT' }, order: 12, count: 14 }),
    'Town in Italy, the 12th of 14 stops',
  );
  assert.equal(stayLine({ nights: 1 }), '1 night');
});
```

`tests/mobile-place-media.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  hasPendingMedia,
  MEDIA_POLLS,
  mediaKeyIds,
  mediaPlaceIds,
  mediaPollInterval,
} from '../apps/mobile/src/data/place-media.ts';
import {
  KYOTO_ID,
  kyotoData,
  kyotoRow,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoRow,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const NARA_ID = 'a1b2c3d4-0000-4000-8000-000000000203';
const ready = { status: 'ready', about: null, photo: null };

test('every place in the plan is asked about, decision candidates included', () => {
  const snapshot = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        tokyoRow,
        kyotoRow,
        objectRow(NARA_ID, 'place', { ...kyotoData, name: 'Nara' }),
      ],
    }),
  );

  assert.deepEqual(mediaPlaceIds(snapshot), [TOKYO_ID, KYOTO_ID, NARA_ID]);
});

test('the query is keyed by the sorted place ids, so a new stop starts a fetch', () => {
  assert.equal(mediaKeyIds(['b', 'a']), 'a,b');
  assert.notEqual(mediaKeyIds(['a', 'b']), mediaKeyIds(['a', 'b', 'c']));
});

test('it polls every 2 seconds while a lookup is pending, ten times at most', () => {
  const pending = { places: { [TOKYO_ID]: { status: 'pending' }, [KYOTO_ID]: ready } };
  const done = { places: { [TOKYO_ID]: ready } };

  assert.equal(hasPendingMedia(pending), true);
  assert.equal(hasPendingMedia(done), false);
  assert.equal(mediaPollInterval(pending, 1), 2_000);
  assert.equal(mediaPollInterval(pending, MEDIA_POLLS), 2_000);
  assert.equal(mediaPollInterval(pending, MEDIA_POLLS + 1), false);
  assert.equal(mediaPollInterval(done, 1), false);
  assert.equal(mediaPollInterval(undefined, 0), false);
});
```

Add to `tests/mobile-format.test.mjs` (extend its import from `../apps/mobile/src/lib/format.ts` with `capitalize, countryName, legFigures, ordinalWord, travelTo`):

```js
test('ordinals read as words to ten, then as numbers', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(ordinalWord), [
    'first',
    'second',
    'third',
    'fourth',
    'tenth',
  ]);
  assert.deepEqual([11, 12, 13, 21, 22, 23, 101, 111].map(ordinalWord), [
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '101st',
    '111th',
  ]);
});

test('country names come from the code, which is kept when there is no name', () => {
  assert.equal(countryName('DE'), 'Germany');
  assert.equal(countryName('AA'), 'AA');
});

test('a leg reads as its mode, time and cost', () => {
  const train = { mode: 'train', estHours: 4.25, estCost: { amount: 40, currency: 'USD' } };

  assert.equal(travelTo('train', 'Prague'), 'Train to Prague');
  assert.equal(travelTo('car', 'Salzburg'), 'Drive to Salzburg');
  assert.equal(legFigures(train), '4h 15m, ≈ $40');
  assert.equal(legFigures({ mode: 'other' }), '');
  assert.equal(capitalize('region'), 'Region');
});
```

Add to `tests/mobile-workspace-actions.test.mjs` (extend its import from `workspace-actions.ts` with `daysAction`):

```js
test('a stepper tap is a setDays action only when the value is new and in range', () => {
  const tokyo = snapshot().objects.find((object) => object.id === TOKYO_ID);

  assert.deepEqual(daysAction(tokyo, 5), { type: 'setDays', placeId: TOKYO_ID, days: 5 });
  assert.equal(daysAction(tokyo, 4), null);
  assert.equal(daysAction(tokyo, -1), null);
  assert.equal(daysAction(tokyo, 366), null);
  assert.equal(daysAction(tokyo, 2.5), null);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --experimental-strip-types --test tests/mobile-stop-details.test.mjs tests/mobile-place-media.test.mjs tests/mobile-format.test.mjs tests/mobile-workspace-actions.test.mjs`
Expected: FAIL: missing modules `stop-details.ts` and `place-media.ts`, and `ordinalWord`/`daysAction` not exported.

- [ ] **Step 3: Add the format helpers**

In `apps/mobile/src/lib/format.ts`, add `type LegData` to the `@nexui/types` import, then append:

```ts
/** @example capitalize('city') // 'City' */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ORDINAL_WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

/**
 * @example
 * ordinalWord(2) // 'second'
 * ordinalWord(12) // '12th'
 */
export function ordinalWord(n: number): string {
  const word = ORDINAL_WORDS[n - 1];

  if (word) {
    return word;
  }

  const lastTwo = n % 100;

  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${n}th`;
  }

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

  return `${n}${suffixes[n % 10] ?? 'th'}`;
}

let regionNames: Intl.DisplayNames | null | undefined;

// Built once; null where the JS engine has no Intl.DisplayNames.
function regionNameFormat(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }

  return regionNames;
}

/**
 * A country's English name from its ISO code, or the code itself where the runtime has no
 * name for it.
 *
 * @example countryName('DE') // 'Germany'
 */
export function countryName(code: string): string {
  try {
    return regionNameFormat()?.of(code) ?? code;
  } catch {
    return code;
  }
}

const TRAVEL_MODES: Record<LegData['mode'], string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Drive',
  ferry: 'Ferry',
  other: 'Travel',
};

/** @example travelTo('train', 'Prague') // 'Train to Prague' */
export function travelTo(mode: LegData['mode'], name: string): string {
  return `${TRAVEL_MODES[mode]} to ${name}`;
}

/**
 * A leg's time and cost, either of which may be missing.
 *
 * @example
 * legFigures({ mode: 'train', estHours: 4.25, estCost: { amount: 40, currency: 'USD' } })
 * // '4h 15m, ≈ $40'
 */
export function legFigures(leg: LegData): string {
  const parts: string[] = [];

  if (leg.estHours !== undefined) {
    parts.push(formatHours(leg.estHours));
  }

  if (leg.estCost) {
    parts.push(`≈ ${formatMoney(leg.estCost)}`);
  }

  return parts.join(', ');
}
```

In `apps/mobile/src/lib/index.ts`, add `capitalize`, `countryName`, `legFigures`, `ordinalWord` and `travelTo` to the export list (alphabetical).

- [ ] **Step 4: Export `legBetween` and add the stop details**

In `apps/mobile/src/features/workspace/workspace-layout.ts`, change `function legBetween(` to:

```ts
/** The leg from one stop to another, if the graph has one. */
export function legBetween(
```

`apps/mobile/src/features/workspace/stop-details.ts`:

```ts
import {
  tripParts,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
  type StayData,
} from '@nexui/types';

import { capitalize, countryName, formatDays, formatMoney, ordinalWord } from '#lib';

import { legBetween } from './workspace-layout.ts';

/** What a stop's details sheet shows, read from the snapshot. */
export interface StopDetails {
  place: GraphObject;
  data: PlaceData;
  /** Its position on the route, from 1. */
  order: number;
  /** How many stops the route has. */
  count: number;
  /** The next stop and the leg to it; null on the last stop. */
  next: { place: GraphObject; leg: GraphObject | null } | null;
  /** The stays at this stop, in order. */
  stays: GraphObject[];
  /** The workspace's route lets the user change days. */
  canEditDays: boolean;
}

/**
 * One route stop's details, or null when the place isn't on the route: a decision candidate,
 * or a stop that a run, another device or Undo has just removed.
 */
export function stopDetails(snapshot: GraphSnapshot, placeId: string): StopDetails | null {
  const doc = snapshot.workspace?.doc;

  if (!doc) {
    return null;
  }

  const { places, stays } = tripParts(snapshot, doc.anchorId);
  const index = places.findIndex((place) => place.id === placeId);
  const place = places[index];

  if (!place) {
    return null;
  }

  const following = places[index + 1];
  const route = doc.sections.find((section) => section.type === 'route');

  return {
    place,
    data: place.data as PlaceData,
    order: index + 1,
    count: places.length,
    next: following
      ? { place: following, leg: legBetween(snapshot, place.id, following.id) }
      : null,
    stays: stays.filter((stay) => (stay.data as Partial<StayData>).placeId === place.id),
    canEditDays: route?.type === 'route' && route.editable.includes('days'),
  };
}

/** @example stopKind({ placeType: 'city', country: 'DE' }) // 'City in Germany' */
export function stopKind(data: Pick<PlaceData, 'placeType' | 'country'>): string {
  return `${capitalize(data.placeType)} in ${countryName(data.country)}`;
}

/**
 * The line under the sheet's title.
 *
 * @example stopSubtitle(berlin) // 'City in Germany, the first of 4 stops'
 */
export function stopSubtitle(
  details: Pick<StopDetails, 'order' | 'count'> & {
    data: Pick<PlaceData, 'placeType' | 'country'>;
  },
): string {
  const position =
    details.count === 1
      ? 'the only stop'
      : `the ${ordinalWord(details.order)} of ${details.count} stops`;

  return `${stopKind(details.data)}, ${position}`;
}

/** The route row's label. @example stopButtonLabel('Berlin', 1, 3) // 'Berlin, stop 1, 3 days. Show details' */
export function stopButtonLabel(name: string, order: number, days: number): string {
  return `${name}, stop ${order}, ${formatDays(days)}. Show details`;
}

/** @example stayLine({ nights: 3, estNightly: { amount: 120, currency: 'USD' } }) // '3 nights, ≈ $120 a night' */
export function stayLine(data: Pick<StayData, 'nights' | 'estNightly'>): string {
  const nights = `${data.nights} ${data.nights === 1 ? 'night' : 'nights'}`;

  return data.estNightly ? `${nights}, ≈ ${formatMoney(data.estNightly)} a night` : nights;
}
```

- [ ] **Step 5: Add `openPlace` and `daysAction`**

In `apps/mobile/src/features/workspace/workspace-actions.ts`, replace the action types with:

```ts
/** What a primitive reports upward. The workspace screen turns it into a request. */
export type WorkspaceAction =
  | { type: 'setDays'; placeId: string; days: number }
  | { type: 'move'; placeId: string; by: -1 | 1 }
  | { type: 'resolveDecision'; decisionId: string; optionId: string | null }
  | { type: 'capability'; name: string; input: CapabilityRequest['input'] }
  | { type: 'ask'; prompt: string }
  | { type: 'openPlace'; placeId: string };

/** Every action that calls the API; `ask` and `openPlace` open a sheet instead. */
export type ServerAction = Exclude<WorkspaceAction, { type: 'ask' } | { type: 'openPlace' }>;

type SetDaysAction = Extract<WorkspaceAction, { type: 'setDays' }>;
```

and add after `validDays`:

```ts
/**
 * The action for a day stepper tap, or null when the new value is out of range or unchanged.
 * The route and the stop sheet both report it, after `rememberDays`.
 */
export function daysAction(place: GraphObject, days: number): SetDaysAction | null {
  const before = (place.data as PlaceData).days;

  if (!Number.isInteger(days) || days < 0 || days > MAX_PLACE_DAYS || days === before) {
    return null;
  }

  return { type: 'setDays', placeId: place.id, days };
}
```

- [ ] **Step 6: Add the media helpers**

`apps/mobile/src/data/place-media.ts`:

```ts
import type { GraphSnapshot, IntentMedia } from '@nexui/types';

/** How many times the app asks again while a lookup is still pending (spec section 5). */
export const MEDIA_POLLS = 10;

/** Every place in a snapshot, decision candidates included: what the media route answers. */
export function mediaPlaceIds(snapshot: GraphSnapshot): string[] {
  return snapshot.objects.filter((object) => object.kind === 'place').map((object) => object.id);
}

/** The media query's key part: sorted place ids, so a stop the model adds starts a fetch. */
export function mediaKeyIds(placeIds: readonly string[]): string {
  return [...placeIds].sort().join(',');
}

/** True while any place's lookup hasn't finished. */
export function hasPendingMedia(media: IntentMedia | undefined): boolean {
  return media ? Object.values(media.places).some((place) => place.status === 'pending') : false;
}

/**
 * Every 2 seconds while a lookup is pending, for ten refetches after the first answer; then
 * stop. `answers` is how many answers the query has had (TanStack's `dataUpdateCount`).
 */
export function mediaPollInterval(media: IntentMedia | undefined, answers: number): number | false {
  return hasPendingMedia(media) && answers <= MEDIA_POLLS ? 2_000 : false;
}
```

- [ ] **Step 7: Run the tests and the type check**

Run: `node --experimental-strip-types --test tests/mobile-stop-details.test.mjs tests/mobile-place-media.test.mjs tests/mobile-format.test.mjs tests/mobile-workspace-actions.test.mjs && pnpm --filter @nexui/mobile typecheck`
Expected: all pass. If typecheck flags `route?.type === 'route'` as always true (an inferred type predicate), use `route ? route.editable.includes('days') : false`.

- [ ] **Step 8: Commit**

```bash
pnpm fix
git add apps/mobile/src/lib apps/mobile/src/features/workspace apps/mobile/src/data/place-media.ts tests/mobile-*.test.mjs
git commit -m "Add stop details and media polling helpers"
```

---

### Task 8: Fetch place media in the app

**Files:**

- Modify: `apps/mobile/src/data/api.ts`, `apps/mobile/src/data/queries.ts`, `apps/mobile/src/data/index.ts`

**Interfaces:**

- Consumes: `intentMediaSchema`, `IntentMedia` (Task 1); `mediaKeyIds`, `mediaPollInterval`, `mediaPlaceIds` (Task 7).
- Produces: `getPlaceMedia(intentId: string, signal?: AbortSignal): Promise<IntentMedia>`; `queryKeys.media(intentId, ids)`; `usePlaceMedia(intentId: string, placeIds: readonly string[]): UseQueryResult<IntentMedia, Error>`; `#data` exports `mediaPlaceIds`, `usePlaceMedia`.

- [ ] **Step 1: Add the request**

In `apps/mobile/src/data/api.ts`, add `intentMediaSchema` and `type IntentMedia` to the `@nexui/types` import, then after `getIntent`:

```ts
/** Wikipedia details for every place in an intent; places still being looked up are pending. */
export function getPlaceMedia(intentId: string, signal?: AbortSignal): Promise<IntentMedia> {
  return callApi(`/api/intents/${intentId}/media`, intentMediaSchema, { signal });
}
```

- [ ] **Step 2: Add the query**

In `apps/mobile/src/data/queries.ts`:

- import `keepPreviousData` from `@tanstack/react-query`, `type IntentMedia` from `@nexui/types`, `getPlaceMedia` from `./api`, and `mediaKeyIds, mediaPollInterval` from `./place-media`;
- add to `queryKeys`:

```ts
  media: (intentId: string, ids: string): readonly ['media', string, string] =>
    ['media', intentId, ids] as const,
```

- add after `useIntent`:

```ts
/**
 * Wikipedia details for an intent's places, keyed by its sorted place ids so a stop the model
 * adds starts a fetch. While any lookup is pending it asks again every 2 seconds, up to ten
 * times. The last answer stays on screen while a new key loads.
 */
export function usePlaceMedia(
  intentId: string,
  placeIds: readonly string[],
): UseQueryResult<IntentMedia, Error> {
  const ids = mediaKeyIds(placeIds);

  return useQuery({
    queryKey: queryKeys.media(intentId, ids),
    queryFn: ({ signal }) => getPlaceMedia(intentId, signal),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => mediaPollInterval(query.state.data, query.state.dataUpdateCount),
  });
}
```

In `apps/mobile/src/data/index.ts`, add `usePlaceMedia` to the `./queries` export list and a line:

```ts
export { mediaPlaceIds } from './place-media';
```

- [ ] **Step 3: Check it**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
pnpm fix
git add apps/mobile/src/data
git commit -m "Fetch place media in the app"
```

---

### Task 9: Route rows open the stop sheet

**Files:**

- Create: `apps/mobile/src/features/workspace/day-stepper.tsx`
- Modify: `apps/mobile/src/features/workspace/sections/route-section.tsx`
- Modify: `apps/mobile/src/features/workspace/index.ts`
- Modify: `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`

**Interfaces:**

- Consumes: Task 7's `daysAction`, `stopKind`, `stopButtonLabel`, `legFigures`, `capitalize`; Task 8's `usePlaceMedia`, `mediaPlaceIds`.
- Produces: `SmallButton`, `DayStepper({ name, days, was, onDays, surface?: 'card' | 'soft' })`; route rows report `{ type: 'openPlace', placeId }`; the workspace pushes `/place` with `{ intentId, placeId }` (the screen arrives in Task 10). `#features/workspace` also exports `aiMarkFor`, `DayStepper`, `daysAction`, `rememberDays`, `useEditMemoryStore`, `stopDetails`, `stopSubtitle`, `stayLine` and type `StopDetails` for Task 10.

- [ ] **Step 1: Move the stepper into its own file**

`apps/mobile/src/features/workspace/day-stepper.tsx`:

```tsx
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDays } from '#lib';
import { fonts, createThemedStyles } from '#theme';

import { MAX_PLACE_DAYS } from './workspace-actions';

/** What the stepper sits on: a card (soft buttons) or a soft panel (card buttons). */
type Surface = 'card' | 'soft';

/** A 36-point square button with one glyph; its hit area reaches 44 points. */
export function SmallButton({
  glyph,
  label,
  disabled,
  onPress,
  surface = 'card',
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  surface?: Surface;
}): ReactElement {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        surface === 'soft' && styles.smallOnSoft,
        pressed && styles.pressed,
        disabled && styles.dimmed,
      ]}
    >
      <Text style={styles.smallGlyph}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * − days +, adjustable for screen readers, with "was 4" once this session has changed it. The
 * route and the stop sheet share it.
 */
export function DayStepper({
  name,
  days,
  was,
  onDays,
  surface = 'card',
}: {
  name: string;
  days: number;
  was: number | undefined;
  onDays: (days: number) => void;
  surface?: Surface;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Days in ${name}`}
      accessibilityValue={{ text: formatDays(days) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onDays(event.nativeEvent.actionName === 'increment' ? days + 1 : days - 1)
      }
      style={styles.stepper}
    >
      <SmallButton
        glyph="−"
        label={`One day less in ${name}`}
        disabled={days <= 0}
        onPress={() => onDays(days - 1)}
        surface={surface}
      />
      <View style={styles.dayValue}>
        <Text style={styles.days}>{formatDays(days)}</Text>
        {was !== undefined && was !== days ? <Text style={styles.was}>was {was}</Text> : null}
      </View>
      <SmallButton
        glyph="+"
        label={`One more day in ${name}`}
        disabled={days >= MAX_PLACE_DAYS}
        onPress={() => onDays(days + 1)}
        surface={surface}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayValue: { minWidth: 56, alignItems: 'center' },
  days: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  was: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.faint,
    textDecorationLine: 'line-through',
  },
  small: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  smallOnSoft: { backgroundColor: colors.card },
  smallGlyph: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.4 },
}));
```

- [ ] **Step 2: Make each stop row a button**

In `apps/mobile/src/features/workspace/sections/route-section.tsx`:

- delete the local `capitalize`, `SmallButton` and `DayStepper` (now in `../day-stepper`) and their styles (`stepper`, `dayValue`, `was`, `small`, `smallGlyph`, `dimmed`);
- import `capitalize`, `formatDays`, `legFigures`, `placeName` from `#lib`, `DayStepper` and `SmallButton` from `../day-stepper`, `stopButtonLabel` and `stopKind` from `../stop-details`, and `daysAction` from `../workspace-actions` (drop the `MAX_PLACE_DAYS` import);
- replace `StopRow`, `LegRow`'s `parts` and `RouteSection`'s `setDays` as follows.

```tsx
function StopRow({
  stop,
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

  return (
    <View style={styles.stop}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopButtonLabel(name, stop.order, data.days)}
        onPress={onOpen}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <View style={styles.number}>
          <Text style={styles.numberText}>{stop.order}</Text>
        </View>
        <View style={styles.body}>
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
      <View style={styles.controls}>
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

`LegRow`'s parts become:

```tsx
const parts = [data.mode === 'other' ? 'Travel' : capitalize(data.mode), legFigures(data)].filter(
  Boolean,
);
```

`RouteSection`'s `setDays` becomes, and each `StopRow` gains `onOpen`:

```tsx
const setDays = (place: GraphObject, days: number): void => {
  const action = daysAction(place, days);

  if (!action) {
    return;
  }

  rememberDays(place.id, (place.data as PlaceData).days, days);
  onAction(action);
};
```

```tsx
            onOpen={() => onAction({ type: 'openPlace', placeId: stop.place.id })}
```

Replace the row styles (`stop`, `body`, `name`, `detail`, `moves`) with:

```ts
  stop: { gap: 6, paddingVertical: 8 },
  open: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameText: { flexShrink: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  chevron: { marginLeft: 'auto', fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  kind: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
  detail: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 38,
  },
  moves: { flexDirection: 'row', gap: 6 },
  days: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  pressed: { opacity: 0.7 },
```

- [ ] **Step 3: Export what the sheet needs**

`apps/mobile/src/features/workspace/index.ts` becomes:

```ts
export { aiMarkFor } from './ai-mark';
export { DayStepper } from './day-stepper';
export { SectionView } from './sections/registry';
export { stayLine, stopDetails, stopSubtitle } from './stop-details';
export type { StopDetails } from './stop-details';
export { UndoToast } from './undo-toast';
export { rememberDays, useEditMemoryStore } from './use-edit-memory-store';
export { focusIntent, useFocusedIntentStore } from './use-focused-intent-store';
export { useRevealOpenBand } from './use-reveal-open-band';
export { revealOpenBand } from './use-reveal-store';
export { capabilityFor, daysAction, optimisticOps } from './workspace-actions';
export type { WorkspaceAction } from './workspace-actions';
export { layoutWorkspace } from './workspace-layout';
```

- [ ] **Step 4: Open the sheet and prefetch media from the workspace**

In `apps/mobile/src/app/(app)/(tabs)/(home)/intent/[id].tsx`:

- add `mediaPlaceIds` and `usePlaceMedia` to the `#data` import;
- after the `blocks` memo, add:

```tsx
const placeIds = useMemo(() => (snapshot ? mediaPlaceIds(snapshot) : []), [snapshot]);

// Looks the plan's places up as soon as it's open, so a stop's sheet opens with its details.
usePlaceMedia(id, placeIds);
```

- at the top of `handleAction`, before the `ask` branch:

```tsx
if (action.type === 'openPlace') {
  router.push({ pathname: '/place', params: { intentId: id, placeId: action.placeId } });

  return;
}
```

- [ ] **Step 5: Check it**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && pnpm test`
Expected: no errors (typed routes may not know `/place` until Task 10 adds the screen; if `tsc` complains about the pathname, do Task 10 Step 2 first and commit both together).

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add apps/mobile/src
git commit -m "Make each route stop open its details"
```

---

### Task 10: The stop sheet

**Files:**

- Create: `apps/mobile/src/features/place/place-sheet.tsx`, `apps/mobile/src/features/place/index.ts`
- Create: `apps/mobile/src/app/(app)/place.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: Task 9's workspace exports, Task 8's `usePlaceMedia`, `mediaPlaceIds`, and `useIntent`, `useWorkspaceEdit`, `useUndo` from `#data`.
- Produces: `PlaceSheet` and `type AboutState = PlaceAbout | 'pending' | null` from `#features/place`; the `place` route with params `{ intentId, placeId }`.

- [ ] **Step 1: Write the sheet's components**

`apps/mobile/src/features/place/place-sheet.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LegData, PlaceAbout, StayData } from '@nexui/types';

import { formatDays, formatMoney, legFigures, placeName, travelTo } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { AiText, Button } from '#ui';
import {
  aiMarkFor,
  DayStepper,
  stayLine,
  stopSubtitle,
  type StopDetails,
} from '#features/workspace';

/** The About section: the introduction, a placeholder while it's looked up, or nothing. */
export type AboutState = PlaceAbout | 'pending' | null;

function SheetSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function About({
  name,
  about,
  onReadMore,
}: {
  name: string;
  about: AboutState;
  onReadMore: (url: string) => void;
}): ReactElement | null {
  const styles = useStyles();

  if (about === null) {
    return null;
  }

  if (about === 'pending') {
    return (
      <SheetSection title={`About ${name}`}>
        <Text style={styles.quiet}>Looking up {name}…</Text>
      </SheetSection>
    );
  }

  return (
    <SheetSection title={`About ${name}`}>
      <Text style={styles.paragraph}>{about.extract}</Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => onReadMore(about.url)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.linkText}>Read more on Wikipedia</Text>
      </Pressable>
    </SheetSection>
  );
}

function NextStop({
  next,
  onPress,
}: {
  next: NonNullable<StopDetails['next']>;
  onPress: () => void;
}): ReactElement {
  const styles = useStyles();
  const name = placeName(next.place);
  const leg = next.leg ? (next.leg.data as LegData) : null;
  const title = leg ? travelTo(leg.mode, name) : `On to ${name}`;
  const figures = leg ? legFigures(leg) : '';

  return (
    <SheetSection title="Next stop">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${[title, figures].filter(Boolean).join(', ')}. Show details`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.rowIcon}>
          <Text style={styles.rowIconText}>→</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{title}</Text>
          {figures ? <Text style={styles.rowDetail}>{figures}</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </SheetSection>
  );
}

function Stays({
  stays,
  onFindStay,
}: {
  stays: StopDetails['stays'];
  onFindStay: () => void;
}): ReactElement {
  const styles = useStyles();

  if (stays.length === 0) {
    return (
      <SheetSection title="Where you’ll stay">
        <Text style={styles.quiet}>No place to stay yet.</Text>
        <Button label="Find a stay with Nexui" variant="primary" onPress={onFindStay} />
      </SheetSection>
    );
  }

  return (
    <SheetSection title="Where you’ll stay">
      {stays.map((stay) => {
        const data = stay.data as StayData;

        return (
          <View key={stay.id} style={styles.stay}>
            <AiText
              text={data.name}
              highlight={aiMarkFor(stay).highlight}
              style={styles.rowTitle}
            />
            <Text style={styles.rowDetail}>{stayLine(data)}</Text>
          </View>
        );
      })}
    </SheetSection>
  );
}

/**
 * A route stop's details (spec section 5): its name and place on the route, days and daily
 * cost, why it's on the route, Wikipedia's introduction, the next stop and where you'll stay.
 * It only reports taps; the place screen does the work.
 */
export function PlaceSheet({
  details,
  about,
  was,
  onDone,
  onDays,
  onNext,
  onFindStay,
  onReadMore,
}: {
  details: StopDetails;
  about: AboutState;
  /** The days before this session's first change, for "was 4". */
  was: number | undefined;
  onDone: () => void;
  onDays: (days: number) => void;
  onNext: (placeId: string) => void;
  onFindStay: () => void;
  onReadMore: (url: string) => void;
}): ReactElement {
  const styles = useStyles();
  const { data, next } = details;
  const name = placeName(details.place);
  const highlight = aiMarkFor(details.place).highlight;

  return (
    <View>
      <Button label="Done" onPress={onDone} style={styles.done} />
      <View style={styles.header}>
        <AiText text={name} highlight={highlight} style={styles.title} />
        <Text style={styles.subtitle}>{stopSubtitle(details)}</Text>
      </View>
      <View style={styles.panel}>
        <View style={styles.panelRow}>
          <Text style={styles.panelLabel}>Days here</Text>
          {details.canEditDays ? (
            <DayStepper name={name} days={data.days} was={was} onDays={onDays} surface="soft" />
          ) : (
            <Text style={styles.panelValue}>{formatDays(data.days)}</Text>
          )}
        </View>
        {data.estDailyCost ? (
          <>
            <View style={styles.divider} />
            <View style={styles.panelRow}>
              <Text style={styles.panelLabel}>Daily cost</Text>
              <Text style={styles.panelValue}>≈ {formatMoney(data.estDailyCost)}</Text>
            </View>
          </>
        ) : null}
      </View>
      {data.why ? (
        <SheetSection title="Why it’s on your route">
          <AiText text={data.why} highlight={highlight} style={styles.paragraph} />
        </SheetSection>
      ) : null}
      <About name={name} about={about} onReadMore={onReadMore} />
      {next ? <NextStop next={next} onPress={() => onNext(next.place.id)} /> : null}
      <Stays stays={details.stays} onFindStay={onFindStay} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  done: { alignSelf: 'flex-end' },
  header: { gap: 4, paddingTop: 6 },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  subtitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.muted },
  panel: { marginTop: 16, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.soft },
  panelRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  panelValue: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.line },
  section: { gap: 8, paddingTop: 24 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.ink },
  paragraph: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.ink },
  quiet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  rowIconText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  rowDetail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 18, color: colors.muted },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  stay: { gap: 2, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
}));
```

`apps/mobile/src/features/place/index.ts`:

```ts
export { PlaceSheet } from './place-sheet';
export type { AboutState } from './place-sheet';
```

- [ ] **Step 2: Write the screen and register it**

`apps/mobile/src/app/(app)/place.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import type { IntentMedia } from '@nexui/types';

import { mediaPlaceIds, useIntent, usePlaceMedia, useUndo, useWorkspaceEdit } from '#data';
import { placeName } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { Button, ListEmpty, ListError, SkeletonRows } from '#ui';
import { PlaceSheet, type AboutState } from '#features/place';
import {
  UndoToast,
  capabilityFor,
  daysAction,
  optimisticOps,
  rememberDays,
  stopDetails,
  useEditMemoryStore,
} from '#features/workspace';

// What About shows for one place: its introduction, a placeholder while the lookup runs or the
// answer loads, or nothing (no article, a failed lookup, or the request failed).
function aboutState(media: IntentMedia | undefined, placeId: string, loading: boolean): AboutState {
  const entry = media?.places[placeId];

  if (entry?.status === 'ready') {
    return entry.about;
  }

  if (entry?.status === 'pending' || loading) {
    return 'pending';
  }

  return null;
}

/**
 * A route stop's details, opened from its row on the workspace (spec section 5). It reads the
 * plan from the workspace's cache and the place's Wikipedia details from the media query. Day
 * changes go through the same capability, optimistic op and Undo as the route; Next stop
 * swaps in the next stop's details.
 */
export default function PlaceScreen(): ReactElement {
  const styles = useStyles();
  const { intentId, placeId } = useLocalSearchParams<{ intentId: string; placeId: string }>();
  const intent = useIntent(intentId);
  const snapshot = intent.data;
  const placeIds = useMemo(() => (snapshot ? mediaPlaceIds(snapshot) : []), [snapshot]);
  const media = usePlaceMedia(intentId, placeIds);
  const edit = useWorkspaceEdit(intentId);
  const undo = useUndo();
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const scroll = useRef<ScrollView>(null);
  const details = snapshot ? stopDetails(snapshot, placeId) : null;

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [placeId]);

  const setDays = (days: number): void => {
    const action = details ? daysAction(details.place, days) : null;

    if (!details || !snapshot || !action) {
      return;
    }

    const request = capabilityFor(action, snapshot);

    if (!request) {
      return;
    }

    rememberDays(details.place.id, details.data.days, days);
    edit.mutate(
      { request, optimistic: optimisticOps(action, snapshot) },
      { onSuccess: (result) => setUndoable(result.event.id) },
    );
  };

  const findStay = (): void => {
    if (!details) {
      return;
    }

    router.dismiss();
    router.push({
      pathname: '/compose',
      params: { intentId, prompt: `Find a stay in ${placeName(details.place)}` },
    });
  };

  const renderBody = (): ReactElement => {
    if (intent.isPending) {
      return <SkeletonRows count={4} />;
    }

    if (intent.isLoadingError) {
      return <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />;
    }

    if (!details) {
      return (
        <View style={styles.gone}>
          <ListEmpty text="This stop is no longer on your route." />
          <Button label="Done" onPress={() => router.back()} />
        </View>
      );
    }

    return (
      <PlaceSheet
        details={details}
        about={aboutState(media.data, details.place.id, media.isPending || media.isPlaceholderData)}
        was={wasDays[details.place.id]}
        onDone={() => router.back()}
        onDays={setDays}
        onNext={(next) => router.setParams({ placeId: next })}
        onFindStay={findStay}
        onReadMore={(url) => void Linking.openURL(url).catch(() => undefined)}
      />
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}>
        {edit.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t save that. {edit.error.message}
          </Text>
        ) : null}
        {undo.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t undo that. {undo.error.message}
          </Text>
        ) : null}
        {renderBody()}
      </ScrollView>
      {undoable ? (
        <UndoToast
          key={undoable}
          onDismiss={hideUndo}
          onUndo={() => {
            undo.mutate(undoable);
            setUndoable(null);
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.card },
  scroll: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 },
  gone: { gap: 12 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
```

In `apps/mobile/src/app/(app)/_layout.tsx`, rename `composeOptions` to `sheetOptions`, update its comment, and register the screen:

```tsx
  // The + sheet and a stop's details rise over everything, tab bar included. iOS gets a tall
  // form sheet; Android and web get a modal, which keeps the keyboard behavior predictable.
  const sheetOptions =
```

```tsx
        <Stack.Screen name="compose" options={sheetOptions} />
        <Stack.Screen name="place" options={sheetOptions} />
```

- [ ] **Step 3: Check it**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && pnpm test`
Expected: no errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
pnpm fix
git add apps/mobile/src
git commit -m "Add the stop details sheet"
```

---

### Task 11: Docs

**Files:**

- Create: `docs/architecture/place-media.md`
- Modify (through `docs-keeper`): `docs/architecture/mobile.md`, `AGENTS.md`, any other doc that lists routes, env or commands.

- [ ] **Step 1: Write the architecture doc**

`docs/architecture/place-media.md` covers, in this order, with short paragraphs and the real file paths:

1. What it is: stop details now, photos in phase 2; the spec's link.
2. The place key (`placeMediaKey`), with the Český Krumlov and "Washington, D.C." examples and why punctuation folds.
3. The lookup: request 1's parameters, the User-Agent, the 4-second timeout, the match rules, and `searchArticles` / `matchArticle`.
4. The cache: the columns, the statuses and expiry, `lookup_version`, and how an operator fixes a row:

   ```sql
   update public.place_media
   set status = 'none', page_title = null, page_url = null, extract = null, pinned = true
   where key = 'amalfi coast|IT|40.6|14.6';
   ```

5. The route: handler order, the 20-lookup cap, four at a time, the 6-second budget, `after()`, `pending`, and the contract.
6. Configuration: `WIKIMEDIA_CONTACT`, and what happens without it.
7. Failures and logs: 429/503, other errors, cache write failures, and the counts-only log lines.
8. The app: `usePlaceMedia` and its polling, the workspace prefetch, the `openPlace` action, the `place` sheet and its sections.
9. Checking it: the four test files and `node scripts/check-place-media.mjs`.

- [ ] **Step 2: Run docs-keeper**

Dispatch the `docs-keeper` agent with: the new route `GET /api/intents/:id/media`; the new env var `WIKIMEDIA_CONTACT` (already in `apps/api/.env.example`); the new command `node scripts/check-place-media.mjs`; the new `place` sheet, `features/place/`, the `openPlace` action, the compact route rows, `day-stepper.tsx`, and the new pure modules (`stop-details.ts`, `data/place-media.ts`) for `docs/architecture/mobile.md`; and the `place_media` table for `docs/architecture/intent-graph.md`'s tables list if it lists non-graph tables. Review its diff.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add docs AGENTS.md
git commit -m "Document place details"
```

---

### Task 12: Verify, review and hand off

- [ ] **Step 1: Run every check**

Run: `pnpm fix && git diff --stat && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`
Expected: all pass. Inspect the diff for unrelated changes.

- [ ] **Step 2: Reviews**

Dispatch `api-reviewer`, `mobile-reviewer` and `security-reviewer` in parallel on the branch diff against `main`. Fix what they confirm, re-run Step 1, and commit the fixes.

- [ ] **Step 3: Apply the migration (the user)**

Ask the user to run `! pnpm db:push` (dev), then push to prod as in the Supabase projects note, and to set `WIKIMEDIA_CONTACT` in `apps/api/.env.local` and in Vercel.

- [ ] **Step 4: Live check**

Run: `node scripts/check-place-media.mjs`
Expected: `All 8 cases pass.`

- [ ] **Step 5: Smoke test as the QA user (Expo web and the iOS simulator, light and dark)**

From the worktree, with the API on port 3010 and Expo on 8091 (`EXPO_PUBLIC_API_URL=http://localhost:3010`), restarting Expo after any edit:

1. `node scripts/qa-session.mjs > .qa/session.json`; open a plan with Berlin (or create "4 days in Berlin and Prague").
2. Tap each stop: the sheet opens with name, "City in Germany, the first of N stops", days, why, About (placeholder, then Berlin's introduction), Next stop and Where you'll stay.
3. Change days in the sheet; the route underneath changes; Undo restores it.
4. Follow Next stop to the next stop's details, which scroll to the top.
5. Read more opens the Wikipedia article.
6. Find a stay with Nexui closes the sheet and opens + with "Find a stay in Berlin".
7. Light and dark. Check `GET /api/health` answers `{"status":"ok"}`.
8. `node scripts/qa-session.mjs --revoke .qa/session.json`. Keep screenshots in `.qa/`.

- [ ] **Step 6: Push and open a draft PR**

```bash
git push -u origin worktree-place-details
gh pr create --draft --title "Place details: stop sheet with Wikipedia introductions (phase 1)" --body "…"
```

The body explains the change, lists the decisions above, the validation results and screenshots, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
