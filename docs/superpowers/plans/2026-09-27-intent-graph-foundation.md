# Intent Graph Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the task/event/note capture product with the intent graph foundation: dark-mode
tokens, graph contracts, the Postgres schema with atomic changesets and Undo/Redo, the
deterministic travel template and trip derivations, and the API routes. No AI yet.

**Architecture:** `@nexui/types` holds every contract and the pure graph functions
(`evaluateQuery`, `applyOps`, `tripFigures`), so the API and the mobile app share them. The API
validates and derives in TypeScript (`prepareChangeset`), then calls `security definer`
Postgres functions that write rows, record before and after values, and log one `events` row
per changeset. Clients can only read tables. The mobile app gets its new Home · (+) · Changes
shell with placeholder screens and full light/dark theming.

**Tech Stack:** pnpm 10 + Turborepo, Next.js 16 route handlers, Supabase Postgres (plpgsql,
RLS, Realtime publication), Zod 4, Expo 57 / React Native 0.86, Node's built-in test runner
with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-27-intent-graph-design.md` (sections B, C, D, G, H
step 1–4, I). This is plan **1 of 4** for slice 1:

1. **Foundation (this plan).**
2. Intelligence: capabilities, Jev routing, Gateway cognition, runs, mock fixtures.
3. Mobile: Home, Changes, workspace renderer, the 8 primitives, Realtime.
4. Ask flow, travel evals and the end-to-end smoke test.

## Global Constraints

- Node.js 24 (`nvm use`), pnpm 10.34.5. Run commands from the worktree root.
- Strict TypeScript, two-space indent, single quotes, semicolons, trailing commas, 100-char
  lines. Braces on every `if`/`else`/`for`/`while`. Blank line before `return`, after blocks and
  after declaration groups (`pnpm lint:fix` adds them).
- Relative imports inside `apps/api` and `packages/types` include the `.ts` extension (the Node
  test runner loads source files directly).
- Exported functions have explicit parameter and return types. Use `import type` for types.
- API route order: `verifyRequest` → `request.json()` in `try`/`catch` (400 `Invalid JSON`) →
  `safeParse` (400 user-safe message) → call `src/lib/<domain>` → `schema.parse` the response.
  Errors are `{ error: string }`, safe to show a user. Log `console.error('[tag]', message)` with
  no tokens, bodies or provider errors.
- Every `public` SQL function sets `search_path = ''`. Clients get no insert, update or delete
  on `intents`, `objects`, `relationships`, `events`, `workspaces` or `runs`.
- Mobile colors come only from `apps/mobile/src/lib/theme.ts` tokens (light and dark). No raw
  hex, `rgb(`, `rgba(`, `'white'` or `'black'` anywhere else in `apps/mobile/src`.
- No task lists or checkboxes anywhere in the product.
- After each task: `pnpm fix`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm format:check` all pass before committing.
- Commit messages: concise imperative subject, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A client sends invalid domain data** (for example a place with `days: -1` or `2.5`, or an
   unknown kind). Expected: 400 with a readable message and nothing written. Test in Task 9
   (`changesets-route.test.mjs`).
2. **Two edits race on the same object** (`expectedUpdatedAt` is stale). Expected: 409 "This
   changed while you were editing. Try again." Test in Task 9.
3. **Undo after a later edit to the same row, or Undo twice.** Expected: 409 with "Something
   changed since then, so this can't be undone." or "That was already undone." Test in Task 9
   (`event-undo-route.test.mjs`) and the SQL smoke script in Task 11.
4. **A client tries to forge server-owned fields**: `source: {type:'ai'}`, `update_intent`,
   `set_workspace` or an `origin`. Expected: 400, because the user op schema is strict. Test in
   Task 3 (`graph-contracts.test.mjs`) and Task 9.
5. **Costs in a currency the rate table doesn't know** (for example `XAF`). Expected: the
   estimate skips it and sets `costIncomplete: true`; nothing throws. Test in Task 5
   (`trip-figures.test.mjs`).

---

## File map

**`packages/types/src/`** (shared contracts and pure functions)

- `index.ts` re-exports everything below.
- `auth.ts`: health, email-code and error schemas (moved unchanged from `index.ts`).
- `primitives.ts`: `idSchema`, `timestampSchema`, `relTypeSchema`, `capabilityNameSchema`,
  `insightActionSchema`.
- `kinds/travel.ts`: money and the eight kind data schemas.
- `kinds/registry.ts`: `KIND_REGISTRY`, `kindNameSchema`, `parseKindData`.
- `kinds/trip-figures.ts`: currency table, `daysBetween`, `tripParts`, `tripFigures`.
- `workspace.ts`: `graphQuerySchema`, `sectionSchema`, `workspaceDocSchema`.
- `graph.ts`: intent, object, relationship, workspace record, snapshot and event schemas.
- `ops.ts`: `changesetOpSchema`, `userOpSchema`, `fromUserOps`.
- `query.ts`: `readField`, `evaluateQuery`.
- `apply-ops.ts`: `GraphOpError`, `applyOps`.
- `api.ts`: route request and response schemas.

**`apps/api/src/lib/`**

- `graph/errors.ts`: `GraphNotFoundError`, `ChangesetInvalidError`, `ChangesetConflictError`,
  `mapRpcError`.
- `graph/mappers.ts`: database rows (snake_case) → contracts.
- `graph/snapshot.ts`: `loadSnapshot`.
- `graph/prepare.ts`: `markReviewed`, `validateOps`, `coalesceOps`, `prepareChangeset`.
- `graph/commit.ts`: `commitChangeset`, `createIntent`, `revertEvent`.
- `graph/lists.ts`: `listIntents`, `listChanges`.
- `graph/respond.ts`: `graphErrorResponse` (graph errors → HTTP responses).
- `kinds/trip.ts`: `findShortenedPlace`, `deriveTrip`, `formatDateRange`.
- `templates/travel.ts`: `travelWorkspace`, `seedTravelOps`.
- `templates/index.ts`: `deriveForTemplate`.

**`apps/api/src/app/api/`**: `intents/route.ts`, `intents/[id]/route.ts`,
`intents/[id]/changesets/route.ts`, `events/[id]/undo/route.ts`, `changes/route.ts`.

**`supabase/`**: `migrations/20260927000000_intent_graph.sql`,
`tests/intent-graph-smoke.sql`.

**`apps/mobile/src/`**: `lib/theme.ts`, `lib/use-theme.ts`, the shell, and every kept component
converted to themed styles.

**`tests/`**: `support/graph.mjs`, `graph-contracts`, `graph-query`, `apply-ops`,
`trip-figures`, `travel-template`, `derive-trip`, `graph-prepare`, `intent-graph-migration`,
`intents-route`, `intent-snapshot-route`, `changesets-route`, `event-undo-route`,
`changes-route`, and `theme-tokens` (rewritten).

**Other:** `scripts/smoke-intent-graph.mjs`, `docs/architecture/intent-graph.md`, and updates to
`AGENTS.md`, `README.md`, `apps/api/.env.example` and `turbo.json`.

---

### Task 1: Clean slate

Remove the capture product and leave a compiling Home · (+) · Changes shell with placeholders.

**Files:**

- Delete (API): `apps/api/src/app/api/intent/`, `apps/api/src/app/api/intent-events/`,
  `apps/api/src/app/api/items/`, `apps/api/src/app/api/search/`,
  `apps/api/src/app/api/tasks/`, `apps/api/src/app/api/timeline/`,
  `apps/api/src/lib/decision-engine/`, `apps/api/src/lib/records/`.
- Delete (mobile): `src/app/(app)/(tabs)/tasks.tsx`, `calendar.tsx`, `notes.tsx`;
  `src/components/change-sheet.tsx`, `draft-sheet.tsx`, `edit-sheet.tsx`,
  `intent-previews.tsx`, `item-form-sheet.tsx`, `magic-bar.tsx`, `timeline-row.tsx`,
  `undo-toast.tsx`; `src/lib/change-actions.ts`, `commit-label.ts`, `compose-context.ts`,
  `form-values.ts`, `highlight-segments.ts`, `intent-confidence.ts`, `intent-display.ts`,
  `item-fields.ts`, `item-filter.ts`, `submit-decision.ts`, `task-groups.ts`,
  `timeline-pages.ts`, `use-intent-prediction.ts`, `use-timeline.ts`;
  `src/stores/use-demo-store.ts`, `use-recent-inputs.ts`, `use-undo-store.ts`.
- Delete (tests): every file in `tests/` except `account-route`, `auth-contract`,
  `authenticated-fetch`, `http-responses`, `mobile-auth`, `session-lifecycle`,
  `verify-request`, `theme-tokens` (rewritten in Task 2) and `support/supabase-auth.mjs`.
- Delete (other): `evals/`, `scripts/eval-intent.mjs`, `.claude/skills/add-intent/`,
  `.claude/agents/intent-evaluator.md`, `docs/specs/`,
  `docs/superpowers/specs/2026-09-24-*`, `docs/superpowers/plans/2026-09-24-*`,
  `docs/architecture/instant-actions.md`, `docs/architecture/persistence.md`,
  `supabase/migrations/*.sql`, `supabase/tests/rls-smoke.sql`.
- Create: `packages/types/src/auth.ts`, `apps/mobile/src/app/(app)/(tabs)/changes.tsx`.
- Modify: `packages/types/src/index.ts`, `packages/types/tsconfig.json`, `package.json`,
  `apps/mobile/src/lib/api.ts`, `apps/mobile/src/components/tab-bar-items.tsx`,
  `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/index.tsx`,
  `apps/mobile/src/app/(app)/compose.tsx`, `apps/mobile/src/app/(app)/_layout.tsx`,
  `apps/mobile/src/app/_layout.tsx`.

**Interfaces:**

- Produces: `@nexui/types` exporting only the auth contracts (`healthResponseSchema`,
  `emailCodeRequestSchema`, `emailCodeVerificationSchema`, `authErrorSchema` and their types).
  Routes `/`, `/changes` and `/compose` exist in the mobile app.

- [ ] **Step 1: Install dependencies in the worktree**

Run: `pnpm install`
Expected: completes with no errors (the worktree starts without `node_modules`).

- [ ] **Step 2: Delete the capture product files**

```bash
git rm -r -q apps/api/src/app/api/intent apps/api/src/app/api/intent-events \
  apps/api/src/app/api/items apps/api/src/app/api/search apps/api/src/app/api/tasks \
  apps/api/src/app/api/timeline apps/api/src/lib/decision-engine apps/api/src/lib/records
git rm -q "apps/mobile/src/app/(app)/(tabs)/tasks.tsx" "apps/mobile/src/app/(app)/(tabs)/calendar.tsx" \
  "apps/mobile/src/app/(app)/(tabs)/notes.tsx"
git rm -q apps/mobile/src/components/{change-sheet,draft-sheet,edit-sheet,intent-previews,item-form-sheet,magic-bar,timeline-row,undo-toast}.tsx
git rm -q apps/mobile/src/lib/{change-actions,commit-label,compose-context,form-values,highlight-segments,intent-confidence,intent-display,item-fields,item-filter,submit-decision,task-groups,timeline-pages,use-intent-prediction,use-timeline}.ts
git rm -q apps/mobile/src/stores/{use-demo-store,use-recent-inputs,use-undo-store}.ts
git rm -q tests/{action-builder,action-candidates,change-actions,commit-flow,decision-engine-provider,form-values,highlight-segments,intent-actions-contract,intent-confidence,intent-contract,intent-entities,intent-events-route,intent-route,item-fields,items-route,jev-decision-engine,mock-decision-engine,recent-inputs,records-contract,records-mappers,records-targets,search-route,shell-contracts,tasks-route,timeline-kind-migration,timeline-pages,timeline-route,undo-route}.test.mjs tests/support/records.mjs
git rm -r -q evals scripts/eval-intent.mjs .claude/skills/add-intent .claude/agents/intent-evaluator.md \
  docs/specs docs/architecture/instant-actions.md docs/architecture/persistence.md \
  supabase/migrations supabase/tests/rls-smoke.sql
git rm -q docs/superpowers/specs/2026-09-24-*.md docs/superpowers/plans/2026-09-24-*.md
pnpm --filter @nexui/api remove chrono-node
```

If a `git rm` reports a path that doesn't exist, check `git status` and continue: the list
above was taken from `main` at `814da2f`. The Jev transport (Gateway `/v1/evaluate` with abort
and timeout) stays in history at
`814da2f:apps/api/src/lib/decision-engine/jev-decision-engine.ts`; plan 2 rebuilds
`lib/perception` from it.

- [ ] **Step 3: Move the auth contracts into `auth.ts` and re-export them**

Create `packages/types/src/auth.ts` with exactly the first block of the old `index.ts` (from
`import { z } from 'zod';` through `export type AuthError = z.infer<typeof authErrorSchema>;`,
unchanged). Replace `packages/types/src/index.ts` with:

```ts
export * from './auth.ts';
```

Replace `packages/types/tsconfig.json` with:

```json
{
  "extends": "@nexui/config/typescript/base.json",
  "compilerOptions": { "allowImportingTsExtensions": true },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Trim the mobile API client**

Replace `apps/mobile/src/lib/api.ts` with the two calls that remain (plan 3 adds the graph
calls):

```ts
import { healthResponseSchema, type HealthResponse } from '@nexui/types';

import { fetchWithSession } from './authenticated-fetch';
import { supabase } from './supabase';

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  }

  signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 5_000);

  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Health request failed: ${response.status}`);
    }

    const body: unknown = await response.json();

    return healthResponseSchema.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

// Permanently deletes the signed-in user's account on the server.
export async function deleteAccount(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchWithSession(supabase.auth, `${apiUrl}/api/account`, {
      method: 'DELETE',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Account deletion failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 5: Rewire the tab bar to Home · (+) · Changes**

In `apps/mobile/src/components/tab-bar-items.tsx`:

- Remove the `ShellTab` import, `PATH_TABS` and `usePathname`.
- Change `TabIconName` to `'home' | 'changes'`.
- Replace the `tasks`, `calendar` and `notes` cases in `Glyph` with a `changes` case (a clock):

```tsx
    case 'changes':
      return (
        <View style={styles.glyph}>
          <View style={[styles.clock, stroke]}>
            <View style={[styles.clockHour, fill]} />
            <View style={[styles.clockMinute, fill]} />
          </View>
        </View>
      );
```

- Make `TabIcon` render the glyph without the yellow pill (the active tab is shown by its
  tint and bold label, as in the design):

```tsx
/** A tab's icon; the active tab is shown by its tint and bold label. */
export function TabIcon({ name, color }: { name: TabIconName; color: ColorValue }): ReactElement {
  return (
    <View style={styles.iconSlot}>
      <Glyph name={name} color={color} />
    </View>
  );
}
```

- Change `PlusTabButton` to open the + sheet with no params, labelled for plans:

```tsx
/** The + in the middle of the tab bar. It opens the + sheet over the current screen. */
export function PlusTabButton(): ReactElement {
  return (
    <View style={styles.plusSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start or change a plan"
        onPress={() => router.push('/compose')}
        style={({ pressed }) => [styles.plus, pressed && styles.plusPressed]}
      >
        <View style={styles.plusBarWide} />
        <View style={styles.plusBarTall} />
      </Pressable>
    </View>
  );
}
```

- In `styles`: delete `pill`, `pillActive`, `box`, `tick`, `calendar`, `calendarBar`, `page`,
  `pageLine` and `pageLineShort`, and add:

```ts
  iconSlot: { width: 46, height: 30, alignItems: 'center', justifyContent: 'center' },
  clock: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHour: { position: 'absolute', top: 3, width: 2, height: 6, borderRadius: 1 },
  clockMinute: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 5,
    height: 2,
    borderRadius: 1,
  },
```

- Make the + a round accent button, as in the design: `plus` becomes
  `{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }`,
  and both bars use `backgroundColor: colors.accentInk`.

- [ ] **Step 6: Replace the tabs layout and add the Changes placeholder**

Replace `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`'s `<Tabs>` children with three screens
(keep the existing `screenOptions`, but drop `focused` from `TabIcon` calls):

```tsx
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen name="plus" options={{ title: 'New', tabBarButton: () => <PlusTabButton /> }} />
      <Tabs.Screen
        name="changes"
        options={{
          title: 'Changes',
          tabBarIcon: ({ color }) => <TabIcon name="changes" color={color} />,
        }}
      />
```

Update its comment to `// Home · (+) · Changes. The order and the + button never move.`

Create `apps/mobile/src/app/(app)/(tabs)/changes.tsx`:

```tsx
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListEmpty } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { colors } from '@/lib/theme';

// Placeholder until the Changes feed arrives (intent graph plan 3).
export default function ChangesScreen(): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <TabHeader title="Changes" />
        <ListEmpty text="Every change you or Nexui make will show here, with Undo." />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
});
```

- [ ] **Step 7: Update Home, the + sheet and the layouts**

In `apps/mobile/src/app/(app)/(tabs)/index.tsx`: change the header title to `"Plans"`, the
comment to `// Placeholder until the intent cards arrive (intent graph plan 3). The gear opens Account.`,
and the empty text to `"Your plans will show here. Tap + and say what you're trying to do."`.

Replace `apps/mobile/src/app/(app)/compose.tsx` with a placeholder sheet:

```tsx
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/lib/theme';

// Placeholder until the + sheet's composer arrives (intent graph plan 3).
export default function ComposeSheet(): ReactElement {
  return (
    <View style={styles.sheet}>
      <Text accessibilityRole="header" style={styles.title}>
        What are you trying to do?
      </Text>
      <Text style={styles.body}>Starting a plan from here arrives in the next build.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 24, gap: 8, backgroundColor: colors.card },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
});
```

In `apps/mobile/src/app/(app)/_layout.tsx`: remove the `UndoToast`, `TAB_BAR_HEIGHT`,
`useSegments` and `useSafeAreaInsets` imports, the toast host `View`s and their styles, so the
component returns the `Stack` wrapped in `<View style={styles.shell}>`. Update the comment to
`// The signed-in shell: the tabs, the + sheet and Account.`

In `apps/mobile/src/app/_layout.tsx`: remove the `clearUndo` import and its call in
`showSession`.

- [ ] **Step 8: Remove the eval script entry**

In the root `package.json`, delete the `"eval:intent"` script line.

- [ ] **Step 9: Verify everything still builds and the kept tests pass**

Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass. `pnpm test` runs the 8 kept test files. `theme-tokens` still passes
because `theme.ts` is unchanged so far.
Also run: `grep -rn "intent-events\|decision-engine\|use-undo-store\|compose-context\|@/lib/use-timeline" apps packages tests`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Remove the capture product and leave a Home · (+) · Changes shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Light and dark theme tokens

**Files:**

- Modify: `apps/mobile/src/lib/theme.ts`, `apps/mobile/app.config.ts`,
  `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(app)/_layout.tsx`,
  `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/index.tsx`,
  `apps/mobile/src/app/(app)/(tabs)/changes.tsx`, `apps/mobile/src/app/(app)/compose.tsx`,
  `apps/mobile/src/app/(app)/account.tsx`, `apps/mobile/src/app/(auth)/_layout.tsx`,
  `apps/mobile/src/app/(auth)/sign-in.tsx`, `apps/mobile/src/app/(auth)/verify.tsx`,
  `apps/mobile/src/components/auth-screen.tsx`,
  `apps/mobile/src/components/connection-banner.tsx`,
  `apps/mobile/src/components/list-states.tsx`, `apps/mobile/src/components/tab-header.tsx`,
  `apps/mobile/src/components/tab-bar-items.tsx`.
- Create: `apps/mobile/src/lib/use-theme.ts`.
- Test: `tests/theme-tokens.test.mjs` (rewrite).

**Interfaces:**

- Produces: `palettes: Record<Scheme, Palette>`, `type TokenName`, `type Palette`,
  `type Scheme = 'light' | 'dark'` and `fonts` from `@/lib/theme`; `useScheme(): Scheme`,
  `useColors(): Palette` and `createThemedStyles(factory: (colors: Palette) => T): () => T`
  from `@/lib/use-theme`. Plan 3 builds every primitive on these.

- [ ] **Step 1: Write the failing token test**

Replace `tests/theme-tokens.test.mjs`:

```js
// Spec section I: every color is a token with a light and a dark value, text pairs pass WCAG
// AA in both themes, and no file but theme.ts holds a raw color.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { palettes } from '../apps/mobile/src/lib/theme.ts';

const expected = {
  light: {
    paper: '#F2F0F6',
    card: '#FFFFFF',
    ink: '#1E1A2B',
    muted: '#5B5670',
    faint: '#6B6582',
    soft: '#F6F4FA',
    line: '#E4E0EC',
    accent: '#FFE45C',
    accentInk: '#1E1A2B',
    success: '#1D7A52',
    danger: '#B3322C',
    scrim: 'rgba(30, 26, 43, 0.38)',
    shade: 'rgba(30, 26, 43, 0.10)',
    aiMark: '#FFE45C',
    aiChip: '#FFE45C',
    aiChipInk: '#1E1A2B',
    userMark: '#1E1A2B',
    mapLand: '#FFFFFF',
    mapSea: '#E3DFED',
    mapRoute: '#1E1A2B',
    mapPin: '#1E1A2B',
    mapPinInk: '#FFFFFF',
  },
  dark: {
    paper: '#15131B',
    card: '#211E2A',
    ink: '#F2EFF8',
    muted: '#B6B0C6',
    faint: '#A09AB2',
    soft: '#2A2635',
    line: '#363142',
    accent: '#FFE45C',
    accentInk: '#1E1A2B',
    success: '#5FD49B',
    danger: '#FF8A80',
    scrim: 'rgba(0, 0, 0, 0.58)',
    shade: 'rgba(0, 0, 0, 0.40)',
    aiMark: 'rgba(255, 228, 92, 0.28)',
    aiChip: 'rgba(255, 228, 92, 0.16)',
    aiChipInk: '#FFE45C',
    userMark: '#F2EFF8',
    mapLand: '#2A2635',
    mapSea: '#1A1722',
    mapRoute: '#FFE45C',
    mapPin: '#F2EFF8',
    mapPinInk: '#15131B',
  },
};

test('both schemes carry exactly the specified tokens', () => {
  assert.deepEqual(palettes.light, expected.light);
  assert.deepEqual(palettes.dark, expected.dark);
  assert.deepEqual(Object.keys(palettes.light).sort(), Object.keys(palettes.dark).sort());
});

function parse(color) {
  if (color.startsWith('#')) {
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(1);
  }

  const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);

  return [r, g, b, a];
}

// Composites a (possibly translucent) color over an opaque base.
function over(color, base) {
  const [r, g, b, a] = parse(color);
  const [br, bg, bb] = parse(base);

  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
}

const textPairs = [
  ...['ink', 'muted', 'faint'].flatMap((fg) => ['paper', 'card', 'soft'].map((bg) => [fg, bg])),
  ['accentInk', 'accent'],
  ['aiChipInk', 'aiChip'],
  ['ink', 'aiMark'],
  ['success', 'card'],
  ['danger', 'card'],
  ['card', 'userMark'],
];

for (const scheme of ['light', 'dark']) {
  test(`text pairs pass WCAG AA in ${scheme}`, () => {
    const p = palettes[scheme];

    for (const [fg, bg] of textPairs) {
      const ratio = contrast(over(p[fg], p.card), over(p[bg], p.card));

      assert.ok(ratio >= 4.5, `${scheme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no mobile file but theme.ts holds a raw color', () => {
  const root = 'apps/mobile/src';
  const raw = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|['"](white|black)['"]/;
  const offenders = sourceFiles(root)
    .filter((path) => relative(root, path) !== join('lib', 'theme.ts'))
    .filter((path) => raw.test(readFileSync(path, 'utf8')));

  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/theme-tokens.test.mjs`
Expected: FAIL with `palettes` undefined (the module exports `colors`).

- [ ] **Step 3: Write the token module**

Replace `apps/mobile/src/lib/theme.ts`:

```ts
/**
 * Nexui's color tokens, one set per color scheme, and the font faces. Components never use raw
 * colors: they read a palette through `useColors()` or `createThemedStyles()` in
 * `use-theme.ts`. `tests/theme-tokens.test.mjs` checks both sets and their contrast.
 */
const light = {
  paper: '#F2F0F6', // screen background
  card: '#FFFFFF', // cards, sheets, tab bar
  ink: '#1E1A2B',
  muted: '#5B5670',
  faint: '#6B6582',
  soft: '#F6F4FA', // steppers, inputs, secondary buttons
  line: '#E4E0EC',
  accent: '#FFE45C', // primary buttons, +, the unallocated metric
  accentInk: '#1E1A2B', // text on accent, in both schemes
  success: '#1D7A52',
  danger: '#B3322C',
  scrim: 'rgba(30, 26, 43, 0.38)',
  shade: 'rgba(30, 26, 43, 0.10)',
  aiMark: '#FFE45C', // highlighter behind text Nexui wrote
  aiChip: '#FFE45C', // "Nexui" tag
  aiChipInk: '#1E1A2B',
  userMark: '#1E1A2B', // "You" avatar, route stop numbers
  mapLand: '#FFFFFF',
  mapSea: '#E3DFED',
  mapRoute: '#1E1A2B',
  mapPin: '#1E1A2B',
  mapPinInk: '#FFFFFF',
} as const;

export type TokenName = keyof typeof light;
export type Palette = Record<TokenName, string>;
export type Scheme = 'light' | 'dark';

const dark: Palette = {
  paper: '#15131B',
  card: '#211E2A',
  ink: '#F2EFF8',
  muted: '#B6B0C6',
  faint: '#A09AB2',
  soft: '#2A2635',
  line: '#363142',
  accent: '#FFE45C',
  accentInk: '#1E1A2B',
  success: '#5FD49B',
  danger: '#FF8A80',
  scrim: 'rgba(0, 0, 0, 0.58)',
  shade: 'rgba(0, 0, 0, 0.40)',
  aiMark: 'rgba(255, 228, 92, 0.28)', // a wash: light text stays readable on it
  aiChip: 'rgba(255, 228, 92, 0.16)',
  aiChipInk: '#FFE45C',
  userMark: '#F2EFF8',
  mapLand: '#2A2635',
  mapSea: '#1A1722',
  mapRoute: '#FFE45C',
  mapPin: '#F2EFF8',
  mapPinInk: '#15131B',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

// Custom faces carry their weight in the family name, so styles omit fontWeight.
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  heading: 'BricolageGrotesque_700Bold',
  input: 'BricolageGrotesque_500Medium',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
} as const;
```

Create `apps/mobile/src/lib/use-theme.ts`:

```ts
import { StyleSheet, useColorScheme } from 'react-native';

import { palettes, type Palette, type Scheme } from './theme';

/** The system color scheme; anything but dark counts as light. */
export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

/** The token set for the current scheme, for colors passed as props. */
export function useColors(): Palette {
  return palettes[useScheme()];
}

/**
 * Builds a hook that returns styles for the current scheme, created once per scheme.
 *
 * @example
 * const useStyles = createThemedStyles((colors) => ({ screen: { backgroundColor: colors.paper } }));
 * function Screen() {
 *   const styles = useStyles();
 * }
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
): () => T {
  const cache: Partial<Record<Scheme, T>> = {};

  return function useThemedStyles(): T {
    const scheme = useScheme();
    const cached = cache[scheme];

    if (cached) {
      return cached;
    }

    const created = StyleSheet.create(factory(palettes[scheme]));

    cache[scheme] = created;

    return created;
  };
}
```

- [ ] **Step 4: Convert every kept screen and component to themed styles**

Apply this rule to each file listed under **Modify**:

1. Replace `import { colors, fonts } from '@/lib/theme';` with
   `import { fonts } from '@/lib/theme';` (drop it entirely if `fonts` is unused) and
   `import { createThemedStyles, useColors } from '@/lib/use-theme';` (import only what the
   file uses).
2. Replace `const styles = StyleSheet.create({ ... });` with
   `const useStyles = createThemedStyles((colors) => ({ ... }));`, keeping the object body
   exactly as it was. Drop `StyleSheet` from the `react-native` import if nothing else uses it.
3. In every component in that file that reads `styles`, add `const styles = useStyles();` as
   its first line. Sub-components (for example `Glyph`, `SearchGlyph`, `GearGlyph`) call
   `useStyles()` themselves.
4. Where a color is passed as a prop outside a stylesheet (`placeholderTextColor`,
   `selectionColor`, `tabBarActiveTintColor`, `ActivityIndicator color`, `contentStyle`,
   `sceneStyle`, and so on), add `const colors = useColors();` in that component and keep the
   same token name.
5. Module-level constants that read colors (for example `composeOptions` in
   `(app)/_layout.tsx`) move inside the component and read from `useColors()`.

For example, `changes.tsx` becomes:

```tsx
import type { ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListEmpty } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { createThemedStyles } from '@/lib/use-theme';

// Placeholder until the Changes feed arrives (intent graph plan 3).
export default function ChangesScreen(): ReactElement {
  const styles = useStyles();

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <TabHeader title="Changes" />
        <ListEmpty text="Every change you or Nexui make will show here, with Undo." />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
}));
```

In `(tabs)/_layout.tsx`, the tints become `tabBarActiveTintColor: colors.ink` and
`tabBarInactiveTintColor: colors.faint`, read from `useColors()`.

In `app/_layout.tsx`, `<StatusBar style="dark" />` becomes `<StatusBar style="auto" />`, and the
root `Stack`'s `contentStyle` reads `useColors().paper`. `useColors()` must be called before
the early `return null`s so hook order stays stable.

If any file contains a literal color (for example `'#fff'` or `'white'` in a shadow), replace
it with the closest token (`colors.card`, `colors.shade`) or remove it if it was a shadow that
the design doesn't use.

- [ ] **Step 5: Follow the system scheme**

In `apps/mobile/app.config.ts`, change `userInterfaceStyle: 'light'` to
`userInterfaceStyle: 'automatic'`. Then install the module Expo needs to apply it on Android:

Run: `pnpm --filter @nexui/mobile exec expo install expo-system-ui`
Expected: `expo-system-ui` appears in `apps/mobile/package.json` dependencies.

- [ ] **Step 6: Run the tests and checks**

Run: `node --experimental-strip-types --test tests/theme-tokens.test.mjs`
Expected: PASS (4 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 7: Check both schemes by eye**

Run: `pnpm dev:web`, open `http://localhost:8081`, and sign in (see `AGENTS.md`, "QA
session"). Check Home, Changes, + and Account in light mode. Then switch the OS or browser to
dark (Chrome DevTools → Rendering → "Emulate CSS prefers-color-scheme: dark") and check them
again. Expected: no white-on-white or black-on-black text, and the tab bar, cards and sheet
switch to the dark tokens. Save screenshots to `.qa/` (gitignored). Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add light and dark theme tokens and follow the system scheme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Graph contracts

**Files:**

- Create: `packages/types/src/primitives.ts`, `packages/types/src/kinds/travel.ts`,
  `packages/types/src/kinds/registry.ts`, `packages/types/src/workspace.ts`,
  `packages/types/src/graph.ts`, `packages/types/src/ops.ts`, `packages/types/src/api.ts`.
- Modify: `packages/types/src/index.ts`.
- Test: `tests/graph-contracts.test.mjs`, `tests/support/graph.mjs`.

**Interfaces:**

- Produces (all from `@nexui/types`):
  - `idSchema`, `timestampSchema`, `relTypeSchema`, `capabilityNameSchema`,
    `insightActionSchema`, `type InsightAction`.
  - `moneySchema`, `type Money`, `currencySchema`, `tripDerivedSchema`, `type TripDerived`, the
    kind schemas `tripDataSchema`, `placeDataSchema`, `legDataSchema`, `stayDataSchema`,
    `decisionDataSchema`, `optionDataSchema`, `insightDataSchema`, `thingDataSchema`, and their
    inferred types `TripData`, `PlaceData`, `LegData`, `StayData`, `DecisionData`,
    `OptionData`, `InsightData`, `ThingData`.
  - `KIND_REGISTRY`, `type KindName`, `kindNameSchema`, `isKindName(value: string)`,
    `parseKindData(kind: string, data: unknown, version?: number): ParsedKindData`.
  - `derivedKeySchema`, `type DerivedKey`, `refSchema`, `graphQuerySchema`,
    `type GraphQuery`, `fieldFilterSchema`, `type FieldFilter`, `sectionSchema`,
    `type Section`, `workspaceDocSchema`, `type WorkspaceDoc`.
  - `actorSchema`, `type Actor`, `intentStatusSchema`, `templateSchema`, `type Template`,
    `objectSourceSchema`, `type ObjectSource`, `intentSummarySchema`,
    `type IntentSummary`, `intentRecordSchema`, `type IntentRecord`, `graphObjectSchema`,
    `type GraphObject`, `relationshipSchema`, `type Relationship`,
    `workspaceRecordSchema`, `type WorkspaceRecord`, `graphSnapshotSchema`,
    `type GraphSnapshot`, `storedOpSchema`, `eventRecordSchema`, `type EventRecord`.
  - `changesetOpSchema`, `type ChangesetOp`, `userOpSchema`, `type UserOp`,
    `fromUserOps(ops: readonly UserOp[]): ChangesetOp[]`.
  - `createIntentRequestSchema`, `intentListItemSchema`, `intentListResponseSchema`,
    `changesetRequestSchema`, `commitResponseSchema`, `type CommitResponse`,
    `changesQuerySchema`, `type ChangesQuery`, `changeItemSchema`, `type ChangeItem`,
    `changesResponseSchema`, `type ChangesResponse`.

- [ ] **Step 1: Write the shared test fixtures**

Create `tests/support/graph.mjs`. The rows match what the Postgres functions return
(`to_jsonb(row)`, snake_case):

```js
export const USER_ID = '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11';
export const INTENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
export const TRIP_ID = 'a1b2c3d4-0000-4000-8000-000000000002';
export const TOKYO_ID = 'a1b2c3d4-0000-4000-8000-000000000003';
export const KYOTO_ID = 'a1b2c3d4-0000-4000-8000-000000000004';
export const TOKYO_REL_ID = 'a1b2c3d4-0000-4000-8000-000000000005';
export const KYOTO_REL_ID = 'a1b2c3d4-0000-4000-8000-000000000006';
export const EVENT_ID = 'a1b2c3d4-0000-4000-8000-000000000007';
export const STAMP = '2026-09-27T12:00:00.123456+00:00';
export const LATER = '2026-09-27T12:05:00.654321+00:00';

/** Deterministic ids for derived objects: b0000000-…-000000000001, …-000000000002, … */
export function idSequence() {
  let n = 0;

  return () => `b0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

export const tripData = {
  destinations: ['Japan'],
  startDate: '2026-12-12',
  endDate: '2026-12-20',
  currency: 'USD',
  derived: {
    totalDays: 8,
    allocatedDays: 8,
    unallocatedDays: 0,
    estCost: null,
    costIncomplete: false,
  },
};
export const tokyoData = {
  name: 'Tokyo',
  country: 'JP',
  placeType: 'city',
  lat: 35.68,
  lng: 139.69,
  days: 4,
};
export const kyotoData = {
  name: 'Kyoto',
  country: 'JP',
  placeType: 'city',
  lat: 35.01,
  lng: 135.77,
  days: 4,
};

export function objectRow(id, kind, data, extra = {}) {
  return {
    id,
    user_id: USER_ID,
    intent_id: INTENT_ID,
    kind,
    kind_version: 1,
    title: null,
    status: null,
    data,
    source: { type: 'user' },
    position: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

export function relationshipRow(id, sourceId, targetId, type = 'part_of') {
  return {
    id,
    user_id: USER_ID,
    intent_id: INTENT_ID,
    source_type: 'object',
    source_id: sourceId,
    target_type: 'object',
    target_id: targetId,
    type,
    metadata: null,
    deleted_at: null,
    created_at: STAMP,
  };
}

export const intentRow = {
  id: INTENT_ID,
  user_id: USER_ID,
  goal: 'Plan Japan in December',
  template: 'travel',
  status: 'exploring',
  context: {},
  summary: {
    line: 'Dec 12 – 20, 8 days, 2 stops',
    badge: { text: 'Every day planned', tone: 'ok' },
    strip: [
      { label: 'Tokyo', ai: false },
      { label: 'Kyoto', ai: false },
    ],
  },
  created_at: STAMP,
  updated_at: STAMP,
  last_activity_at: STAMP,
};

export const tripRow = objectRow(TRIP_ID, 'trip', tripData, { title: 'Plan Japan in December' });
export const tokyoRow = objectRow(TOKYO_ID, 'place', tokyoData, { title: 'Tokyo', position: 1 });
export const kyotoRow = objectRow(KYOTO_ID, 'place', kyotoData, { title: 'Kyoto', position: 2 });

/** What `get_intent_snapshot` returns for the fixture trip. `doc` is the travel template's. */
export function snapshotRow(doc, overrides = {}) {
  return {
    intent: intentRow,
    workspace: { intent_id: INTENT_ID, user_id: USER_ID, version: 1, doc, updated_at: STAMP },
    objects: [tripRow, tokyoRow, kyotoRow],
    relationships: [
      relationshipRow(TOKYO_REL_ID, TOKYO_ID, TRIP_ID),
      relationshipRow(KYOTO_REL_ID, KYOTO_ID, TRIP_ID),
    ],
    ...overrides,
  };
}

/** A logged changeset that shortened Tokyo from 4 to 3 days. */
export const eventRow = {
  id: EVENT_ID,
  user_id: USER_ID,
  intent_id: INTENT_ID,
  seq: 42,
  type: 'changeset',
  actor: 'user',
  run_id: null,
  reverts_event_id: null,
  ops: [
    {
      op: 'update_object',
      table: 'objects',
      id: TOKYO_ID,
      before: tokyoRow,
      after: { ...tokyoRow, data: { ...tokyoData, days: 3 }, updated_at: LATER },
      origin: 'direct',
    },
  ],
  payload: {},
  created_at: LATER,
};
```

- [ ] **Step 2: Write the failing contract tests**

Create `tests/graph-contracts.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changesetRequestSchema,
  fromUserOps,
  graphQuerySchema,
  insightDataSchema,
  parseKindData,
  placeDataSchema,
  tripDataSchema,
  userOpSchema,
  workspaceDocSchema,
} from '../packages/types/src/index.ts';
import { kyotoData, TOKYO_ID, tokyoData, TRIP_ID, tripData } from './support/graph.mjs';

test('the fixture trip and places are valid kind data', () => {
  assert.deepEqual(tripDataSchema.parse(tripData), tripData);
  assert.deepEqual(placeDataSchema.parse(tokyoData), tokyoData);
  assert.deepEqual(placeDataSchema.parse(kyotoData), kyotoData);
});

test('place days must be a whole number from 0 to 365', () => {
  for (const days of [-1, 2.5, 366]) {
    assert.equal(placeDataSchema.safeParse({ ...tokyoData, days }).success, false, `days ${days}`);
  }
});

test('a trip needs both dates or neither, and must end after it starts', () => {
  assert.equal(tripDataSchema.safeParse({ ...tripData, endDate: undefined }).success, false);
  assert.equal(tripDataSchema.safeParse({ ...tripData, endDate: '2026-12-12' }).success, false);
  assert.equal(
    tripDataSchema.safeParse({ destinations: [], currency: 'USD' }).success,
    true,
    'an empty new trip is valid',
  );
});

test('parseKindData rejects unknown kinds and names the bad field', () => {
  assert.deepEqual(parseKindData('spaceship', {}), {
    ok: false,
    message: 'Unknown kind "spaceship".',
  });

  const bad = parseKindData('place', { ...tokyoData, days: -1 });

  assert.equal(bad.ok, false);
  assert.match(bad.message, /^Invalid place: days /);
  assert.deepEqual(parseKindData('place', tokyoData), { ok: true, data: tokyoData, version: 1 });
});

test('insights allow at most two actions of the known types', () => {
  const base = { text: 'You have 1 day unallocated', severity: 'attention', actions: [] };
  const ask = { type: 'ask', label: 'Ask Nexui for ideas', prompt: 'Ideas?' };
  const give = {
    type: 'capability',
    label: 'Give it back to Tokyo',
    name: 'trip.setPlaceDays',
    input: { placeId: TOKYO_ID, days: 4 },
  };

  assert.equal(insightDataSchema.safeParse({ ...base, actions: [ask, give] }).success, true);
  assert.equal(insightDataSchema.safeParse({ ...base, actions: [ask, give, ask] }).success, false);
  assert.equal(
    insightDataSchema.safeParse({ ...base, actions: [{ ...give, name: 'rm -rf' }] }).success,
    false,
  );
});

test('graph queries accept registered kinds and data paths only', () => {
  const query = {
    from: 'objects',
    kind: 'place',
    related: { type: 'part_of', to: { objectId: TRIP_ID }, direction: 'out' },
    where: [{ field: 'data.days', op: 'gt', value: 0 }],
    sort: 'position',
  };

  assert.deepEqual(graphQuerySchema.parse(query), query);
  assert.equal(graphQuerySchema.safeParse({ ...query, kind: 'spaceship' }).success, false);
  assert.equal(
    graphQuerySchema.safeParse({ ...query, where: [{ field: 'user_id', op: 'eq', value: 1 }] })
      .success,
    false,
  );
});

test('workspace docs need unique section ids', () => {
  const section = {
    id: 'route',
    type: 'objectList',
    query: { from: 'object', id: TRIP_ID },
    card: 'compact',
  };
  const doc = { version: 1, anchorId: TRIP_ID, sections: [section] };

  assert.equal(workspaceDocSchema.safeParse(doc).success, true);
  assert.equal(
    workspaceDocSchema.safeParse({ ...doc, sections: [section, section] }).success,
    false,
  );
});

test('user ops cannot carry server-owned fields', () => {
  const update = { op: 'update_object', id: TOKYO_ID, patch: { data: { ...tokyoData, days: 3 } } };

  assert.equal(userOpSchema.safeParse(update).success, true);
  assert.equal(userOpSchema.safeParse({ ...update, origin: 'derived' }).success, false);
  assert.equal(
    userOpSchema.safeParse({ ...update, patch: { source: { type: 'ai' } } }).success,
    false,
  );
  assert.equal(
    userOpSchema.safeParse({ op: 'update_intent', patch: { status: 'active' } }).success,
    false,
  );
  assert.equal(userOpSchema.safeParse({ op: 'set_workspace', doc: {} }).success, false);
  assert.equal(changesetRequestSchema.safeParse({ ops: [] }).success, false);
});

test('fromUserOps marks ops direct and user-sourced with the kind version', () => {
  const insert = {
    op: 'insert_object',
    id: TOKYO_ID,
    kind: 'place',
    title: 'Tokyo',
    data: tokyoData,
  };

  assert.deepEqual(fromUserOps([insert]), [
    {
      op: 'insert_object',
      id: TOKYO_ID,
      kind: 'place',
      kindVersion: 1,
      title: 'Tokyo',
      status: null,
      data: tokyoData,
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
  ]);
  assert.deepEqual(fromUserOps([{ op: 'delete_object', id: TOKYO_ID }]), [
    { op: 'delete_object', id: TOKYO_ID, origin: 'direct' },
  ]);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/graph-contracts.test.mjs`
Expected: FAIL with `does not provide an export named 'changesetRequestSchema'`.

- [ ] **Step 4: Write `primitives.ts`**

```ts
import { z } from 'zod';

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });

/** Relationship types: part_of, option_of, leg_from, leg_to … */
export const relTypeSchema = z.string().regex(/^[a-z][a-z_]{0,39}$/);

/** Capability names such as `trip.setPlaceDays`. */
export const capabilityNameSchema = z
  .string()
  .max(60)
  .regex(/^[a-z]+(\.[a-zA-Z]+)+$/);

// Buttons an insight offers. They never carry model output as code: `ask` opens the + sheet
// prefilled, and `capability` names one registered, validated call.
export const insightActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ask'),
    label: z.string().min(1).max(40),
    prompt: z.string().min(1).max(300),
  }),
  z.strictObject({
    type: z.literal('capability'),
    label: z.string().min(1).max(40),
    name: capabilityNameSchema,
    input: z.record(z.string(), z.json()),
  }),
]);

export type InsightAction = z.infer<typeof insightActionSchema>;
```

- [ ] **Step 5: Write `kinds/travel.ts`**

```ts
import { z } from 'zod';

import { idSchema, insightActionSchema } from '../primitives.ts';

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const moneySchema = z.strictObject({
  amount: z.number().min(0).max(1_000_000_000),
  currency: currencySchema,
});

export type Money = z.infer<typeof moneySchema>;

const isoDateSchema = z.iso.date();

/** The trip's calculated figures, written only by `derive.trip` (spec section D). */
export const tripDerivedSchema = z.strictObject({
  totalDays: z.number().int().nullable(),
  allocatedDays: z.number().int(),
  unallocatedDays: z.number().int().nullable(),
  estCost: moneySchema.nullable(),
  costIncomplete: z.boolean(),
});

export type TripDerived = z.infer<typeof tripDerivedSchema>;

export const tripDataSchema = z
  .strictObject({
    destinations: z.array(z.string().trim().min(1).max(100)).max(30),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    totalDays: z.number().int().min(1).max(365).optional(),
    travelers: z.number().int().min(1).max(50).optional(),
    budget: moneySchema.optional(),
    pace: z.enum(['slow', 'balanced', 'fast']).optional(),
    currency: currencySchema,
    derived: tripDerivedSchema.optional(),
  })
  .refine((trip) => !trip.startDate === !trip.endDate, {
    message: 'Give both dates or neither',
    path: ['endDate'],
  })
  .refine((trip) => !trip.startDate || !trip.endDate || trip.startDate < trip.endDate, {
    message: 'The trip must end after it starts',
    path: ['endDate'],
  });

export const placeDataSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  country: z.string().regex(/^[A-Z]{2}$/),
  placeType: z.enum(['city', 'region', 'town', 'area', 'site']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  days: z.number().int().min(0).max(365),
  estDailyCost: moneySchema.optional(),
  why: z.string().max(500).optional(),
});

export const legDataSchema = z.strictObject({
  mode: z.enum(['flight', 'train', 'bus', 'car', 'ferry', 'other']),
  estHours: z.number().min(0).max(200).optional(),
  estCost: moneySchema.optional(),
});

export const stayDataSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  placeId: idSchema,
  nights: z.number().int().min(1).max(365),
  estNightly: moneySchema.optional(),
  url: z.url().max(2000).optional(),
});

export const decisionDataSchema = z.strictObject({
  question: z.string().trim().min(1).max(200),
  status: z.enum(['open', 'resolved', 'dismissed']),
  chosenOptionId: idSchema.optional(),
  tradeoff: z.string().max(400).optional(),
  derivedKey: z.string().max(60).optional(),
});

export const optionDataSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  placeId: idSchema.optional(),
  summary: z.string().max(400),
  pros: z.array(z.string().max(120)).max(8),
  cons: z.array(z.string().max(120)).max(8),
  metrics: z.record(z.string().max(40), z.number()),
  fit: z.string().max(120).optional(),
});

export const insightDataSchema = z.strictObject({
  text: z.string().trim().min(1).max(160),
  detail: z.string().max(300).optional(),
  severity: z.enum(['info', 'attention']),
  derivedKey: z.string().max(60).optional(),
  actions: z.array(insightActionSchema).max(2),
});

export const thingDataSchema = z.strictObject({
  fields: z
    .array(z.strictObject({ label: z.string().min(1).max(60), value: z.string().max(500) }))
    .max(30),
});

export type TripData = z.infer<typeof tripDataSchema>;
export type PlaceData = z.infer<typeof placeDataSchema>;
export type LegData = z.infer<typeof legDataSchema>;
export type StayData = z.infer<typeof stayDataSchema>;
export type DecisionData = z.infer<typeof decisionDataSchema>;
export type OptionData = z.infer<typeof optionDataSchema>;
export type InsightData = z.infer<typeof insightDataSchema>;
export type ThingData = z.infer<typeof thingDataSchema>;
```

- [ ] **Step 6: Write `kinds/registry.ts`**

```ts
import { z } from 'zod';

import {
  decisionDataSchema,
  insightDataSchema,
  legDataSchema,
  optionDataSchema,
  placeDataSchema,
  stayDataSchema,
  thingDataSchema,
  tripDataSchema,
} from './travel.ts';

/** A registered object kind: its current version, schema, and how to upgrade older data. */
export interface KindDefinition {
  version: number;
  schema: z.ZodType;
  upgrade: (data: unknown, fromVersion: number) => unknown;
}

const unchanged = (data: unknown): unknown => data;

// Adding a kind means adding it here; the database needs no migration (spec section C).
export const KIND_REGISTRY = {
  trip: { version: 1, schema: tripDataSchema, upgrade: unchanged },
  place: { version: 1, schema: placeDataSchema, upgrade: unchanged },
  leg: { version: 1, schema: legDataSchema, upgrade: unchanged },
  stay: { version: 1, schema: stayDataSchema, upgrade: unchanged },
  decision: { version: 1, schema: decisionDataSchema, upgrade: unchanged },
  option: { version: 1, schema: optionDataSchema, upgrade: unchanged },
  insight: { version: 1, schema: insightDataSchema, upgrade: unchanged },
  thing: { version: 1, schema: thingDataSchema, upgrade: unchanged },
} satisfies Record<string, KindDefinition>;

export type KindName = keyof typeof KIND_REGISTRY;

export const kindNameSchema = z.enum(Object.keys(KIND_REGISTRY) as [KindName, ...KindName[]]);

export function isKindName(value: string): value is KindName {
  return Object.hasOwn(KIND_REGISTRY, value);
}

export type ParsedKindData =
  { ok: true; data: Record<string, unknown>; version: number } | { ok: false; message: string };

/**
 * Validates an object's `data` for its kind, upgrading older versions first.
 *
 * @example
 * parseKindData('place', { name: 'Tokyo', days: -1 }) // { ok: false, message: 'Invalid place: days …' }
 */
export function parseKindData(kind: string, data: unknown, version?: number): ParsedKindData {
  if (!isKindName(kind)) {
    return { ok: false, message: `Unknown kind "${kind}".` };
  }

  const definition: KindDefinition = KIND_REGISTRY[kind];
  const upgraded =
    version !== undefined && version < definition.version
      ? definition.upgrade(data, version)
      : data;
  const parsed = definition.schema.safeParse(upgraded);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'data';

    return { ok: false, message: `Invalid ${kind}: ${field} ${issue?.message ?? 'is invalid'}` };
  }

  return { ok: true, data: parsed.data as Record<string, unknown>, version: definition.version };
}
```

- [ ] **Step 7: Write `workspace.ts`**

```ts
import { z } from 'zod';

import { kindNameSchema } from './kinds/registry.ts';
import { idSchema, relTypeSchema } from './primitives.ts';

/** Figures a metric or allocation reads from the anchor object's `data.derived`. */
export const derivedKeySchema = z.enum(['trip.totalDays', 'trip.unallocatedDays', 'trip.estCost']);

export type DerivedKey = z.infer<typeof derivedKeySchema>;

// Top-level columns, or one key inside `data`.
const fieldPathSchema = z
  .string()
  .regex(/^(title|status|position|createdAt|updatedAt|data\.[A-Za-z][A-Za-z0-9]{0,39})$/);

export const refSchema = z.union([z.literal('intent'), z.strictObject({ objectId: idSchema })]);

export const fieldFilterSchema = z.strictObject({
  field: fieldPathSchema,
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.json(),
});

export type FieldFilter = z.infer<typeof fieldFilterSchema>;

export const graphQuerySchema = z.discriminatedUnion('from', [
  z.strictObject({
    from: z.literal('objects'),
    kind: z.union([kindNameSchema, z.array(kindNameSchema).min(1).max(8)]).optional(),
    related: z
      .strictObject({ type: relTypeSchema, to: refSchema, direction: z.enum(['out', 'in']) })
      .optional(),
    where: z.array(fieldFilterSchema).max(8).optional(),
    sort: z
      .union([
        z.literal('position'),
        z.strictObject({ field: fieldPathSchema, dir: z.enum(['asc', 'desc']) }),
      ])
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  z.strictObject({ from: z.literal('object'), id: idSchema }),
]);

export type GraphQuery = z.infer<typeof graphQuerySchema>;

const sectionBase = {
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  title: z.string().max(60).optional(),
  collapsed: z.boolean().optional(),
  // Lifted into the Open band while unresolved (spec section D).
  pin: z.literal('open').optional(),
};

const fieldSpecSchema = z.strictObject({
  field: fieldPathSchema,
  label: z.string().min(1).max(30),
  format: z.enum(['currency', 'days', 'hours', 'text']).optional(),
});

const metricSpecSchema = z.strictObject({
  label: z.string().min(1).max(30),
  derived: derivedKeySchema,
  format: z.enum(['days', 'currency', 'count']),
  emphasis: z.literal('whenPositive').optional(),
});

export const sectionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...sectionBase,
    type: z.literal('map'),
    places: graphQuerySchema,
    legs: graphQuerySchema.optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('route'),
    query: graphQuerySchema,
    editable: z.array(z.enum(['days', 'order'])).max(2),
    showUnallocated: z.boolean().optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('metric'),
    metrics: z.array(metricSpecSchema).min(1).max(4),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('allocation'),
    parts: graphQuerySchema,
    valueField: fieldPathSchema,
    labelField: fieldPathSchema,
    total: derivedKeySchema,
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('objectList'),
    query: graphQuerySchema,
    card: z.enum(['compact', 'rich']),
    empty: z.string().max(120).optional(),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('comparison'),
    query: graphQuerySchema,
    fields: z.array(fieldSpecSchema).min(1).max(6),
  }),
  z.strictObject({
    ...sectionBase,
    type: z.literal('decision'),
    decisionId: idSchema,
    fields: z.array(fieldSpecSchema).max(6),
  }),
  z.strictObject({ ...sectionBase, type: z.literal('insight'), query: graphQuerySchema }),
]);

export type Section = z.infer<typeof sectionSchema>;

// `version` is the doc format (1); the `workspaces.version` column counts revisions.
export const workspaceDocSchema = z
  .strictObject({
    version: z.literal(1),
    anchorId: idSchema,
    sections: z.array(sectionSchema).max(30),
  })
  .refine((doc) => new Set(doc.sections.map((s) => s.id)).size === doc.sections.length, {
    message: 'Section ids must be unique',
    path: ['sections'],
  });

export type WorkspaceDoc = z.infer<typeof workspaceDocSchema>;
```

- [ ] **Step 8: Write `graph.ts`**

```ts
import { z } from 'zod';

import { idSchema, relTypeSchema, timestampSchema } from './primitives.ts';
import { workspaceDocSchema } from './workspace.ts';

export const actorSchema = z.enum(['user', 'derived', 'ai', 'system']);

export type Actor = z.infer<typeof actorSchema>;

export const intentStatusSchema = z.enum([
  'exploring',
  'active',
  'blocked',
  'completed',
  'archived',
]);
export const templateSchema = z.enum(['travel', 'job_search']);

export type Template = z.infer<typeof templateSchema>;

/** Who created an object. `reviewedAt` is set when the user edits something Nexui wrote. */
export const objectSourceSchema = z.strictObject({
  type: z.enum(['user', 'ai', 'derived', 'external']),
  runId: idSchema.optional(),
  url: z.url().max(2000).optional(),
  reviewedAt: timestampSchema.optional(),
});

export type ObjectSource = z.infer<typeof objectSourceSchema>;

/** Drives a Home card; rebuilt by the template's derivation after every changeset. */
export const intentSummarySchema = z.strictObject({
  line: z.string().max(200),
  badge: z
    .strictObject({
      text: z.string().min(1).max(60),
      tone: z.enum(['attention', 'ok', 'running']),
    })
    .optional(),
  strip: z
    .array(z.strictObject({ label: z.string().min(1).max(100), ai: z.boolean() }))
    .max(12)
    .optional(),
});

export type IntentSummary = z.infer<typeof intentSummarySchema>;

export const intentRecordSchema = z.object({
  id: idSchema,
  goal: z.string(),
  template: templateSchema.nullable(),
  status: intentStatusSchema,
  context: z.record(z.string(), z.unknown()),
  summary: intentSummarySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastActivityAt: timestampSchema,
});

export type IntentRecord = z.infer<typeof intentRecordSchema>;

export const graphObjectSchema = z.object({
  id: idSchema,
  intentId: idSchema,
  kind: z.string(),
  kindVersion: z.number().int().min(1),
  title: z.string().nullable(),
  status: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  source: objectSourceSchema.nullable(),
  position: z.number().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type GraphObject = z.infer<typeof graphObjectSchema>;

export const endpointTypeSchema = z.enum(['object', 'intent']);

export const relationshipSchema = z.object({
  id: idSchema,
  intentId: idSchema,
  sourceType: endpointTypeSchema,
  sourceId: idSchema,
  targetType: endpointTypeSchema,
  targetId: idSchema,
  type: relTypeSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestampSchema,
});

export type Relationship = z.infer<typeof relationshipSchema>;

export const workspaceRecordSchema = z.object({
  intentId: idSchema,
  version: z.number().int().min(1),
  doc: workspaceDocSchema,
  updatedAt: timestampSchema,
});

export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

/** One intent with its workspace and every live object and relationship. */
export const graphSnapshotSchema = z.object({
  intent: intentRecordSchema,
  workspace: workspaceRecordSchema.nullable(),
  objects: z.array(graphObjectSchema),
  relationships: z.array(relationshipSchema),
});

export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;

export const originSchema = z.enum(['direct', 'derived']);

/** One row change as the database logged it; `before`/`after` are raw snake_case rows. */
export const storedOpSchema = z.object({
  op: z.string(),
  table: z.enum(['objects', 'relationships', 'workspaces', 'intents']),
  id: idSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  origin: originSchema,
});

export const eventRecordSchema = z.object({
  id: idSchema,
  intentId: idSchema.nullable(),
  seq: z.number().int(),
  type: z.string(),
  actor: actorSchema,
  runId: idSchema.nullable(),
  revertsEventId: idSchema.nullable(),
  ops: z.array(storedOpSchema).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});

export type EventRecord = z.infer<typeof eventRecordSchema>;
```

- [ ] **Step 9: Write `ops.ts`**

```ts
import { z } from 'zod';

import {
  intentStatusSchema,
  intentSummarySchema,
  objectSourceSchema,
  originSchema,
  endpointTypeSchema,
} from './graph.ts';
import { KIND_REGISTRY, isKindName } from './kinds/registry.ts';
import { idSchema, relTypeSchema, timestampSchema } from './primitives.ts';
import { workspaceDocSchema } from './workspace.ts';

const hasKeys = (patch: object): boolean => Object.keys(patch).length > 0;

const titleSchema = z.string().trim().min(1).max(200).nullable();
const statusSchema = z.string().min(1).max(40).nullable();
const dataSchema = z.record(z.string(), z.unknown());
const positionSchema = z.number().nullable();
const metadataSchema = z.record(z.string(), z.unknown()).nullable();
const kindSchema = z.string().regex(/^[a-z_]{1,40}$/);

const relationshipFields = {
  id: idSchema,
  sourceType: endpointTypeSchema,
  sourceId: idSchema,
  targetType: endpointTypeSchema,
  targetId: idSchema,
  type: relTypeSchema,
};

/** Every change the graph accepts. Only the API builds these; clients send `UserOp`s. */
export const changesetOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('insert_object'),
    id: idSchema,
    kind: kindSchema,
    kindVersion: z.number().int().min(1),
    title: titleSchema,
    status: statusSchema,
    data: dataSchema,
    source: objectSourceSchema,
    position: positionSchema,
    origin: originSchema,
  }),
  z.strictObject({
    op: z.literal('update_object'),
    id: idSchema,
    expectedUpdatedAt: timestampSchema.optional(),
    patch: z
      .strictObject({
        title: titleSchema.optional(),
        status: statusSchema.optional(),
        data: dataSchema.optional(),
        source: objectSourceSchema.optional(),
        position: positionSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
    origin: originSchema,
  }),
  z.strictObject({ op: z.literal('delete_object'), id: idSchema, origin: originSchema }),
  z.strictObject({
    op: z.literal('insert_relationship'),
    ...relationshipFields,
    metadata: metadataSchema,
    origin: originSchema,
  }),
  z.strictObject({ op: z.literal('delete_relationship'), id: idSchema, origin: originSchema }),
  z.strictObject({ op: z.literal('set_workspace'), doc: workspaceDocSchema, origin: originSchema }),
  z.strictObject({
    op: z.literal('update_intent'),
    patch: z
      .strictObject({
        status: intentStatusSchema.optional(),
        summary: intentSummarySchema.optional(),
        context: dataSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
    origin: originSchema,
  }),
]);

export type ChangesetOp = z.infer<typeof changesetOpSchema>;

/** What a client may send: object and relationship edits, never provenance or layout. */
export const userOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('insert_object'),
    id: idSchema,
    kind: kindSchema,
    title: titleSchema.optional(),
    status: statusSchema.optional(),
    data: dataSchema,
    position: positionSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('update_object'),
    id: idSchema,
    expectedUpdatedAt: timestampSchema.optional(),
    patch: z
      .strictObject({
        title: titleSchema.optional(),
        status: statusSchema.optional(),
        data: dataSchema.optional(),
        position: positionSchema.optional(),
      })
      .refine(hasKeys, 'Nothing to update.'),
  }),
  z.strictObject({ op: z.literal('delete_object'), id: idSchema }),
  z.strictObject({
    op: z.literal('insert_relationship'),
    ...relationshipFields,
    metadata: metadataSchema.optional(),
  }),
  z.strictObject({ op: z.literal('delete_relationship'), id: idSchema }),
]);

export type UserOp = z.infer<typeof userOpSchema>;

/** Turns a client's ops into changeset ops: user-sourced, `direct`, current kind version. */
export function fromUserOps(ops: readonly UserOp[]): ChangesetOp[] {
  return ops.map((op): ChangesetOp => {
    switch (op.op) {
      case 'insert_object':
        return {
          op: 'insert_object',
          id: op.id,
          kind: op.kind,
          kindVersion: isKindName(op.kind) ? KIND_REGISTRY[op.kind].version : 1,
          title: op.title ?? null,
          status: op.status ?? null,
          data: op.data,
          source: { type: 'user' },
          position: op.position ?? null,
          origin: 'direct',
        };
      case 'insert_relationship':
        return { ...op, metadata: op.metadata ?? null, origin: 'direct' };
      default:
        return { ...op, origin: 'direct' };
    }
  });
}
```

- [ ] **Step 10: Write `api.ts` and the index**

`packages/types/src/api.ts`:

```ts
import { z } from 'zod';

import {
  eventRecordSchema,
  graphSnapshotSchema,
  intentStatusSchema,
  intentSummarySchema,
  templateSchema,
} from './graph.ts';
import { userOpSchema } from './ops.ts';
import { idSchema, timestampSchema } from './primitives.ts';

// POST /api/intents
export const createIntentRequestSchema = z.object({ goal: z.string().trim().min(3).max(500) });

// GET /api/intents: Home's cards, most recently active first.
export const intentListItemSchema = z.object({
  id: idSchema,
  goal: z.string(),
  template: templateSchema.nullable(),
  status: intentStatusSchema,
  summary: intentSummarySchema,
  lastActivityAt: timestampSchema,
});

export const intentListResponseSchema = z.object({ items: z.array(intentListItemSchema) });

export type IntentListItem = z.infer<typeof intentListItemSchema>;

// POST /api/intents/:id/changesets
export const changesetRequestSchema = z.object({ ops: z.array(userOpSchema).min(1).max(50) });

// Changesets and Undo answer with the logged event and the intent as it now is.
export const commitResponseSchema = z.object({
  event: eventRecordSchema,
  snapshot: graphSnapshotSchema,
});

export type CommitResponse = z.infer<typeof commitResponseSchema>;

// GET /api/changes: newest first; `cursor` is the last item's `seq`.
export const changesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  intentId: idSchema.optional(),
});

export type ChangesQuery = z.infer<typeof changesQuerySchema>;

export const changeItemSchema = eventRecordSchema.extend({
  intentGoal: z.string().nullable(),
  revertedByEventId: idSchema.nullable(),
});

export type ChangeItem = z.infer<typeof changeItemSchema>;

export const changesResponseSchema = z.object({
  items: z.array(changeItemSchema),
  nextCursor: z.string().nullable(),
});

export type ChangesResponse = z.infer<typeof changesResponseSchema>;
```

`packages/types/src/index.ts`:

```ts
export * from './auth.ts';
export * from './primitives.ts';
export * from './kinds/travel.ts';
export * from './kinds/registry.ts';
export * from './workspace.ts';
export * from './graph.ts';
export * from './ops.ts';
export * from './api.ts';
```

- [ ] **Step 11: Run the tests**

Run: `node --experimental-strip-types --test tests/graph-contracts.test.mjs`
Expected: PASS (9 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add packages/types tests/graph-contracts.test.mjs tests/support/graph.mjs
git commit -m "Add intent graph contracts: kinds, workspace doc, ops and API shapes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Graph queries and applying ops

**Files:**

- Create: `packages/types/src/query.ts`, `packages/types/src/apply-ops.ts`.
- Create: `apps/api/src/lib/graph/mappers.ts` (the tests need snapshots in contract shape).
- Modify: `packages/types/src/index.ts`.
- Test: `tests/graph-query.test.mjs`, `tests/apply-ops.test.mjs`.

**Interfaces:**

- Consumes: `GraphSnapshot`, `GraphObject`, `GraphQuery`, `FieldFilter`, `ChangesetOp` (Task 3).
- Produces: `readField(object: GraphObject, field: string): unknown`,
  `evaluateQuery(snapshot: GraphSnapshot, query: GraphQuery): GraphObject[]`,
  `class GraphOpError extends Error`,
  `applyOps(snapshot: GraphSnapshot, ops: readonly ChangesetOp[], now: string): GraphSnapshot`
  from `@nexui/types`. From `apps/api/src/lib/graph/mappers.ts`:
  `mapSnapshotRow(row: unknown): GraphSnapshot`, `mapEventRow(row: unknown): EventRecord`,
  `mapChangeRow(row: unknown): ChangeItem`, `mapIntentListRow(row: unknown): IntentListItem`.

- [ ] **Step 1: Write the mappers (used by the tests from here on)**

`apps/api/src/lib/graph/mappers.ts`:

```ts
import {
  changeItemSchema,
  eventRecordSchema,
  graphSnapshotSchema,
  intentListItemSchema,
  type ChangeItem,
  type EventRecord,
  type GraphSnapshot,
  type IntentListItem,
} from '@nexui/types';

// Rows arrive from Postgres functions as `to_jsonb(row)`: snake_case columns.
type Row = Record<string, unknown>;

function mapIntent(row: Row): Row {
  return {
    id: row.id,
    goal: row.goal,
    template: row.template,
    status: row.status,
    context: row.context,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

function mapObject(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    kind: row.kind,
    kindVersion: row.kind_version,
    title: row.title,
    status: row.status,
    data: row.data,
    source: row.source,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    type: row.type,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/** `get_intent_snapshot`'s result in contract shape. */
export function mapSnapshotRow(row: unknown): GraphSnapshot {
  const snapshot = row as {
    intent: Row;
    workspace: Row | null;
    objects: Row[];
    relationships: Row[];
  };
  const workspace = snapshot.workspace;

  return graphSnapshotSchema.parse({
    intent: mapIntent(snapshot.intent),
    workspace: workspace
      ? {
          intentId: workspace.intent_id,
          version: workspace.version,
          doc: workspace.doc,
          updatedAt: workspace.updated_at,
        }
      : null,
    objects: snapshot.objects.map(mapObject),
    relationships: snapshot.relationships.map(mapRelationship),
  });
}

function eventFields(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    seq: row.seq,
    type: row.type,
    actor: row.actor,
    runId: row.run_id,
    revertsEventId: row.reverts_event_id,
    ops: row.ops,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

/** One `events` row. */
export function mapEventRow(row: unknown): EventRecord {
  return eventRecordSchema.parse(eventFields(row as Row));
}

/** One `changes_page` item: an event plus its intent's goal and any Undo that reverted it. */
export function mapChangeRow(row: unknown): ChangeItem {
  const change = row as Row;

  return changeItemSchema.parse({
    ...eventFields(change),
    intentGoal: change.intent_goal ?? null,
    revertedByEventId: change.reverted_by_event_id ?? null,
  });
}

/** One row of the Home list query. */
export function mapIntentListRow(row: unknown): IntentListItem {
  const intent = row as Row;

  return intentListItemSchema.parse({
    id: intent.id,
    goal: intent.goal,
    template: intent.template,
    status: intent.status,
    summary: intent.summary,
    lastActivityAt: intent.last_activity_at,
  });
}
```

- [ ] **Step 2: Write the failing query test**

`tests/graph-query.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { evaluateQuery, readField } from '../packages/types/src/index.ts';
import {
  INTENT_ID,
  KYOTO_ID,
  objectRow,
  relationshipRow,
  snapshotRow,
  TOKYO_ID,
  TRIP_ID,
} from './support/graph.mjs';

const doc = {
  version: 1,
  anchorId: TRIP_ID,
  sections: [],
};
const osakaId = 'a1b2c3d4-0000-4000-8000-0000000000aa';
const snapshot = mapSnapshotRow(
  snapshotRow(doc, {
    objects: [
      ...snapshotRow(doc).objects,
      // Not part of the trip: no relationship.
      objectRow(osakaId, 'place', {
        name: 'Osaka',
        country: 'JP',
        placeType: 'city',
        lat: 34.69,
        lng: 135.5,
        days: 2,
      }),
    ],
  }),
);
const tripPlaces = {
  from: 'objects',
  kind: 'place',
  related: { type: 'part_of', to: { objectId: TRIP_ID }, direction: 'out' },
  sort: 'position',
};

test('related places come back in position order', () => {
  assert.deepEqual(
    evaluateQuery(snapshot, tripPlaces).map((o) => o.id),
    [TOKYO_ID, KYOTO_ID],
  );
});

test('kind alone finds every place, related or not', () => {
  assert.equal(evaluateQuery(snapshot, { from: 'objects', kind: 'place' }).length, 3);
});

test('where filters compare data fields', () => {
  const withSmall = {
    ...tripPlaces,
    related: undefined,
    where: [{ field: 'data.days', op: 'lt', value: 3 }],
  };

  assert.deepEqual(
    evaluateQuery(snapshot, withSmall).map((o) => o.id),
    [osakaId],
  );
  assert.deepEqual(
    evaluateQuery(snapshot, {
      from: 'objects',
      where: [{ field: 'data.name', op: 'in', value: ['Kyoto', 'Osaka'] }],
    })
      .map((o) => o.id)
      .sort(),
    [KYOTO_ID, osakaId].sort(),
  );
});

test('sort by a field descending, then limit', () => {
  const byName = {
    from: 'objects',
    kind: 'place',
    sort: { field: 'data.name', dir: 'desc' },
    limit: 2,
  };

  assert.deepEqual(
    evaluateQuery(snapshot, byName).map((o) => o.data.name),
    ['Tokyo', 'Osaka'],
  );
});

test('the in direction follows relationships into an object', () => {
  const partsOfTrip = {
    from: 'objects',
    kind: 'trip',
    related: { type: 'part_of', to: { objectId: TOKYO_ID }, direction: 'in' },
  };

  assert.deepEqual(
    evaluateQuery(snapshot, partsOfTrip).map((o) => o.id),
    [TRIP_ID],
  );
});

test('a relationship to the intent matches the intent ref', () => {
  const withIntentEdge = mapSnapshotRow(
    snapshotRow(doc, {
      relationships: [
        {
          ...relationshipRow(
            'a1b2c3d4-0000-4000-8000-0000000000bb',
            TRIP_ID,
            INTENT_ID,
            'anchor_of',
          ),
          target_type: 'intent',
        },
      ],
    }),
  );

  assert.deepEqual(
    evaluateQuery(withIntentEdge, {
      from: 'objects',
      related: { type: 'anchor_of', to: 'intent', direction: 'out' },
    }).map((o) => o.id),
    [TRIP_ID],
  );
});

test('object queries find one object or none', () => {
  assert.deepEqual(
    evaluateQuery(snapshot, { from: 'object', id: KYOTO_ID }).map((o) => o.id),
    [KYOTO_ID],
  );
  assert.deepEqual(
    evaluateQuery(snapshot, { from: 'object', id: osakaId.replace('aa', 'cc') }),
    [],
  );
});

test('readField reads columns and data keys only', () => {
  const tokyo = snapshot.objects.find((o) => o.id === TOKYO_ID);

  assert.equal(readField(tokyo, 'title'), 'Tokyo');
  assert.equal(readField(tokyo, 'data.days'), 4);
  assert.equal(readField(tokyo, 'intentId'), undefined);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/graph-query.test.mjs`
Expected: FAIL with `does not provide an export named 'evaluateQuery'`.

- [ ] **Step 4: Write `query.ts`**

```ts
import type { GraphObject, GraphSnapshot } from './graph.ts';
import type { FieldFilter, GraphQuery } from './workspace.ts';

/** Reads a query field path: a column (`title`, `status` …) or `data.<key>`. */
export function readField(object: GraphObject, field: string): unknown {
  if (field.startsWith('data.')) {
    return object.data[field.slice(5)];
  }

  switch (field) {
    case 'title':
      return object.title;
    case 'status':
      return object.status;
    case 'position':
      return object.position;
    case 'createdAt':
      return object.createdAt;
    case 'updatedAt':
      return object.updatedAt;
    default:
      return undefined;
  }
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  return null;
}

function matches(object: GraphObject, filter: FieldFilter): boolean {
  const value = readField(object, filter.field);

  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'neq':
      return value !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.some((item) => item === value);
    default: {
      const order = compare(value, filter.value);

      if (order === null) {
        return false;
      }

      switch (filter.op) {
        case 'gt':
          return order > 0;
        case 'gte':
          return order >= 0;
        case 'lt':
          return order < 0;
        case 'lte':
          return order <= 0;
      }
    }
  }
}

type Related = NonNullable<Extract<GraphQuery, { from: 'objects' }>['related']>;

function isRelated(snapshot: GraphSnapshot, object: GraphObject, related: Related): boolean {
  const target =
    related.to === 'intent'
      ? { type: 'intent', id: snapshot.intent.id }
      : { type: 'object', id: related.to.objectId };

  return snapshot.relationships.some((edge) => {
    if (edge.type !== related.type) {
      return false;
    }

    if (related.direction === 'out') {
      return (
        edge.sourceType === 'object' &&
        edge.sourceId === object.id &&
        edge.targetType === target.type &&
        edge.targetId === target.id
      );
    }

    return (
      edge.targetType === 'object' &&
      edge.targetId === object.id &&
      edge.sourceType === target.type &&
      edge.sourceId === target.id
    );
  });
}

// Nulls sort last in both directions.
function byField(field: string, dir: 'asc' | 'desc') {
  return (a: GraphObject, b: GraphObject): number => {
    const left = readField(a, field);
    const right = readField(b, field);

    if (left == null || right == null) {
      return left == null ? (right == null ? 0 : 1) : -1;
    }

    const order = compare(left, right) ?? 0;

    return dir === 'asc' ? order : -order;
  };
}

function byPosition(a: GraphObject, b: GraphObject): number {
  return byField('position', 'asc')(a, b) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Runs a workspace section's query against a snapshot. The API and the mobile renderer both
 * use it, so a section shows the same objects on both sides.
 *
 * @example
 * evaluateQuery(snapshot, { from: 'objects', kind: 'place', sort: 'position' })
 */
export function evaluateQuery(snapshot: GraphSnapshot, query: GraphQuery): GraphObject[] {
  if (query.from === 'object') {
    return snapshot.objects.filter((object) => object.id === query.id);
  }

  const kinds = query.kind === undefined ? null : ([] as string[]).concat(query.kind);
  let rows = snapshot.objects.filter((object) => !kinds || kinds.includes(object.kind));

  if (query.related) {
    const related = query.related;

    rows = rows.filter((object) => isRelated(snapshot, object, related));
  }

  for (const filter of query.where ?? []) {
    rows = rows.filter((object) => matches(object, filter));
  }

  if (query.sort === 'position') {
    rows = [...rows].sort(byPosition);
  } else if (query.sort) {
    rows = [...rows].sort(byField(query.sort.field, query.sort.dir));
  }

  return query.limit === undefined ? rows : rows.slice(0, query.limit);
}
```

- [ ] **Step 5: Write the failing apply-ops test**

`tests/apply-ops.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { applyOps, GraphOpError } from '../packages/types/src/index.ts';
import {
  INTENT_ID,
  LATER,
  snapshotRow,
  TOKYO_ID,
  TOKYO_REL_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';

const doc = { version: 1, anchorId: TRIP_ID, sections: [] };
const snapshot = mapSnapshotRow(snapshotRow(doc));
const NEW_ID = 'a1b2c3d4-0000-4000-8000-0000000000dd';

test('an update replaces the given fields and stamps updatedAt', () => {
  const next = applyOps(
    snapshot,
    [
      {
        op: 'update_object',
        id: TOKYO_ID,
        patch: { data: { ...tokyoData, days: 3 } },
        origin: 'direct',
      },
    ],
    LATER,
  );
  const tokyo = next.objects.find((o) => o.id === TOKYO_ID);

  assert.equal(tokyo.data.days, 3);
  assert.equal(tokyo.title, 'Tokyo');
  assert.equal(tokyo.updatedAt, LATER);
  assert.equal(snapshot.objects.find((o) => o.id === TOKYO_ID).data.days, 4, 'input untouched');
});

test('inserts and deletes add and remove objects and relationships', () => {
  const next = applyOps(
    snapshot,
    [
      {
        op: 'insert_object',
        id: NEW_ID,
        kind: 'insight',
        kindVersion: 1,
        title: 'Note',
        status: null,
        data: { text: 'Note', severity: 'info', actions: [] },
        source: { type: 'derived' },
        position: null,
        origin: 'derived',
      },
      { op: 'delete_relationship', id: TOKYO_REL_ID, origin: 'direct' },
      { op: 'delete_object', id: TOKYO_ID, origin: 'direct' },
    ],
    LATER,
  );

  assert.ok(next.objects.some((o) => o.id === NEW_ID && o.intentId === INTENT_ID));
  assert.ok(!next.objects.some((o) => o.id === TOKYO_ID));
  assert.ok(!next.relationships.some((r) => r.id === TOKYO_REL_ID));
});

test('set_workspace bumps the revision and update_intent merges the patch', () => {
  const next = applyOps(
    snapshot,
    [
      { op: 'set_workspace', doc: { ...doc, sections: [] }, origin: 'derived' },
      { op: 'update_intent', patch: { status: 'active' }, origin: 'direct' },
    ],
    LATER,
  );

  assert.equal(next.workspace.version, 2);
  assert.equal(next.intent.status, 'active');
  assert.equal(next.intent.goal, snapshot.intent.goal);
});

test('changing an object that is not there throws GraphOpError', () => {
  assert.throws(
    () => applyOps(snapshot, [{ op: 'delete_object', id: NEW_ID, origin: 'direct' }], LATER),
    GraphOpError,
  );
  assert.throws(
    () =>
      applyOps(
        snapshot,
        [
          {
            op: 'insert_object',
            id: TOKYO_ID,
            kind: 'place',
            kindVersion: 1,
            title: null,
            status: null,
            data: tokyoData,
            source: { type: 'user' },
            position: null,
            origin: 'direct',
          },
        ],
        LATER,
      ),
    GraphOpError,
  );
});
```

- [ ] **Step 6: Write `apply-ops.ts`**

```ts
import type { GraphObject, GraphSnapshot, Relationship } from './graph.ts';
import type { ChangesetOp } from './ops.ts';

/** An op that doesn't fit the snapshot, such as updating an object that isn't there. */
export class GraphOpError extends Error {}

// Copies only the keys a patch actually sets.
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function indexOf(items: readonly { id: string }[], id: string): number {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) {
    throw new GraphOpError(`Nothing with id ${id} in this intent.`);
  }

  return index;
}

/**
 * Applies ops to a snapshot and returns the new one; the input is not changed. The API uses
 * it to stage a changeset before deriving, and the mobile app for optimistic updates.
 *
 * @example
 * applyOps(snapshot, [{ op: 'delete_object', id, origin: 'direct' }], new Date().toISOString())
 */
export function applyOps(
  snapshot: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
): GraphSnapshot {
  const objects: GraphObject[] = [...snapshot.objects];
  const relationships: Relationship[] = [...snapshot.relationships];
  let { intent, workspace } = snapshot;

  for (const op of ops) {
    switch (op.op) {
      case 'insert_object': {
        if (objects.some((object) => object.id === op.id)) {
          throw new GraphOpError(`Object ${op.id} already exists.`);
        }

        objects.push({
          id: op.id,
          intentId: intent.id,
          kind: op.kind,
          kindVersion: op.kindVersion,
          title: op.title,
          status: op.status,
          data: op.data,
          source: op.source,
          position: op.position,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'update_object': {
        const index = indexOf(objects, op.id);

        objects[index] = { ...objects[index]!, ...defined(op.patch), updatedAt: now };
        break;
      }
      case 'delete_object':
        objects.splice(indexOf(objects, op.id), 1);
        break;
      case 'insert_relationship': {
        if (relationships.some((edge) => edge.id === op.id)) {
          throw new GraphOpError(`Relationship ${op.id} already exists.`);
        }

        relationships.push({
          id: op.id,
          intentId: intent.id,
          sourceType: op.sourceType,
          sourceId: op.sourceId,
          targetType: op.targetType,
          targetId: op.targetId,
          type: op.type,
          metadata: op.metadata,
          createdAt: now,
        });
        break;
      }
      case 'delete_relationship':
        relationships.splice(indexOf(relationships, op.id), 1);
        break;
      case 'set_workspace':
        workspace = {
          intentId: intent.id,
          version: (workspace?.version ?? 0) + 1,
          doc: op.doc,
          updatedAt: now,
        };
        break;
      case 'update_intent':
        intent = { ...intent, ...defined(op.patch), updatedAt: now };
        break;
    }
  }

  return { intent, workspace, objects, relationships };
}
```

Add to `packages/types/src/index.ts`:

```ts
export * from './query.ts';
export * from './apply-ops.ts';
```

- [ ] **Step 7: Run the tests**

Run: `node --experimental-strip-types --test tests/graph-query.test.mjs tests/apply-ops.test.mjs`
Expected: PASS (12 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/types apps/api/src/lib/graph/mappers.ts tests/graph-query.test.mjs tests/apply-ops.test.mjs
git commit -m "Add graph queries, op application and row mappers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Trip figures

**Files:**

- Create: `packages/types/src/kinds/trip-figures.ts`.
- Modify: `packages/types/src/index.ts`.
- Test: `tests/trip-figures.test.mjs`.

**Interfaces:**

- Consumes: `evaluateQuery`, `GraphSnapshot`, `GraphObject`, `TripData`, `PlaceData`,
  `LegData`, `StayData`, `Money`, `TripDerived`.
- Produces: `USD_PER_UNIT`, `convertMoney(money: Money, to: string): number | null`,
  `daysBetween(start: string, end: string): number`,
  `tripParts(snapshot: GraphSnapshot, tripId: string): { places: GraphObject[]; legs: GraphObject[]; stays: GraphObject[]; decisions: GraphObject[]; insights: GraphObject[] }`,
  `tripFigures(snapshot: GraphSnapshot, tripId: string): TripDerived`.

- [ ] **Step 1: Write the failing test**

`tests/trip-figures.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { convertMoney, daysBetween, tripFigures } from '../packages/types/src/index.ts';
import {
  kyotoData,
  kyotoRow,
  objectRow,
  relationshipRow,
  snapshotRow,
  tokyoData,
  tokyoRow,
  TRIP_ID,
  tripData,
  tripRow,
} from './support/graph.mjs';

const doc = { version: 1, anchorId: TRIP_ID, sections: [] };
const LEG_ID = 'a1b2c3d4-0000-4000-8000-0000000000e1';

function withObjects(objects, relationships) {
  const base = snapshotRow(doc);

  return mapSnapshotRow({
    ...base,
    objects,
    relationships: relationships ?? base.relationships,
  });
}

test('dates give the total; allocated days sum the trip places', () => {
  assert.deepEqual(tripFigures(mapSnapshotRow(snapshotRow(doc)), TRIP_ID), {
    totalDays: 8,
    allocatedDays: 8,
    unallocatedDays: 0,
    estCost: null,
    costIncomplete: false,
  });
});

test('Dec 12 to Dec 20 is 8 days', () => {
  assert.equal(daysBetween('2026-12-12', '2026-12-20'), 8);
  assert.equal(daysBetween('2026-12-28', '2027-01-04'), 7);
});

test('without dates, totalDays comes from the trip or is unknown', () => {
  const { startDate, endDate, ...undated } = tripData;
  const withTotal = withObjects([
    objectRow(TRIP_ID, 'trip', { ...undated, totalDays: 10 }),
    tokyoRow,
    kyotoRow,
  ]);
  const unknown = withObjects([objectRow(TRIP_ID, 'trip', undated), tokyoRow, kyotoRow]);

  assert.equal(tripFigures(withTotal, TRIP_ID).unallocatedDays, 2);
  assert.equal(tripFigures(unknown, TRIP_ID).totalDays, null);
  assert.equal(tripFigures(unknown, TRIP_ID).unallocatedDays, null);
});

test('costs convert to the trip currency and round to whole units', () => {
  const snapshot = withObjects(
    [
      tripRow,
      objectRow(tokyoRow.id, 'place', {
        ...tokyoData,
        estDailyCost: { amount: 20000, currency: 'JPY' },
      }),
      objectRow(kyotoRow.id, 'place', {
        ...kyotoData,
        estDailyCost: { amount: 100, currency: 'USD' },
      }),
      objectRow(LEG_ID, 'leg', { mode: 'train', estCost: { amount: 95, currency: 'USD' } }),
    ],
    [
      ...snapshotRow(doc).relationships,
      relationshipRow('a1b2c3d4-0000-4000-8000-0000000000e2', LEG_ID, TRIP_ID),
    ],
  );
  // Tokyo: 4 × ¥20,000 × 0.0067 = $536; Kyoto: 4 × $100 = $400; leg $95.
  assert.deepEqual(tripFigures(snapshot, TRIP_ID).estCost, { amount: 1031, currency: 'USD' });
  assert.equal(Math.round(convertMoney({ amount: 100, currency: 'EUR' }, 'USD')), 108);
  assert.equal(convertMoney({ amount: 100, currency: 'XAF' }, 'USD'), null);
});

test('an unknown currency is skipped and flagged, never thrown', () => {
  const snapshot = withObjects([
    tripRow,
    objectRow(tokyoRow.id, 'place', {
      ...tokyoData,
      estDailyCost: { amount: 50, currency: 'XAF' },
    }),
    kyotoRow,
  ]);
  const figures = tripFigures(snapshot, TRIP_ID);

  assert.equal(figures.estCost, null);
  assert.equal(figures.costIncomplete, true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/trip-figures.test.mjs`
Expected: FAIL with `does not provide an export named 'convertMoney'`.

- [ ] **Step 3: Write `kinds/trip-figures.ts`**

```ts
import type { GraphObject, GraphSnapshot } from '../graph.ts';
import { evaluateQuery } from '../query.ts';
import type { LegData, Money, PlaceData, StayData, TripData, TripDerived } from './travel.ts';

// Approximate US dollars per unit, fixed for slice 1 (spec section D: "approximate").
export const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.6,
  CHF: 1.12,
  CNY: 0.14,
  HKD: 0.128,
  TWD: 0.031,
  KRW: 0.00073,
  SGD: 0.74,
  THB: 0.028,
  VND: 0.00004,
  IDR: 0.000063,
  MYR: 0.21,
  PHP: 0.017,
  INR: 0.012,
  AED: 0.272,
  TRY: 0.03,
  MXN: 0.055,
  BRL: 0.18,
  ZAR: 0.054,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  ISK: 0.0072,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0028,
};

/** Converts an amount into another currency, or null when either currency is unknown. */
export function convertMoney(money: Money, to: string): number | null {
  const from = USD_PER_UNIT[money.currency];
  const target = USD_PER_UNIT[to];

  if (from === undefined || target === undefined) {
    return null;
  }

  return (money.amount * from) / target;
}

/**
 * Whole days between two ISO dates.
 *
 * @example
 * daysBetween('2026-12-12', '2026-12-20') // 8
 */
export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

/** Everything `part_of` a trip, by kind; places in route order. */
export function tripParts(
  snapshot: GraphSnapshot,
  tripId: string,
): {
  places: GraphObject[];
  legs: GraphObject[];
  stays: GraphObject[];
  decisions: GraphObject[];
  insights: GraphObject[];
} {
  const partOf = (kind: 'place' | 'leg' | 'stay' | 'decision' | 'insight'): GraphObject[] =>
    evaluateQuery(snapshot, {
      from: 'objects',
      kind,
      related: { type: 'part_of', to: { objectId: tripId }, direction: 'out' },
      sort: 'position',
    });

  return {
    places: partOf('place'),
    legs: partOf('leg'),
    stays: partOf('stay'),
    decisions: partOf('decision'),
    insights: partOf('insight'),
  };
}

/**
 * The trip's days and approximate cost, computed only from the graph (no model involved).
 * Dates win over `totalDays`; costs in unknown currencies are skipped and flagged.
 */
export function tripFigures(snapshot: GraphSnapshot, tripId: string): TripDerived {
  const trip = snapshot.objects.find((object) => object.id === tripId);
  const data = (trip?.data ?? {}) as Partial<TripData>;
  const currency = data.currency ?? 'USD';
  const { places, legs, stays } = tripParts(snapshot, tripId);
  const totalDays =
    data.startDate && data.endDate
      ? daysBetween(data.startDate, data.endDate)
      : (data.totalDays ?? null);
  const allocatedDays = places.reduce((sum, place) => sum + (place.data as PlaceData).days, 0);

  let amount = 0;
  let priced = false;
  let costIncomplete = false;

  const add = (money: Money | undefined, times = 1): void => {
    if (!money) {
      return;
    }

    const converted = convertMoney(money, currency);

    if (converted === null) {
      costIncomplete = true;

      return;
    }

    amount += converted * times;
    priced = true;
  };

  for (const place of places) {
    const placeData = place.data as PlaceData;

    add(placeData.estDailyCost, placeData.days);
  }

  for (const leg of legs) {
    add((leg.data as LegData).estCost);
  }

  for (const stay of stays) {
    const stayData = stay.data as StayData;

    add(stayData.estNightly, stayData.nights);
  }

  return {
    totalDays,
    allocatedDays,
    unallocatedDays: totalDays === null ? null : totalDays - allocatedDays,
    estCost: priced ? { amount: Math.round(amount), currency } : null,
    costIncomplete,
  };
}
```

Add `export * from './kinds/trip-figures.ts';` to `packages/types/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/trip-figures.test.mjs`
Expected: PASS (5 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/types tests/trip-figures.test.mjs
git commit -m "Calculate trip days and approximate cost from the graph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Database migration

**Files:**

- Create: `supabase/migrations/20260927000000_intent_graph.sql`,
  `supabase/tests/intent-graph-smoke.sql`.
- Test: `tests/intent-graph-migration.test.mjs`.

**Interfaces:**

- Produces (Postgres, callable through PostgREST `/rest/v1/rpc/<name>`):
  - `create_intent(p_intent_id uuid, p_goal text, p_template text, p_ops jsonb) returns jsonb`
    (the logged event row).
  - `apply_changeset(p_intent_id uuid, p_actor text, p_run_id uuid, p_ops jsonb) returns jsonb`
    (the logged event row).
  - `revert_event(p_event_id uuid) returns jsonb` (the new revert event row).
  - `get_intent_snapshot(p_intent_id uuid) returns jsonb`
    (`{ intent, workspace, objects, relationships }`, or null).
  - `changes_page(p_limit integer, p_before_seq bigint, p_intent_id uuid) returns jsonb`
    (an array of event rows plus `intent_goal` and `reverted_by_event_id`).
  - Error codes: `NXU04` not found, `NXU08` edit conflict, `NXU09` changed since (can't
    undo), `NXU10` already undone, `NXU22` invalid changeset.
  - `p_ops` items use the camelCase `ChangesetOp` shape from Task 3.

- [ ] **Step 1: Write the failing static test**

`tests/intent-graph-migration.test.mjs`:

```js
// Static checks on the intent graph migration: writers are functions only, every function
// pins search_path, and definer functions check the caller.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260927000000_intent_graph.sql', 'utf8');
const tables = ['intents', 'objects', 'relationships', 'events', 'workspaces', 'runs'];
const functions = [...sql.matchAll(/create function ([\w.]+)\(([\s\S]*?)\n\$\$;/g)];

test('all six tables exist with RLS on', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated`), table);
  }
});

test('clients cannot write any graph table directly', () => {
  assert.match(
    sql,
    /revoke insert, update, delete, truncate on\s+public\.intents, public\.objects, public\.relationships, public\.events, public\.workspaces, public\.runs\s+from anon, authenticated;/,
  );
  assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
  assert.doesNotMatch(sql, /for (insert|update|delete|all) to/i);
});

test('every function pins search_path; definer functions check auth.uid()', () => {
  assert.ok(functions.length >= 8, `found ${functions.length} functions`);

  for (const [, name, body] of functions) {
    assert.match(body, /set search_path = ''/, `${name} search_path`);

    if (/security definer/.test(body)) {
      assert.match(body, /auth\.uid\(\)/, `${name} checks the caller`);
    }
  }
});

test('the private schema is closed and the public writers are for signed-in users only', () => {
  assert.match(sql, /revoke all on schema private from public, anon, authenticated;/);

  for (const name of [
    'create_intent',
    'apply_changeset',
    'revert_event',
    'get_intent_snapshot',
    'changes_page',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`),
      name,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`),
      name,
    );
  }
});

test('Realtime publishes the tables the app subscribes to', () => {
  assert.match(
    sql,
    /alter publication supabase_realtime add table\s+public\.objects, public\.relationships, public\.workspaces, public\.events, public\.runs;/,
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/intent-graph-migration.test.mjs`
Expected: FAIL with `ENOENT` (the migration doesn't exist yet).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260927000000_intent_graph.sql`:

```sql
-- Nexui intent graph: intents, their objects and relationships, the event log of changesets,
-- workspace docs and AI runs. Clients only read (owner-only RLS). Every write goes through
-- the security definer functions at the end, which check auth.uid() and scope each statement
-- to the caller. See docs/architecture/intent-graph.md.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 500),
  template text check (template in ('travel', 'job_search')),
  status text not null default 'exploring'
    check (status in ('exploring', 'active', 'blocked', 'completed', 'archived')),
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  summary jsonb not null default '{"line":""}' check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid not null references public.intents (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  kind_version integer not null default 1 check (kind_version >= 1),
  title text check (char_length(title) <= 200),
  status text check (char_length(status) <= 40),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  source jsonb check (source is null or jsonb_typeof(source) = 'object'),
  position double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `intent_id` is the owning intent, used for loading. Endpoints may later point into other
-- intents; they're checked against the caller's own rows when written.
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid not null references public.intents (id) on delete cascade,
  source_type text not null check (source_type in ('object', 'intent')),
  source_id uuid not null,
  target_type text not null check (target_type in ('object', 'intent')),
  target_id uuid not null,
  type text not null check (type ~ '^[a-z][a-z_]{0,39}$'),
  metadata jsonb check (metadata is null or jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only. A changeset row keeps [{op, table, id, before, after, origin}] so Undo can
-- restore `before`; an Undo is itself a changeset with `reverts_event_id` set.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete cascade,
  seq bigint generated always as identity,
  type text not null check (char_length(type) between 1 and 40),
  actor text not null check (actor in ('user', 'derived', 'ai', 'system')),
  run_id uuid,
  reverts_event_id uuid references public.events (id) on delete cascade,
  ops jsonb check (ops is null or jsonb_typeof(ops) = 'array'),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.workspaces (
  intent_id uuid primary key references public.intents (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null default 1,
  doc jsonb not null check (jsonb_typeof(doc) = 'object'),
  updated_at timestamptz not null default now()
);

-- Long AI work (intelligence plan). Created now so Realtime and RLS are in place.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete cascade,
  kind text not null check (kind in ('create_intent', 'ask')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null,
  progress jsonb not null default '[]',
  error text,
  model_usage jsonb not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger intents_set_updated_at before update on public.intents
  for each row execute function public.set_updated_at();
create trigger objects_set_updated_at before update on public.objects
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

create index intents_user_activity_idx on public.intents (user_id, status, last_activity_at desc);
create index objects_intent_kind_idx on public.objects (intent_id, kind) where deleted_at is null;
create index relationships_intent_idx on public.relationships (intent_id) where deleted_at is null;
create index relationships_source_idx on public.relationships (source_id, type);
create index relationships_target_idx on public.relationships (target_id, type);
create unique index relationships_live_unique
  on public.relationships (source_id, target_id, type) where deleted_at is null;
create index events_user_seq_idx on public.events (user_id, seq desc);
create index events_intent_seq_idx on public.events (intent_id, seq desc);
-- One Undo per event; also the backstop for two Undos racing.
create unique index events_reverts_unique on public.events (reverts_event_id)
  where reverts_event_id is not null;
create index runs_intent_idx on public.runs (intent_id, created_at desc);

alter table public.intents enable row level security;
alter table public.objects enable row level security;
alter table public.relationships enable row level security;
alter table public.events enable row level security;
alter table public.workspaces enable row level security;
alter table public.runs enable row level security;

revoke insert, update, delete, truncate on
  public.intents, public.objects, public.relationships, public.events, public.workspaces, public.runs
  from anon, authenticated;

create policy "Owners read intents" on public.intents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read objects" on public.objects for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read relationships" on public.relationships for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read events" on public.events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read workspaces" on public.workspaces for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read runs" on public.runs for select to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table
  public.objects, public.relationships, public.workspaces, public.events, public.runs;

-- A relationship endpoint must be one of the caller's live objects or intents.
create function private.check_endpoint(p_user uuid, p_type text, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_type = 'object' then
    perform 1 from public.objects where id = p_id and user_id = p_user and deleted_at is null;
  elsif p_type = 'intent' then
    perform 1 from public.intents where id = p_id and user_id = p_user;
  else
    raise exception 'Unknown endpoint type' using errcode = 'NXU22';
  end if;

  if not found then
    raise exception 'That item no longer exists' using errcode = 'NXU04';
  end if;
end;
$$;

-- Applies one changeset for p_user and logs it. The callers have already locked the intent
-- and checked that p_user owns it. A row may appear only once per changeset.
create function private.apply_ops(
  p_user uuid,
  p_intent_id uuid,
  p_actor text,
  p_run_id uuid,
  p_ops jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  op jsonb;
  op_kind text;
  patch jsonb;
  target_table text;
  row_id uuid;
  before_row jsonb;
  after_row jsonb;
  stored jsonb := '[]'::jsonb;
  touched text[] := '{}';
  logged public.events;
begin
  if p_actor not in ('user', 'derived', 'ai', 'system') then
    raise exception 'Unknown actor' using errcode = 'NXU22';
  end if;

  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'A changeset needs at least one change' using errcode = 'NXU22';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    op_kind := op ->> 'op';
    patch := op -> 'patch';
    before_row := null;
    after_row := null;
    target_table := case
      when op_kind in ('insert_object', 'update_object', 'delete_object') then 'objects'
      when op_kind in ('insert_relationship', 'delete_relationship') then 'relationships'
      when op_kind = 'set_workspace' then 'workspaces'
      when op_kind = 'update_intent' then 'intents'
    end;

    if target_table is null then
      raise exception 'Unknown change' using errcode = 'NXU22';
    end if;

    row_id := case
      when target_table in ('workspaces', 'intents') then p_intent_id
      else (op ->> 'id')::uuid
    end;

    if (target_table || ':' || row_id) = any (touched) then
      raise exception 'A row can change only once per changeset' using errcode = 'NXU22';
    end if;

    touched := touched || (target_table || ':' || row_id);

    case op_kind
      when 'insert_object' then
        insert into public.objects as o
          (id, user_id, intent_id, kind, kind_version, title, status, data, source, position)
        values (
          row_id,
          p_user,
          p_intent_id,
          op ->> 'kind',
          coalesce((op ->> 'kindVersion')::integer, 1),
          op ->> 'title',
          op ->> 'status',
          op -> 'data',
          nullif(op -> 'source', 'null'::jsonb),
          (op ->> 'position')::double precision
        )
        returning to_jsonb(o.*) into after_row;

      when 'update_object', 'delete_object' then
        select to_jsonb(o.*) into before_row
        from public.objects o
        where o.id = row_id and o.user_id = p_user and o.intent_id = p_intent_id
          and o.deleted_at is null
        for update;

        if before_row is null then
          raise exception 'That item no longer exists' using errcode = 'NXU04';
        end if;

        if op_kind = 'delete_object' then
          update public.objects o set deleted_at = now()
          where o.id = row_id
          returning to_jsonb(o.*) into after_row;
        else
          if op ? 'expectedUpdatedAt'
            and (before_row ->> 'updated_at')::timestamptz <> (op ->> 'expectedUpdatedAt')::timestamptz
          then
            raise exception 'This changed while you were editing' using errcode = 'NXU08';
          end if;

          update public.objects o set
            title = case when patch ? 'title' then patch ->> 'title' else o.title end,
            status = case when patch ? 'status' then patch ->> 'status' else o.status end,
            data = case when patch ? 'data' then patch -> 'data' else o.data end,
            source = case when patch ? 'source' then nullif(patch -> 'source', 'null'::jsonb) else o.source end,
            position = case
              when patch ? 'position' then (patch ->> 'position')::double precision
              else o.position
            end
          where o.id = row_id
          returning to_jsonb(o.*) into after_row;
        end if;

      when 'insert_relationship' then
        perform private.check_endpoint(p_user, op ->> 'sourceType', (op ->> 'sourceId')::uuid);
        perform private.check_endpoint(p_user, op ->> 'targetType', (op ->> 'targetId')::uuid);

        insert into public.relationships as r
          (id, user_id, intent_id, source_type, source_id, target_type, target_id, type, metadata)
        values (
          row_id,
          p_user,
          p_intent_id,
          op ->> 'sourceType',
          (op ->> 'sourceId')::uuid,
          op ->> 'targetType',
          (op ->> 'targetId')::uuid,
          op ->> 'type',
          nullif(op -> 'metadata', 'null'::jsonb)
        )
        returning to_jsonb(r.*) into after_row;

      when 'delete_relationship' then
        select to_jsonb(r.*) into before_row
        from public.relationships r
        where r.id = row_id and r.user_id = p_user and r.intent_id = p_intent_id
          and r.deleted_at is null
        for update;

        if before_row is null then
          raise exception 'That link no longer exists' using errcode = 'NXU04';
        end if;

        update public.relationships r set deleted_at = now()
        where r.id = row_id
        returning to_jsonb(r.*) into after_row;

      when 'set_workspace' then
        select to_jsonb(w.*) into before_row
        from public.workspaces w
        where w.intent_id = p_intent_id and w.user_id = p_user
        for update;

        insert into public.workspaces as w (intent_id, user_id, doc)
        values (p_intent_id, p_user, op -> 'doc')
        on conflict (intent_id) do update set doc = excluded.doc, version = w.version + 1
        returning to_jsonb(w.*) into after_row;

      when 'update_intent' then
        select to_jsonb(i.*) into before_row
        from public.intents i
        where i.id = p_intent_id and i.user_id = p_user
        for update;

        update public.intents i set
          status = case when patch ? 'status' then patch ->> 'status' else i.status end,
          summary = case when patch ? 'summary' then patch -> 'summary' else i.summary end,
          context = case when patch ? 'context' then patch -> 'context' else i.context end
        where i.id = p_intent_id
        returning to_jsonb(i.*) into after_row;
    end case;

    stored := stored || jsonb_build_array(jsonb_build_object(
      'op', op_kind,
      'table', target_table,
      'id', row_id,
      'before', before_row,
      'after', after_row,
      'origin', coalesce(op ->> 'origin', 'direct')
    ));
  end loop;

  insert into public.events (user_id, intent_id, type, actor, run_id, ops)
  values (p_user, p_intent_id, 'changeset', p_actor, p_run_id, stored)
  returning * into logged;

  update public.intents set last_activity_at = now() where id = p_intent_id;

  return to_jsonb(logged);
end;
$$;

-- Creates an intent and applies its template's seed changeset in one transaction.
create function public.create_intent(p_intent_id uuid, p_goal text, p_template text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  insert into public.intents (id, user_id, goal, template)
  values (p_intent_id, caller, p_goal, p_template);

  return private.apply_ops(caller, p_intent_id, 'system', null, p_ops);
end;
$$;

-- Applies a changeset to one of the caller's intents and logs it (spec section C).
create function public.apply_changeset(p_intent_id uuid, p_actor text, p_run_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  perform 1 from public.intents where id = p_intent_id and user_id = caller for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  return private.apply_ops(caller, p_intent_id, p_actor, p_run_id, p_ops);
end;
$$;

-- Undo: writes each row's `before` back, newest first, as a new changeset. Refuses when a
-- row changed since or the event was already undone. Redo is revert_event on the Undo event.
create function public.revert_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  original public.events;
  item jsonb;
  row_id uuid;
  prior jsonb;
  later jsonb;
  current_row jsonb;
  restored jsonb;
  stored jsonb := '[]'::jsonb;
  logged public.events;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  select * into original from public.events where id = p_event_id and user_id = caller;

  if not found or original.type <> 'changeset' or original.intent_id is null then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  perform 1 from public.intents where id = original.intent_id and user_id = caller for update;

  if exists (select 1 from public.events where reverts_event_id = p_event_id) then
    raise exception 'Already undone' using errcode = 'NXU10';
  end if;

  for item in
    select value from jsonb_array_elements(original.ops) with ordinality as t(value, n)
    order by n desc
  loop
    row_id := (item ->> 'id')::uuid;
    prior := nullif(item -> 'before', 'null'::jsonb);
    later := nullif(item -> 'after', 'null'::jsonb);
    current_row := null;
    restored := null;

    case item ->> 'table'
      when 'objects' then
        select to_jsonb(o.*) into current_row
        from public.objects o where o.id = row_id and o.user_id = caller for update;

        if current_row -> 'updated_at' is distinct from later -> 'updated_at' then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        if prior is null then
          update public.objects o set deleted_at = now()
          where o.id = row_id returning to_jsonb(o.*) into restored;
        else
          update public.objects o set
            title = prior ->> 'title',
            status = prior ->> 'status',
            data = prior -> 'data',
            source = nullif(prior -> 'source', 'null'::jsonb),
            position = (prior ->> 'position')::double precision,
            kind_version = (prior ->> 'kind_version')::integer,
            deleted_at = (prior ->> 'deleted_at')::timestamptz
          where o.id = row_id returning to_jsonb(o.*) into restored;
        end if;

      when 'relationships' then
        select to_jsonb(r.*) into current_row
        from public.relationships r where r.id = row_id and r.user_id = caller for update;

        if current_row is null or current_row -> 'deleted_at' is distinct from later -> 'deleted_at' then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        update public.relationships r set
          deleted_at = case when prior is null then now() else (prior ->> 'deleted_at')::timestamptz end,
          metadata = case when prior is null then r.metadata else nullif(prior -> 'metadata', 'null'::jsonb) end
        where r.id = row_id returning to_jsonb(r.*) into restored;

      when 'workspaces' then
        select to_jsonb(w.*) into current_row
        from public.workspaces w where w.intent_id = row_id and w.user_id = caller for update;

        if current_row -> 'doc' is distinct from later -> 'doc' then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        if prior is null then
          delete from public.workspaces w where w.intent_id = row_id;
        else
          insert into public.workspaces as w (intent_id, user_id, doc)
          values (row_id, caller, prior -> 'doc')
          on conflict (intent_id) do update set doc = excluded.doc, version = w.version + 1
          returning to_jsonb(w.*) into restored;
        end if;

      when 'intents' then
        select to_jsonb(i.*) into current_row
        from public.intents i where i.id = row_id and i.user_id = caller for update;

        if current_row -> 'summary' is distinct from later -> 'summary'
          or current_row -> 'status' is distinct from later -> 'status'
          or current_row -> 'context' is distinct from later -> 'context'
        then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        update public.intents i set
          summary = prior -> 'summary',
          status = prior ->> 'status',
          context = prior -> 'context'
        where i.id = row_id returning to_jsonb(i.*) into restored;
    end case;

    stored := stored || jsonb_build_array(jsonb_build_object(
      'op', 'revert',
      'table', item ->> 'table',
      'id', row_id,
      'before', current_row,
      'after', restored,
      'origin', coalesce(item ->> 'origin', 'direct')
    ));
  end loop;

  insert into public.events (user_id, intent_id, type, actor, reverts_event_id, ops)
  values (caller, original.intent_id, 'changeset', 'user', p_event_id, stored)
  returning * into logged;

  update public.intents set last_activity_at = now() where id = original.intent_id;

  return to_jsonb(logged);
end;
$$;

-- The intent, its workspace and its live objects and relationships, in one call. Reads run
-- as the caller, so RLS applies.
create function public.get_intent_snapshot(p_intent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'intent', to_jsonb(i.*),
    'workspace', (select to_jsonb(w.*) from public.workspaces w where w.intent_id = i.id),
    'objects', coalesce((
      select jsonb_agg(to_jsonb(o.*) order by o.position nulls last, o.created_at)
      from public.objects o
      where o.intent_id = i.id and o.deleted_at is null
    ), '[]'::jsonb),
    'relationships', coalesce((
      select jsonb_agg(to_jsonb(r.*) order by r.created_at)
      from public.relationships r
      where r.intent_id = i.id and r.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.intents i
  where i.id = p_intent_id;
$$;

-- One page of the Changes feed, newest first, with each event's intent goal and its Undo.
create function public.changes_page(
  p_limit integer,
  p_before_seq bigint default null,
  p_intent_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(page.item order by page.seq desc), '[]'::jsonb)
  from (
    select
      e.seq,
      to_jsonb(e.*) || jsonb_build_object(
        'intent_goal', i.goal,
        'reverted_by_event_id', (select r.id from public.events r where r.reverts_event_id = e.id)
      ) as item
    from public.events e
    left join public.intents i on i.id = e.intent_id
    where (p_before_seq is null or e.seq < p_before_seq)
      and (p_intent_id is null or e.intent_id = p_intent_id)
    order by e.seq desc
    limit least(greatest(p_limit, 1), 100)
  ) page;
$$;

revoke execute on function public.create_intent(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_intent(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.apply_changeset(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.apply_changeset(uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.revert_event(uuid) from public, anon;
grant execute on function public.revert_event(uuid) to authenticated;
revoke execute on function public.get_intent_snapshot(uuid) from public, anon;
grant execute on function public.get_intent_snapshot(uuid) to authenticated;
revoke execute on function public.changes_page(integer, bigint, uuid) from public, anon;
grant execute on function public.changes_page(integer, bigint, uuid) to authenticated;
```

- [ ] **Step 4: Write the SQL smoke script**

`supabase/tests/intent-graph-smoke.sql` (run in Task 11 against the reset database; it rolls
everything back):

```sql
-- Paste into the Supabase SQL editor (or run with psql). Creates two throwaway users, checks
-- create, change, undo, redo and isolation, and rolls everything back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'graph-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'graph-b@example.test');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

select public.create_intent(
  '10000000-0000-4000-8000-000000000001',
  'Plan a weekend in Chicago',
  'travel',
  jsonb_build_array(
    jsonb_build_object('op', 'insert_object', 'id', '10000000-0000-4000-8000-000000000002',
      'kind', 'trip', 'kindVersion', 1, 'title', 'Chicago', 'status', null,
      'data', '{"destinations":["Chicago"],"currency":"USD","totalDays":3}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'),
    jsonb_build_object('op', 'insert_object', 'id', '10000000-0000-4000-8000-000000000003',
      'kind', 'place', 'kindVersion', 1, 'title', 'The Loop', 'status', null,
      'data', '{"name":"The Loop","country":"US","placeType":"area","lat":41.88,"lng":-87.63,"days":2}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', 1, 'origin', 'direct'),
    jsonb_build_object('op', 'insert_relationship', 'id', '10000000-0000-4000-8000-000000000004',
      'sourceType', 'object', 'sourceId', '10000000-0000-4000-8000-000000000003',
      'targetType', 'object', 'targetId', '10000000-0000-4000-8000-000000000002',
      'type', 'part_of', 'metadata', null, 'origin', 'direct'),
    jsonb_build_object('op', 'set_workspace', 'origin', 'direct', 'doc',
      '{"version":1,"anchorId":"10000000-0000-4000-8000-000000000002","sections":[]}'::jsonb)
  )
);

do $$
declare
  snapshot jsonb := public.get_intent_snapshot('10000000-0000-4000-8000-000000000001');
  changed jsonb;
  undone jsonb;
  redone jsonb;
begin
  assert jsonb_array_length(snapshot -> 'objects') = 2, 'owner sees the trip and the place';
  assert jsonb_array_length(snapshot -> 'relationships') = 1, 'owner sees the link';
  assert snapshot -> 'workspace' is not null, 'the workspace exists';

  changed := public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
    jsonb_build_array(jsonb_build_object('op', 'update_object',
      'id', '10000000-0000-4000-8000-000000000003', 'origin', 'direct',
      'patch', jsonb_build_object('data',
        '{"name":"The Loop","country":"US","placeType":"area","lat":41.88,"lng":-87.63,"days":1}'::jsonb))));
  assert (changed #>> '{ops,0,after,data,days}')::int = 1, 'the change is logged with after';
  assert (changed #>> '{ops,0,before,data,days}')::int = 2, 'the change is logged with before';

  undone := public.revert_event((changed ->> 'id')::uuid);
  assert (undone ->> 'reverts_event_id') = (changed ->> 'id'), 'the undo points at the change';
  assert (select (data ->> 'days')::int from public.objects
    where id = '10000000-0000-4000-8000-000000000003') = 2, 'undo restores 2 days';

  begin
    perform public.revert_event((changed ->> 'id')::uuid);
    assert false, 'a second undo must fail';
  exception when sqlstate 'NXU10' then
    null;
  end;

  redone := public.revert_event((undone ->> 'id')::uuid);
  assert (select (data ->> 'days')::int from public.objects
    where id = '10000000-0000-4000-8000-000000000003') = 1, 'redo applies the change again';

  begin
    perform public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
      jsonb_build_array(jsonb_build_object('op', 'update_object',
        'id', '10000000-0000-4000-8000-000000000003', 'origin', 'direct',
        'expectedUpdatedAt', '2000-01-01T00:00:00Z', 'patch', '{"title":"Loop"}'::jsonb)));
    assert false, 'a stale expectedUpdatedAt must fail';
  exception when sqlstate 'NXU08' then
    null;
  end;

  begin
    insert into public.objects (intent_id, kind, data)
    values ('10000000-0000-4000-8000-000000000001', 'thing', '{}');
    assert false, 'clients must not insert directly';
  exception when insufficient_privilege then
    null;
  end;

  assert jsonb_array_length(public.changes_page(10)) = 4,
    'Changes lists create, change, undo and redo';
end;
$$;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
begin
  assert public.get_intent_snapshot('10000000-0000-4000-8000-000000000001') is null,
    'another user cannot read the intent';
  assert (select count(*) from public.objects) = 0, 'another user sees no objects';
  assert jsonb_array_length(public.changes_page(10)) = 0, 'another user sees no changes';

  begin
    perform public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
      '[{"op":"delete_object","id":"10000000-0000-4000-8000-000000000003","origin":"direct"}]');
    assert false, 'another user cannot change the intent';
  exception when sqlstate 'NXU04' then
    null;
  end;
end;
$$;

rollback;
```

- [ ] **Step 5: Run the static test**

Run: `node --experimental-strip-types --test tests/intent-graph-migration.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase tests/intent-graph-migration.test.mjs
git commit -m "Add the intent graph schema with changeset, undo and snapshot functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The migration is applied to the database in Task 11, after the user confirms the reset.

---

### Task 7: Travel template and trip derivations

**Files:**

- Create: `apps/api/src/lib/templates/travel.ts`, `apps/api/src/lib/templates/index.ts`,
  `apps/api/src/lib/kinds/trip.ts`.
- Test: `tests/travel-template.test.mjs`, `tests/derive-trip.test.mjs`.

**Interfaces:**

- Consumes: `tripFigures`, `tripParts`, `evaluateQuery`, `ChangesetOp`, `GraphSnapshot`,
  `WorkspaceDoc`, `GraphQuery`, `IntentSummary`, `InsightData`, `DecisionData`, `TripData`.
- Produces:
  - `travelWorkspace(tripId: string): WorkspaceDoc`.
  - `seedTravelOps(goal: string, newId: () => string): ChangesetOp[]`.
  - `interface ShortenedPlace { placeId: string; name: string; previousDays: number; days: number }`.
  - `findShortenedPlace(before: GraphSnapshot, ops: readonly ChangesetOp[]): ShortenedPlace | null`.
  - `formatDateRange(start: string, end: string): string`.
  - `deriveTrip(staged: GraphSnapshot, tripId: string, shortened: ShortenedPlace | null, newId: () => string): ChangesetOp[]`.
  - `deriveForTemplate(before: GraphSnapshot, staged: GraphSnapshot, ops: readonly ChangesetOp[], newId: () => string): ChangesetOp[]`.
  - Constants `UNALLOCATED_KEY = 'trip.unallocatedDays'` and `LENGTH_KEY = 'trip.length'`.

- [ ] **Step 1: Write the failing template test**

`tests/travel-template.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { seedTravelOps, travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { workspaceDocSchema } from '../packages/types/src/index.ts';
import { idSequence } from './support/graph.mjs';

test('the travel workspace is a valid doc in the design order', () => {
  const tripId = 'b0000000-0000-4000-8000-000000000001';
  const doc = travelWorkspace(tripId);

  assert.deepEqual(workspaceDocSchema.parse(doc), doc);
  assert.equal(doc.anchorId, tripId);
  assert.deepEqual(
    doc.sections.map((s) => `${s.id}:${s.type}${s.pin ? ':open' : ''}`),
    ['map:map', 'metrics:metric', 'days:allocation', 'insights:insight:open', 'route:route'],
  );
  assert.deepEqual(
    doc.sections[1].metrics.map((m) => m.derived),
    ['trip.totalDays', 'trip.unallocatedDays', 'trip.estCost'],
  );
  assert.equal(doc.sections[1].metrics[1].emphasis, 'whenPositive');
});

test('the seed creates an empty trip from the goal and its workspace', () => {
  const ops = seedTravelOps('  Plan a weekend in Chicago  ', idSequence());

  assert.deepEqual(ops[0], {
    op: 'insert_object',
    id: 'b0000000-0000-4000-8000-000000000001',
    kind: 'trip',
    kindVersion: 1,
    title: 'Plan a weekend in Chicago',
    status: null,
    data: { destinations: [], currency: 'USD' },
    source: { type: 'user' },
    position: null,
    origin: 'direct',
  });
  assert.equal(ops[1].op, 'set_workspace');
  assert.equal(ops[1].doc.anchorId, 'b0000000-0000-4000-8000-000000000001');
  assert.equal(ops.length, 2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/travel-template.test.mjs`
Expected: FAIL with `Cannot find module …/templates/travel.ts`.

- [ ] **Step 3: Write `templates/travel.ts`**

```ts
import type { ChangesetOp, GraphQuery, WorkspaceDoc } from '@nexui/types';

function partOf(kind: 'place' | 'leg' | 'insight', tripId: string): GraphQuery {
  return {
    from: 'objects',
    kind,
    related: { type: 'part_of', to: { objectId: tripId }, direction: 'out' },
    sort: 'position',
  };
}

/**
 * The travel template's starting workspace, in the order of the chosen design (spec section I):
 * map, metrics, day bar, the pinned insights, then the editable route.
 */
export function travelWorkspace(tripId: string): WorkspaceDoc {
  const places = partOf('place', tripId);

  return {
    version: 1,
    anchorId: tripId,
    sections: [
      { id: 'map', type: 'map', places, legs: partOf('leg', tripId) },
      {
        id: 'metrics',
        type: 'metric',
        metrics: [
          { label: 'days in total', derived: 'trip.totalDays', format: 'days' },
          {
            label: 'unallocated',
            derived: 'trip.unallocatedDays',
            format: 'days',
            emphasis: 'whenPositive',
          },
          { label: 'approximate cost', derived: 'trip.estCost', format: 'currency' },
        ],
      },
      {
        id: 'days',
        type: 'allocation',
        parts: places,
        valueField: 'data.days',
        labelField: 'data.name',
        total: 'trip.totalDays',
      },
      { id: 'insights', type: 'insight', pin: 'open', query: partOf('insight', tripId) },
      {
        id: 'route',
        type: 'route',
        query: places,
        editable: ['days', 'order'],
        showUnallocated: true,
      },
    ],
  };
}

/**
 * A new travel intent: an empty trip named after the goal, and its workspace. The intelligence
 * plan fills in destinations and places; until then the trip length is an open decision.
 */
export function seedTravelOps(goal: string, newId: () => string): ChangesetOp[] {
  const tripId = newId();

  return [
    {
      op: 'insert_object',
      id: tripId,
      kind: 'trip',
      kindVersion: 1,
      title: goal.trim().slice(0, 200),
      status: null,
      data: { destinations: [], currency: 'USD' },
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
    { op: 'set_workspace', doc: travelWorkspace(tripId), origin: 'direct' },
  ];
}
```

- [ ] **Step 4: Write the failing derivation test**

`tests/derive-trip.test.mjs`:

```js
// Spec H step 4: shortening a stop frees a day, and code (no model) records it, surfaces an
// insight with its two actions, and updates the Home summary.
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { deriveTrip, findShortenedPlace, formatDateRange } from '../apps/api/src/lib/kinds/trip.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { applyOps } from '../packages/types/src/index.ts';
import {
  idSequence,
  LATER,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripData,
  tripRow,
  tokyoRow,
  kyotoRow,
} from './support/graph.mjs';

const before = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const shorten = [
  {
    op: 'update_object',
    id: TOKYO_ID,
    patch: { data: { ...tokyoData, days: 3 } },
    origin: 'direct',
  },
];

test('a trip whose figures and summary are current derives nothing', () => {
  assert.deepEqual(deriveTrip(before, TRIP_ID, null, idSequence()), []);
});

test('formatDateRange shortens same-month ranges', () => {
  assert.equal(formatDateRange('2026-12-12', '2026-12-20'), 'Dec 12 – 20');
  assert.equal(formatDateRange('2026-12-28', '2027-01-04'), 'Dec 28 – Jan 4');
});

test('findShortenedPlace spots a place losing days', () => {
  assert.deepEqual(findShortenedPlace(before, shorten), {
    placeId: TOKYO_ID,
    name: 'Tokyo',
    previousDays: 4,
    days: 3,
  });
  assert.equal(findShortenedPlace(before, []), null);
});

test('shortening Tokyo frees a day: figures, insight with actions, and summary', () => {
  const staged = applyOps(before, shorten, LATER);
  const ops = deriveTrip(staged, TRIP_ID, findShortenedPlace(before, shorten), idSequence());
  const insightId = 'b0000000-0000-4000-8000-000000000001';

  assert.deepEqual(ops, [
    {
      op: 'update_object',
      id: TRIP_ID,
      patch: {
        data: {
          ...tripData,
          derived: {
            totalDays: 8,
            allocatedDays: 7,
            unallocatedDays: 1,
            estCost: null,
            costIncomplete: false,
          },
        },
      },
      origin: 'derived',
    },
    {
      op: 'insert_object',
      id: insightId,
      kind: 'insight',
      kindVersion: 1,
      title: 'You have 1 day unallocated',
      status: null,
      data: {
        text: 'You have 1 day unallocated',
        detail: 'Tokyo went from 4 to 3 days.',
        severity: 'attention',
        derivedKey: 'trip.unallocatedDays',
        actions: [
          {
            type: 'ask',
            label: 'Ask Nexui for ideas',
            prompt: 'How should I use the 1 day I have free?',
          },
          {
            type: 'capability',
            label: 'Give it back to Tokyo',
            name: 'trip.setPlaceDays',
            input: { placeId: TOKYO_ID, days: 4 },
          },
        ],
      },
      source: { type: 'derived' },
      position: null,
      origin: 'derived',
    },
    {
      op: 'insert_relationship',
      id: 'b0000000-0000-4000-8000-000000000002',
      sourceType: 'object',
      sourceId: insightId,
      targetType: 'object',
      targetId: TRIP_ID,
      type: 'part_of',
      metadata: null,
      origin: 'derived',
    },
    {
      op: 'update_intent',
      patch: {
        summary: {
          line: 'Dec 12 – 20, 8 days, 2 stops',
          badge: { text: '1 day unallocated', tone: 'attention' },
          strip: [
            { label: 'Tokyo', ai: false },
            { label: 'Kyoto', ai: false },
          ],
        },
      },
      origin: 'derived',
    },
  ]);
});

test('once the days add up again, the insight is removed', () => {
  const staged = applyOps(before, shorten, LATER);
  const withInsight = applyOps(
    staged,
    deriveTrip(staged, TRIP_ID, findShortenedPlace(before, shorten), idSequence()),
    LATER,
  );
  const restore = [
    {
      op: 'update_object',
      id: TOKYO_ID,
      patch: { data: { ...tokyoData, days: 4 } },
      origin: 'direct',
    },
  ];
  const ops = deriveTrip(applyOps(withInsight, restore, LATER), TRIP_ID, null, idSequence());

  assert.deepEqual(
    ops.map((op) => op.op),
    ['update_object', 'delete_object', 'delete_relationship', 'update_intent'],
  );
  assert.equal(ops[1].id, 'b0000000-0000-4000-8000-000000000001');
  assert.deepEqual(ops[3].patch.summary.badge, { text: 'Every day planned', tone: 'ok' });
});

test('more days placed than the trip has is flagged without a fix', () => {
  const grow = [
    {
      op: 'update_object',
      id: TOKYO_ID,
      patch: { data: { ...tokyoData, days: 6 } },
      origin: 'direct',
    },
  ];
  const ops = deriveTrip(applyOps(before, grow, LATER), TRIP_ID, null, idSequence());
  const insight = ops.find((op) => op.op === 'insert_object');

  assert.equal(insight.data.text, '2 days more than the trip has');
  assert.deepEqual(insight.data.actions, []);
  assert.deepEqual(ops.at(-1).patch.summary.badge, { text: '2 days over', tone: 'attention' });
});

test('an unknown trip length opens a pinned decision, resolved once a length is set', () => {
  const { startDate, endDate, derived, ...undated } = tripData;
  const open = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [objectRow(TRIP_ID, 'trip', undated), tokyoRow, kyotoRow],
    }),
  );
  const ops = deriveTrip(open, TRIP_ID, null, idSequence());
  const decisionId = 'b0000000-0000-4000-8000-000000000001';
  const decision = ops.find((op) => op.op === 'insert_object');
  const layout = ops.find((op) => op.op === 'set_workspace');

  assert.deepEqual(decision.data, {
    question: 'How long is the trip?',
    status: 'open',
    derivedKey: 'trip.length',
  });
  assert.deepEqual(layout.doc.sections.at(-1), {
    id: `decision-${decisionId}`,
    type: 'decision',
    decisionId,
    fields: [],
    pin: 'open',
  });
  assert.deepEqual(ops.at(-1).patch.summary.badge, { text: 'Length not set', tone: 'attention' });

  const withDecision = applyOps(open, ops, LATER);
  const setLength = [
    {
      op: 'update_object',
      id: TRIP_ID,
      patch: { data: { ...undated, totalDays: 8 } },
      origin: 'direct',
    },
  ];
  const resolved = deriveTrip(
    applyOps(withDecision, setLength, LATER),
    TRIP_ID,
    null,
    idSequence(),
  );
  const closed = resolved.find((op) => op.op === 'update_object' && op.id === decisionId);

  assert.equal(closed.patch.data.status, 'resolved');
  assert.ok(
    !resolved
      .find((op) => op.op === 'set_workspace')
      .doc.sections.some((s) => s.type === 'decision'),
  );
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/derive-trip.test.mjs`
Expected: FAIL with `Cannot find module …/kinds/trip.ts`.

- [ ] **Step 6: Write `kinds/trip.ts`**

```ts
import { isDeepStrictEqual } from 'node:util';

import {
  applyOps,
  tripFigures,
  tripParts,
  type ChangesetOp,
  type DecisionData,
  type GraphObject,
  type GraphSnapshot,
  type InsightAction,
  type InsightData,
  type IntentSummary,
  type PlaceData,
  type TripData,
  type TripDerived,
} from '@nexui/types';

export const UNALLOCATED_KEY = 'trip.unallocatedDays';
export const LENGTH_KEY = 'trip.length';

/** A place the user just gave fewer days, for the "give it back" action. */
export interface ShortenedPlace {
  placeId: string;
  name: string;
  previousDays: number;
  days: number;
}

const days = (count: number): string => `${count} ${count === 1 ? 'day' : 'days'}`;

/** The first place in `ops` whose days went down, compared with `before`. */
export function findShortenedPlace(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
): ShortenedPlace | null {
  for (const op of ops) {
    if (op.op !== 'update_object' || !op.patch.data) {
      continue;
    }

    const current = before.objects.find((object) => object.id === op.id);

    if (current?.kind !== 'place') {
      continue;
    }

    const previous = (current.data as PlaceData).days;
    const next = (op.patch.data as PlaceData).days;

    if (next < previous) {
      return {
        placeId: current.id,
        name: (current.data as PlaceData).name,
        previousDays: previous,
        days: next,
      };
    }
  }

  return null;
}

const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * @example
 * formatDateRange('2026-12-12', '2026-12-20') // 'Dec 12 – 20'
 */
export function formatDateRange(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);

  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${monthDay.format(from)} – ${to.getUTCDate()}`;
  }

  return `${monthDay.format(from)} – ${monthDay.format(to)}`;
}

function linkToTrip(id: string, tripId: string, newId: () => string): ChangesetOp {
  return {
    op: 'insert_relationship',
    id: newId(),
    sourceType: 'object',
    sourceId: id,
    targetType: 'object',
    targetId: tripId,
    type: 'part_of',
    metadata: null,
    origin: 'derived',
  };
}

function removeWithLinks(staged: GraphSnapshot, object: GraphObject): ChangesetOp[] {
  const links = staged.relationships.filter(
    (edge) => edge.sourceId === object.id || edge.targetId === object.id,
  );

  return [
    { op: 'delete_object', id: object.id, origin: 'derived' },
    ...links.map((edge): ChangesetOp => ({
      op: 'delete_relationship',
      id: edge.id,
      origin: 'derived',
    })),
  ];
}

function unallocatedInsight(
  unallocated: number,
  shortened: ShortenedPlace | null,
  previous: InsightData | undefined,
): InsightData {
  if (unallocated < 0) {
    return {
      text: `${days(-unallocated)} more than the trip has`,
      detail: 'Shorten a stop or make the trip longer.',
      severity: 'attention',
      derivedKey: UNALLOCATED_KEY,
      actions: [],
    };
  }

  const actions: InsightAction[] = [
    {
      type: 'ask',
      label: 'Ask Nexui for ideas',
      prompt: `How should I use the ${days(unallocated)} I have free?`,
    },
  ];
  const giveBack: InsightAction | undefined = shortened
    ? {
        type: 'capability',
        label: `Give it back to ${shortened.name}`.slice(0, 40),
        name: 'trip.setPlaceDays',
        input: { placeId: shortened.placeId, days: shortened.previousDays },
      }
    : previous?.actions.find((action) => action.type === 'capability');

  if (giveBack) {
    actions.push(giveBack);
  }

  const insight: InsightData = {
    text: `You have ${days(unallocated)} unallocated`,
    severity: 'attention',
    derivedKey: UNALLOCATED_KEY,
    actions,
  };
  const detail = shortened
    ? `${shortened.name} went from ${shortened.previousDays} to ${days(shortened.days)}.`
    : previous?.detail;

  if (detail) {
    insight.detail = detail;
  }

  return insight;
}

function unallocatedInsightOps(
  staged: GraphSnapshot,
  tripId: string,
  figures: TripDerived,
  shortened: ShortenedPlace | null,
  newId: () => string,
): ChangesetOp[] {
  const existing = tripParts(staged, tripId).insights.find(
    (insight) => insight.data.derivedKey === UNALLOCATED_KEY,
  );
  const unallocated = figures.unallocatedDays;

  if (unallocated === null || unallocated === 0) {
    return existing ? removeWithLinks(staged, existing) : [];
  }

  const data = unallocatedInsight(
    unallocated,
    shortened,
    existing?.data as InsightData | undefined,
  );

  if (existing) {
    return isDeepStrictEqual(existing.data, data)
      ? []
      : [
          {
            op: 'update_object',
            id: existing.id,
            patch: { title: data.text, data },
            origin: 'derived',
          },
        ];
  }

  const id = newId();

  return [
    {
      op: 'insert_object',
      id,
      kind: 'insight',
      kindVersion: 1,
      title: data.text,
      status: null,
      data,
      source: { type: 'derived' },
      position: null,
      origin: 'derived',
    },
    linkToTrip(id, tripId, newId),
  ];
}

// While the length is unknown, "How long is the trip?" is an open, pinned decision.
function lengthDecisionOps(
  staged: GraphSnapshot,
  tripId: string,
  figures: TripDerived,
  newId: () => string,
): ChangesetOp[] {
  const doc = staged.workspace?.doc;
  const existing = tripParts(staged, tripId).decisions.find(
    (decision) =>
      decision.data.derivedKey === LENGTH_KEY && (decision.data as DecisionData).status === 'open',
  );

  if (figures.totalDays === null) {
    if (existing || !doc) {
      return [];
    }

    const id = newId();
    const data: DecisionData = {
      question: 'How long is the trip?',
      status: 'open',
      derivedKey: LENGTH_KEY,
    };

    return [
      {
        op: 'insert_object',
        id,
        kind: 'decision',
        kindVersion: 1,
        title: data.question,
        status: null,
        data,
        source: { type: 'derived' },
        position: null,
        origin: 'derived',
      },
      linkToTrip(id, tripId, newId),
      {
        op: 'set_workspace',
        doc: {
          ...doc,
          sections: [
            ...doc.sections,
            { id: `decision-${id}`, type: 'decision', decisionId: id, fields: [], pin: 'open' },
          ],
        },
        origin: 'derived',
      },
    ];
  }

  if (!existing) {
    return [];
  }

  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: existing.id,
      patch: { data: { ...existing.data, status: 'resolved' } },
      origin: 'derived',
    },
  ];

  if (doc) {
    ops.push({
      op: 'set_workspace',
      doc: {
        ...doc,
        sections: doc.sections.filter(
          (section) => !(section.type === 'decision' && section.decisionId === existing.id),
        ),
      },
      origin: 'derived',
    });
  }

  return ops;
}

function tripSummary(
  staged: GraphSnapshot,
  trip: GraphObject,
  figures: TripDerived,
): IntentSummary {
  const data = trip.data as TripData;
  const { places, decisions } = tripParts(staged, trip.id);
  const open = decisions.filter((decision) => (decision.data as DecisionData).status === 'open');
  const parts: string[] = [];

  if (data.startDate && data.endDate) {
    parts.push(formatDateRange(data.startDate, data.endDate));
  }

  if (figures.totalDays !== null) {
    parts.push(days(figures.totalDays));
  }

  parts.push(`${places.length} ${places.length === 1 ? 'stop' : 'stops'}`);

  if (open.length > 0) {
    parts.push(`${open.length} open ${open.length === 1 ? 'decision' : 'decisions'}`);
  }

  const summary: IntentSummary = { line: parts.join(', ').slice(0, 200) };
  const unallocated = figures.unallocatedDays;

  if (unallocated === null) {
    summary.badge = { text: 'Length not set', tone: 'attention' };
  } else if (unallocated > 0) {
    summary.badge = { text: `${days(unallocated)} unallocated`, tone: 'attention' };
  } else if (unallocated < 0) {
    summary.badge = { text: `${days(-unallocated)} over`, tone: 'attention' };
  } else if (places.length > 0) {
    summary.badge = { text: 'Every day planned', tone: 'ok' };
  }

  if (places.length > 0) {
    summary.strip = places.slice(0, 12).map((place) => ({
      label: (place.data as PlaceData).name.slice(0, 100),
      ai: place.source?.type === 'ai' && !place.source.reviewedAt,
    }));
  }

  return summary;
}

// Stages derived ops so the summary counts a decision this changeset opened or closed. The
// timestamp doesn't matter here: the staged snapshot is only read.
function applyDerived(staged: GraphSnapshot, ops: readonly ChangesetOp[]): GraphSnapshot {
  return applyOps(staged, ops, staged.intent.updatedAt);
}

/**
 * `derive.trip`: recalculates the trip's figures and everything that depends on them, as
 * derived ops for the same changeset. Deterministic; no model call (spec section B).
 */
export function deriveTrip(
  staged: GraphSnapshot,
  tripId: string,
  shortened: ShortenedPlace | null,
  newId: () => string,
): ChangesetOp[] {
  const trip = staged.objects.find((object) => object.id === tripId && object.kind === 'trip');

  if (!trip) {
    return [];
  }

  const ops: ChangesetOp[] = [];
  const figures = tripFigures(staged, tripId);

  if (!isDeepStrictEqual(trip.data.derived, figures)) {
    ops.push({
      op: 'update_object',
      id: tripId,
      patch: { data: { ...trip.data, derived: figures } },
      origin: 'derived',
    });
  }

  ops.push(...unallocatedInsightOps(staged, tripId, figures, shortened, newId));
  ops.push(...lengthDecisionOps(staged, tripId, figures, newId));

  // The summary counts the decision this changeset may have just opened or closed.
  const settled = applyDerived(staged, ops);
  const summary = tripSummary(settled, trip, figures);

  if (!isDeepStrictEqual(staged.intent.summary, summary)) {
    ops.push({ op: 'update_intent', patch: { summary }, origin: 'derived' });
  }

  return ops;
}
```

For reference: after shortening Tokyo the summary line is `'Dec 12 – 20, 8 days, 2 stops'`.
For the undated trip, the just-opened length decision is counted, so the line is
`'2 stops, 1 open decision'` with the badge `Length not set`.

- [ ] **Step 7: Write `templates/index.ts`**

```ts
import type { ChangesetOp, GraphSnapshot } from '@nexui/types';

import { deriveTrip, findShortenedPlace } from '../kinds/trip.ts';

/**
 * Runs the intent's template derivations over a staged changeset. Only travel exists in
 * slice 1; an intent with no template derives nothing.
 */
export function deriveForTemplate(
  before: GraphSnapshot,
  staged: GraphSnapshot,
  ops: readonly ChangesetOp[],
  newId: () => string,
): ChangesetOp[] {
  if (staged.intent.template !== 'travel' || !staged.workspace) {
    return [];
  }

  return deriveTrip(staged, staged.workspace.doc.anchorId, findShortenedPlace(before, ops), newId);
}
```

- [ ] **Step 8: Run the tests**

Run: `node --experimental-strip-types --test tests/travel-template.test.mjs tests/derive-trip.test.mjs`
Expected: PASS (9 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/templates apps/api/src/lib/kinds tests/travel-template.test.mjs tests/derive-trip.test.mjs
git commit -m "Add the travel template and deterministic trip derivations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Changeset preparation and commit

**Files:**

- Create: `apps/api/src/lib/graph/errors.ts`, `apps/api/src/lib/graph/snapshot.ts`,
  `apps/api/src/lib/graph/prepare.ts`, `apps/api/src/lib/graph/commit.ts`,
  `apps/api/src/lib/graph/lists.ts`.
- Test: `tests/graph-prepare.test.mjs`.

**Interfaces:**

- Consumes: `applyOps`, `GraphOpError`, `parseKindData`, `ChangesetOp`, `GraphSnapshot`,
  `Actor`, `EventRecord`, `ChangesQuery`, `ChangesResponse`, `IntentListItem` (Tasks 3–5);
  `deriveForTemplate`, `seedTravelOps` (Task 7); the mappers (Task 4); the SQL functions
  (Task 6).
- Produces:
  - `class GraphNotFoundError`, `class ChangesetInvalidError`,
    `class ChangesetConflictError`, `mapRpcError(error: { code?: string }): Error`.
  - `loadSnapshot(db: SupabaseClient, intentId: string): Promise<GraphSnapshot>`.
  - `markReviewed(before: GraphSnapshot, ops: readonly ChangesetOp[], actor: Actor, now: string): ChangesetOp[]`.
  - `validateOps(before: GraphSnapshot, ops: readonly ChangesetOp[], now: string): ChangesetOp[]`.
  - `coalesceOps(ops: readonly ChangesetOp[]): ChangesetOp[]`.
  - `prepareChangeset(before: GraphSnapshot, ops: readonly ChangesetOp[], actor: Actor, now: string, newId: () => string): ChangesetOp[]`.
  - `commitChangeset(db: SupabaseClient, input: CommitInput, clock?: Date, newId?: () => string): Promise<CommitResult>`,
    where `CommitInput = { intentId: string; actor: Actor; runId?: string | null; ops: readonly ChangesetOp[] }`
    and `CommitResult = { event: EventRecord; snapshot: GraphSnapshot }`.
  - `createIntent(db: SupabaseClient, goal: string, clock?: Date, newId?: () => string): Promise<GraphSnapshot>`.
  - `revertEvent(db: SupabaseClient, eventId: string): Promise<CommitResult>`.
  - `listIntents(db: SupabaseClient): Promise<IntentListItem[]>`.
  - `listChanges(db: SupabaseClient, query: ChangesQuery): Promise<ChangesResponse>`.

- [ ] **Step 1: Write the failing test**

`tests/graph-prepare.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChangesetInvalidError,
  mapRpcError,
  ChangesetConflictError,
  GraphNotFoundError,
} from '../apps/api/src/lib/graph/errors.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import {
  coalesceOps,
  markReviewed,
  prepareChangeset,
  validateOps,
} from '../apps/api/src/lib/graph/prepare.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import {
  idSequence,
  kyotoRow,
  LATER,
  objectRow,
  snapshotRow,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
  tripRow,
} from './support/graph.mjs';

const before = mapSnapshotRow(snapshotRow(travelWorkspace(TRIP_ID)));
const shorten = {
  op: 'update_object',
  id: TOKYO_ID,
  patch: { data: { ...tokyoData, days: 3 } },
  origin: 'direct',
};

test('prepareChangeset returns the edit and everything derived from it', () => {
  const ops = prepareChangeset(before, [shorten], 'user', LATER, idSequence());

  assert.deepEqual(
    ops.map((op) => `${op.op}:${op.origin}`),
    [
      'update_object:direct',
      'update_object:derived',
      'insert_object:derived',
      'insert_relationship:derived',
      'update_intent:derived',
    ],
  );
  assert.equal(ops[1].patch.data.derived.unallocatedDays, 1);
});

test('invalid data is rejected with the field named', () => {
  for (const days of [-1, 2.5]) {
    assert.throws(
      () => validateOps(before, [{ ...shorten, patch: { data: { ...tokyoData, days } } }], LATER),
      (error) => error instanceof ChangesetInvalidError && /days/.test(error.message),
    );
  }
});

test('ops on missing objects or unknown kinds are rejected', () => {
  assert.throws(
    () =>
      validateOps(
        before,
        [{ op: 'delete_object', id: TOKYO_ID.replace('3', '9'), origin: 'direct' }],
        LATER,
      ),
    ChangesetInvalidError,
  );
  assert.throws(
    () =>
      validateOps(
        before,
        [
          {
            op: 'insert_object',
            id: 'a1b2c3d4-0000-4000-8000-0000000000f1',
            kind: 'spaceship',
            kindVersion: 1,
            title: null,
            status: null,
            data: {},
            source: { type: 'user' },
            position: null,
            origin: 'direct',
          },
        ],
        LATER,
      ),
    /Unknown kind/,
  );
});

test('relationships may point at objects inserted earlier in the same changeset', () => {
  const id = 'a1b2c3d4-0000-4000-8000-0000000000f2';
  const ops = [
    {
      op: 'insert_object',
      id,
      kind: 'thing',
      kindVersion: 1,
      title: 'Rail pass',
      status: null,
      data: { fields: [] },
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
    {
      op: 'insert_relationship',
      id: 'a1b2c3d4-0000-4000-8000-0000000000f3',
      sourceType: 'object',
      sourceId: id,
      targetType: 'object',
      targetId: TRIP_ID,
      type: 'part_of',
      metadata: null,
      origin: 'direct',
    },
  ];

  assert.equal(validateOps(before, ops, LATER).length, 2);
  assert.throws(
    () =>
      validateOps(before, [{ ...ops[1], sourceId: 'a1b2c3d4-0000-4000-8000-0000000000f9' }], LATER),
    ChangesetInvalidError,
  );
});

test('a user edit to something Nexui wrote marks it reviewed', () => {
  const aiTokyo = mapSnapshotRow(
    snapshotRow(travelWorkspace(TRIP_ID), {
      objects: [
        tripRow,
        objectRow(TOKYO_ID, 'place', tokyoData, { source: { type: 'ai' } }),
        kyotoRow,
      ],
    }),
  );

  assert.deepEqual(markReviewed(aiTokyo, [shorten], 'user', LATER)[0].patch.source, {
    type: 'ai',
    reviewedAt: LATER,
  });
  assert.equal(markReviewed(aiTokyo, [shorten], 'ai', LATER)[0].patch.source, undefined);
  assert.equal(markReviewed(before, [shorten], 'user', LATER)[0].patch.source, undefined);
});

test('coalesceOps merges changes to one row, keeping first-seen order', () => {
  const id = 'a1b2c3d4-0000-4000-8000-0000000000f4';
  const insert = {
    op: 'insert_object',
    id,
    kind: 'trip',
    kindVersion: 1,
    title: 'Trip',
    status: null,
    data: { destinations: [], currency: 'USD' },
    source: { type: 'user' },
    position: null,
    origin: 'direct',
  };
  const merged = coalesceOps([
    insert,
    { op: 'set_workspace', doc: travelWorkspace(id), origin: 'direct' },
    {
      op: 'update_object',
      id,
      patch: { data: { destinations: [], currency: 'EUR' } },
      origin: 'derived',
    },
    { op: 'set_workspace', doc: { ...travelWorkspace(id), sections: [] }, origin: 'derived' },
    { op: 'update_intent', patch: { status: 'active' }, origin: 'direct' },
    { op: 'update_intent', patch: { summary: { line: 'x' } }, origin: 'derived' },
  ]);

  assert.deepEqual(
    merged.map((op) => op.op),
    ['insert_object', 'set_workspace', 'update_intent'],
  );
  assert.equal(merged[0].data.currency, 'EUR');
  assert.equal(merged[0].origin, 'direct');
  assert.deepEqual(merged[1].doc.sections, []);
  assert.deepEqual(merged[2].patch, { status: 'active', summary: { line: 'x' } });
  assert.deepEqual(coalesceOps([insert, { op: 'delete_object', id, origin: 'direct' }]), []);
  assert.throws(
    () => coalesceOps([{ op: 'delete_object', id, origin: 'direct' }, { ...insert }]),
    ChangesetInvalidError,
  );
});

test('database error codes map to user-safe errors', () => {
  assert.ok(mapRpcError({ code: 'NXU04' }) instanceof GraphNotFoundError);
  assert.equal(
    mapRpcError({ code: 'NXU08' }).message,
    'This changed while you were editing. Try again.',
  );
  assert.equal(
    mapRpcError({ code: 'NXU09' }).message,
    "Something changed since then, so this can't be undone.",
  );
  assert.equal(mapRpcError({ code: 'NXU10' }).message, 'That was already undone.');
  assert.equal(mapRpcError({ code: '23505' }).message, 'That was already undone.');
  assert.ok(mapRpcError({ code: 'NXU08' }) instanceof ChangesetConflictError);
  assert.ok(mapRpcError({ code: 'NXU22' }) instanceof ChangesetInvalidError);
  assert.equal(
    mapRpcError({ code: 'XX000', message: 'secret' }).message,
    'Saving the change failed.',
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types --test tests/graph-prepare.test.mjs`
Expected: FAIL with `Cannot find module …/graph/errors.ts`.

- [ ] **Step 3: Write `errors.ts`**

```ts
/** The intent, event or object isn't there, or isn't the caller's. */
export class GraphNotFoundError extends Error {}

/** A changeset the graph rejects. `message` is safe to show the user. */
export class ChangesetInvalidError extends Error {}

/** Something changed underneath the request. `message` is safe to show the user. */
export class ChangesetConflictError extends Error {}

/**
 * Maps a Postgres error from the graph functions to one of the errors above. Unknown errors
 * get a generic message; the original is never shown.
 */
export function mapRpcError(error: { code?: string }): Error {
  switch (error.code) {
    case 'NXU04':
      return new GraphNotFoundError('Not found.');
    case 'NXU08':
      return new ChangesetConflictError('This changed while you were editing. Try again.');
    case 'NXU09':
      return new ChangesetConflictError("Something changed since then, so this can't be undone.");
    case 'NXU10':
    case '23505':
      return new ChangesetConflictError('That was already undone.');
    case 'NXU22':
      return new ChangesetInvalidError('That change is not valid.');
    default:
      return new Error('Saving the change failed.');
  }
}
```

- [ ] **Step 4: Write `prepare.ts`**

```ts
import {
  applyOps,
  GraphOpError,
  parseKindData,
  type Actor,
  type ChangesetOp,
  type GraphSnapshot,
} from '@nexui/types';

import { deriveForTemplate } from '../templates/index.ts';
import { ChangesetInvalidError } from './errors.ts';

/** A user's edit to something Nexui wrote clears its highlighter (spec section D). */
export function markReviewed(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  actor: Actor,
  now: string,
): ChangesetOp[] {
  if (actor !== 'user') {
    return [...ops];
  }

  return ops.map((op) => {
    if (op.op !== 'update_object') {
      return op;
    }

    const source = before.objects.find((object) => object.id === op.id)?.source;

    if (source?.type !== 'ai' || source.reviewedAt) {
      return op;
    }

    return { ...op, patch: { ...op.patch, source: { ...source, reviewedAt: now } } };
  });
}

function checkEndpoint(snapshot: GraphSnapshot, type: 'object' | 'intent', id: string): void {
  const exists =
    type === 'intent'
      ? id === snapshot.intent.id
      : snapshot.objects.some((object) => object.id === id);

  if (!exists) {
    throw new ChangesetInvalidError('That link points at something that no longer exists.');
  }
}

function checkData(kind: string, data: unknown): Record<string, unknown> {
  const parsed = parseKindData(kind, data);

  if (!parsed.ok) {
    throw new ChangesetInvalidError(parsed.message);
  }

  return parsed.data;
}

// A workspace doc may name objects inserted later in the same changeset, so its references
// are checked against the fully staged snapshot.
function checkWorkspace(snapshot: GraphSnapshot): void {
  const doc = snapshot.workspace?.doc;

  if (!doc) {
    return;
  }

  checkEndpoint(snapshot, 'object', doc.anchorId);

  for (const section of doc.sections) {
    if (section.type === 'decision') {
      checkEndpoint(snapshot, 'object', section.decisionId);
    }
  }
}

/**
 * Checks each op against the snapshot as it would be after the ops before it, and validates
 * object data against the kind registry. Returns the ops with their data as parsed.
 */
export function validateOps(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
): ChangesetOp[] {
  let running = before;
  const valid: ChangesetOp[] = [];

  for (const op of ops) {
    let checked: ChangesetOp = op;

    switch (op.op) {
      case 'insert_object':
        checked = { ...op, data: checkData(op.kind, op.data) };
        break;
      case 'update_object': {
        const current = running.objects.find((object) => object.id === op.id);

        if (!current) {
          throw new ChangesetInvalidError('That item no longer exists.');
        }

        if (op.patch.data) {
          checked = { ...op, patch: { ...op.patch, data: checkData(current.kind, op.patch.data) } };
        }

        break;
      }
      case 'insert_relationship':
        checkEndpoint(running, op.sourceType, op.sourceId);
        checkEndpoint(running, op.targetType, op.targetId);
        break;
      default:
        break;
    }

    try {
      running = applyOps(running, [checked], now);
    } catch (error) {
      if (error instanceof GraphOpError) {
        throw new ChangesetInvalidError('That item no longer exists.');
      }

      throw error;
    }

    valid.push(checked);
  }

  if (ops.some((op) => op.op === 'set_workspace')) {
    checkWorkspace(running);
  }

  return valid;
}

function rowKey(op: ChangesetOp): string {
  switch (op.op) {
    case 'insert_object':
    case 'update_object':
    case 'delete_object':
      return `objects:${op.id}`;
    case 'insert_relationship':
    case 'delete_relationship':
      return `relationships:${op.id}`;
    case 'set_workspace':
      return 'workspaces';
    case 'update_intent':
      return 'intents';
  }
}

const mergedOrigin = (a: ChangesetOp, b: ChangesetOp): 'direct' | 'derived' =>
  a.origin === 'direct' || b.origin === 'direct' ? 'direct' : 'derived';

// Combines two ops on the same row, or returns null when they cancel out.
function merge(first: ChangesetOp, next: ChangesetOp): ChangesetOp | null {
  const origin = mergedOrigin(first, next);

  if (first.op === 'insert_object' && next.op === 'update_object') {
    return { ...first, ...next.patch, origin };
  }

  if (first.op === 'update_object' && next.op === 'update_object') {
    return { ...first, patch: { ...first.patch, ...next.patch }, origin };
  }

  if (first.op === 'update_object' && next.op === 'delete_object') {
    return { ...next, origin };
  }

  if (
    (first.op === 'insert_object' && next.op === 'delete_object') ||
    (first.op === 'insert_relationship' && next.op === 'delete_relationship')
  ) {
    return null;
  }

  if (first.op === 'set_workspace' && next.op === 'set_workspace') {
    return { ...next, origin };
  }

  if (first.op === 'update_intent' && next.op === 'update_intent') {
    return { ...first, patch: { ...first.patch, ...next.patch }, origin };
  }

  throw new ChangesetInvalidError('Conflicting changes to one item.');
}

/** One op per row, as `apply_changeset` requires, in the order each row first appears. */
export function coalesceOps(ops: readonly ChangesetOp[]): ChangesetOp[] {
  const byRow = new Map<string, ChangesetOp | null>();

  for (const op of ops) {
    const key = rowKey(op);

    if (!byRow.has(key)) {
      byRow.set(key, op);
      continue;
    }

    const first = byRow.get(key);

    if (first === null || first === undefined) {
      throw new ChangesetInvalidError('Conflicting changes to one item.');
    }

    byRow.set(key, merge(first, op));
  }

  return [...byRow.values()].filter((op): op is ChangesetOp => op !== null);
}

/**
 * Turns requested ops into the full changeset to commit: marks reviews, validates, runs the
 * template's derivations on the staged result, merges per row, and validates the whole again.
 * Pure, so tests can check exactly what reaches the database.
 */
export function prepareChangeset(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
  actor: Actor,
  now: string,
  newId: () => string,
): ChangesetOp[] {
  const valid = validateOps(before, markReviewed(before, ops, actor, now), now);
  const staged = applyOps(before, valid, now);
  const derived = deriveForTemplate(before, staged, valid, newId);

  return validateOps(before, coalesceOps([...valid, ...derived]), now);
}
```

- [ ] **Step 5: Write `snapshot.ts`, `commit.ts` and `lists.ts`**

`snapshot.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GraphSnapshot } from '@nexui/types';

import { GraphNotFoundError, mapRpcError } from './errors.ts';
import { mapSnapshotRow } from './mappers.ts';

/** One intent with its workspace and live objects and relationships, read as the user. */
export async function loadSnapshot(db: SupabaseClient, intentId: string): Promise<GraphSnapshot> {
  const { data, error } = await db.rpc('get_intent_snapshot', { p_intent_id: intentId });

  if (error) {
    throw mapRpcError(error);
  }

  if (!data) {
    throw new GraphNotFoundError('Not found.');
  }

  return mapSnapshotRow(data);
}
```

`commit.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor, ChangesetOp, EventRecord, GraphSnapshot } from '@nexui/types';

import { seedTravelOps } from '../templates/travel.ts';
import { GraphNotFoundError, mapRpcError } from './errors.ts';
import { mapEventRow } from './mappers.ts';
import { prepareChangeset } from './prepare.ts';
import { loadSnapshot } from './snapshot.ts';

export interface CommitInput {
  intentId: string;
  actor: Actor;
  runId?: string | null;
  ops: readonly ChangesetOp[];
}

export interface CommitResult {
  event: EventRecord;
  snapshot: GraphSnapshot;
}

/**
 * Validates, derives and commits a changeset in one database transaction, then returns the
 * logged event and the intent as it now is.
 */
export async function commitChangeset(
  db: SupabaseClient,
  input: CommitInput,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<CommitResult> {
  const before = await loadSnapshot(db, input.intentId);
  const ops = prepareChangeset(before, input.ops, input.actor, clock.toISOString(), newId);
  const { data, error } = await db.rpc('apply_changeset', {
    p_intent_id: input.intentId,
    p_actor: input.actor,
    p_run_id: input.runId ?? null,
    p_ops: ops,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return { event: mapEventRow(data), snapshot: await loadSnapshot(db, input.intentId) };
}

/**
 * Creates a travel intent with its seed trip, workspace and derived state in one transaction.
 * Slice 1 has one template; the intelligence plan routes goals with Jev.
 */
export async function createIntent(
  db: SupabaseClient,
  goal: string,
  clock: Date = new Date(),
  newId: () => string = randomUUID,
): Promise<GraphSnapshot> {
  const now = clock.toISOString();
  const intentId = newId();
  const empty: GraphSnapshot = {
    intent: {
      id: intentId,
      goal,
      template: 'travel',
      status: 'exploring',
      context: {},
      summary: { line: '' },
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    },
    workspace: null,
    objects: [],
    relationships: [],
  };
  const ops = prepareChangeset(empty, seedTravelOps(goal, newId), 'system', now, newId);
  const { error } = await db.rpc('create_intent', {
    p_intent_id: intentId,
    p_goal: goal,
    p_template: 'travel',
    p_ops: ops,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return loadSnapshot(db, intentId);
}

/** Undo (or Redo, on an Undo event): restores each row's earlier values. */
export async function revertEvent(db: SupabaseClient, eventId: string): Promise<CommitResult> {
  const { data, error } = await db.rpc('revert_event', { p_event_id: eventId });

  if (error) {
    throw mapRpcError(error);
  }

  const event = mapEventRow(data);

  if (!event.intentId) {
    throw new GraphNotFoundError('Not found.');
  }

  return { event, snapshot: await loadSnapshot(db, event.intentId) };
}
```

`lists.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangesQuery, ChangesResponse, IntentListItem } from '@nexui/types';

import { mapRpcError } from './errors.ts';
import { mapChangeRow, mapIntentListRow } from './mappers.ts';

/** Home's cards: the user's intents that aren't archived, most recently active first. */
export async function listIntents(db: SupabaseClient): Promise<IntentListItem[]> {
  const { data, error } = await db
    .from('intents')
    .select('id, goal, template, status, summary, last_activity_at')
    .neq('status', 'archived')
    .order('last_activity_at', { ascending: false })
    .limit(100);

  if (error) {
    throw mapRpcError(error);
  }

  return (data ?? []).map(mapIntentListRow);
}

/** One page of Changes, newest first. A full page means there may be more. */
export async function listChanges(
  db: SupabaseClient,
  query: ChangesQuery,
): Promise<ChangesResponse> {
  const { data, error } = await db.rpc('changes_page', {
    p_limit: query.limit,
    p_before_seq: query.cursor ?? null,
    p_intent_id: query.intentId ?? null,
  });

  if (error) {
    throw mapRpcError(error);
  }

  const items = ((data ?? []) as unknown[]).map(mapChangeRow);
  const last = items.at(-1);

  return {
    items,
    nextCursor: items.length === query.limit && last ? String(last.seq) : null,
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `node --experimental-strip-types --test tests/graph-prepare.test.mjs`
Expected: PASS (8 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/graph tests/graph-prepare.test.mjs
git commit -m "Prepare, commit and revert changesets through the graph functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: API routes

**Files:**

- Create: `apps/api/src/lib/graph/respond.ts`, `apps/api/src/app/api/intents/route.ts`,
  `apps/api/src/app/api/intents/[id]/route.ts`,
  `apps/api/src/app/api/intents/[id]/changesets/route.ts`,
  `apps/api/src/app/api/events/[id]/undo/route.ts`,
  `apps/api/src/app/api/changes/route.ts`.
- Test: `tests/support/graph-api.mjs`, `tests/intents-route.test.mjs`,
  `tests/intent-snapshot-route.test.mjs`, `tests/changesets-route.test.mjs`,
  `tests/event-undo-route.test.mjs`, `tests/changes-route.test.mjs`.

**Interfaces:**

- Consumes: `createIntent`, `commitChangeset`, `revertEvent`, `loadSnapshot`, `listIntents`,
  `listChanges`, the error classes (Task 8); `fromUserOps` and the API schemas (Task 3).
- Produces (HTTP, all need `Authorization: Bearer <token>`):
  - `GET /api/intents` → `{ items: IntentListItem[] }`.
  - `POST /api/intents` `{ goal }` → 201 `GraphSnapshot`.
  - `GET /api/intents/:id` → `GraphSnapshot`.
  - `POST /api/intents/:id/changesets` `{ ops: UserOp[] }` → `{ event, snapshot }`.
  - `POST /api/events/:id/undo` → `{ event, snapshot }` (Redo: call it on the Undo event).
  - `GET /api/changes?limit&cursor&intentId` → `{ items: ChangeItem[], nextCursor }`.
  - Errors: 400 invalid, 401 signed out, 404 not found, 409 conflict, 500 generic.

- [ ] **Step 1: Write the RPC test helper**

`tests/support/graph-api.mjs`:

```js
import { signToken } from './supabase-auth.mjs';

/**
 * A PostgREST stand-in: routes `/rest/v1/rpc/<name>` to `handlers[name](args)` and table reads
 * to `handlers['table:<name>'](url)`. A handler returns a value (sent as JSON) or a Response.
 */
export function postgrest(handlers) {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    const key = rpc ? rpc[1] : `table:${url.pathname.replace('/rest/v1/', '')}`;
    const handler = handlers[key];

    if (!handler) {
      return Response.json({ message: `unexpected ${key}` }, { status: 500 });
    }

    const args = rpc && init?.body ? JSON.parse(init.body) : url;
    const result = await handler(args);

    return result instanceof Response ? result : Response.json(result);
  };
}

/** A PostgREST error body with a SQLSTATE, as supabase-js reads it. */
export function pgError(code, status = 400) {
  return Response.json({ code, message: 'internal detail', details: null, hint: null }, { status });
}

export function authed(url, init = {}) {
  return new Request(url, {
    ...init,
    headers: { Authorization: `Bearer ${signToken()}`, ...(init.headers ?? {}) },
  });
}
```

- [ ] **Step 2: Write the failing route tests**

`tests/intents-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, OPTIONS, POST } from '../apps/api/src/app/api/intents/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { intentRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const url = 'http://localhost/api/intents';

test('the preflight allows GET and POST', () => {
  assert.equal(OPTIONS().headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
});

test('listing requires a token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(new Request(url))).status, 401);
});

test('Home lists intents, most recent first', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      'table:intents': (query) => {
        asked = query;

        return [intentRow];
      },
    }),
  );

  const response = await GET(authed(url));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: intentRow.id,
        goal: intentRow.goal,
        template: 'travel',
        status: 'exploring',
        summary: intentRow.summary,
        lastActivityAt: intentRow.last_activity_at,
      },
    ],
  });
  assert.equal(asked.searchParams.get('status'), 'neq.archived');
  assert.equal(asked.searchParams.get('order'), 'last_activity_at.desc');
});

test('creating an intent seeds the trip in one call and returns the snapshot', async (t) => {
  let created;

  mockSupabaseAuth(
    t,
    postgrest({
      create_intent: (args) => {
        created = args;

        return {};
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
    }),
  );

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: '  Plan Japan in December ' }) }),
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).intent.goal, 'Plan Japan in December');
  assert.equal(created.p_goal, 'Plan Japan in December');
  assert.equal(created.p_template, 'travel');
  assert.deepEqual(
    created.p_ops.map((op) => op.op),
    ['insert_object', 'set_workspace', 'insert_object', 'insert_relationship', 'update_intent'],
  );
});

test('a goal must be 3 to 500 characters', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'hi' }) }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    'Describe what you are planning in 3 to 500 characters.',
  );
});

test('a database failure returns a safe 500', async (t) => {
  mockSupabaseAuth(t, postgrest({ create_intent: () => pgError('XX000', 500) }));

  const response = await POST(
    authed(url, { method: 'POST', body: JSON.stringify({ goal: 'Plan Japan' }) }),
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
});
```

`tests/intent-snapshot-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/intents/[id]/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, postgrest } from './support/graph-api.mjs';
import { INTENT_ID, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = (id) => ({ params: Promise.resolve({ id }) });

test('the snapshot comes back in contract shape', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: (args) => {
        asked = args;

        return snapshotRow(travelWorkspace(TRIP_ID));
      },
    }),
  );

  const response = await GET(
    authed(`http://localhost/api/intents/${INTENT_ID}`),
    context(INTENT_ID),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_intent_id: INTENT_ID });
  assert.equal(body.objects.length, 3);
  assert.equal(body.workspace.doc.anchorId, TRIP_ID);
});

test('a missing or foreign intent is 404, and so is a bad id', async (t) => {
  mockSupabaseAuth(t, postgrest({ get_intent_snapshot: () => null }));

  assert.equal((await GET(authed('http://localhost/x'), context(INTENT_ID))).status, 404);
  assert.equal((await GET(authed('http://localhost/x'), context('nope'))).status, 404);
});
```

`tests/changesets-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intents/[id]/changesets/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import {
  eventRow,
  INTENT_ID,
  snapshotRow,
  STAMP,
  TOKYO_ID,
  tokyoData,
  TRIP_ID,
} from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = { params: Promise.resolve({ id: INTENT_ID }) };
const url = `http://localhost/api/intents/${INTENT_ID}/changesets`;
const shorten = {
  op: 'update_object',
  id: TOKYO_ID,
  expectedUpdatedAt: STAMP,
  patch: { data: { ...tokyoData, days: 3 } },
};

function send(ops) {
  return POST(authed(url, { method: 'POST', body: JSON.stringify({ ops }) }), context);
}

test('an edit commits with its derived ops and returns the event and snapshot', async (t) => {
  let applied;

  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: (args) => {
        applied = args;

        return eventRow;
      },
    }),
  );

  const response = await send([shorten]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.event.seq, 42);
  assert.equal(applied.p_actor, 'user');
  assert.equal(applied.p_run_id, null);
  assert.deepEqual(applied.p_ops[0], { ...shorten, origin: 'direct' });
  assert.equal(applied.p_ops.at(-1).op, 'update_intent');
});

test('invalid domain data is a 400 that names the field, and nothing is written', async (t) => {
  const upstream = mockSupabaseAuth(
    t,
    postgrest({ get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)) }),
  );

  for (const days of [-1, 2.5]) {
    const response = await send([{ ...shorten, patch: { data: { ...tokyoData, days } } }]);

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /days/);
  }

  const calls = upstream.mock.calls.map((call) => String(call.arguments[0]));

  assert.ok(!calls.some((call) => call.includes('apply_changeset')));
});

test('server-owned fields are refused before anything is loaded', async (t) => {
  const upstream = mockSupabaseAuth(t);

  for (const ops of [
    [{ ...shorten, origin: 'derived' }],
    [{ ...shorten, patch: { source: { type: 'ai' } } }],
    [{ op: 'update_intent', patch: { status: 'active' } }],
    [{ op: 'set_workspace', doc: travelWorkspace(TRIP_ID) }],
    [],
  ]) {
    const response = await send(ops);

    assert.equal(response.status, 400, JSON.stringify(ops));
    assert.equal((await response.json()).error, 'That change is not valid.');
  }

  assert.equal(upstream.mock.callCount(), 0);
});

test('a stale edit is a 409 with a readable message', async (t) => {
  mockSupabaseAuth(
    t,
    postgrest({
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
      apply_changeset: () => pgError('NXU08'),
    }),
  );

  const response = await send([shorten]);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'This changed while you were editing. Try again.');
});

test('an unknown intent is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ get_intent_snapshot: () => null }));

  assert.equal((await send([shorten])).status, 404);
});

test('bad JSON is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await POST(authed(url, { method: 'POST', body: '{' }), context);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid JSON');
});
```

`tests/event-undo-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/events/[id]/undo/route.ts';
import { travelWorkspace } from '../apps/api/src/lib/templates/travel.ts';
import { authed, pgError, postgrest } from './support/graph-api.mjs';
import { EVENT_ID, eventRow, snapshotRow, TRIP_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const context = (id) => ({ params: Promise.resolve({ id }) });
const undoRow = {
  ...eventRow,
  id: 'a1b2c3d4-0000-4000-8000-000000000008',
  seq: 43,
  reverts_event_id: EVENT_ID,
};

function undo(id = EVENT_ID) {
  return POST(authed(`http://localhost/api/events/${id}/undo`, { method: 'POST' }), context(id));
}

test('undo reverts the event and returns the new event and snapshot', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      revert_event: (args) => {
        asked = args;

        return undoRow;
      },
      get_intent_snapshot: () => snapshotRow(travelWorkspace(TRIP_ID)),
    }),
  );

  const response = await undo();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_event_id: EVENT_ID });
  assert.equal(body.event.revertsEventId, EVENT_ID);
});

test('a row changed since, or a second undo, is a 409', async (t) => {
  for (const [code, message] of [
    ['NXU09', "Something changed since then, so this can't be undone."],
    ['NXU10', 'That was already undone.'],
    ['23505', 'That was already undone.'],
  ]) {
    t.mock.restoreAll();
    mockSupabaseAuth(t, postgrest({ revert_event: () => pgError(code) }));

    const response = await undo();

    assert.equal(response.status, 409, code);
    assert.equal((await response.json()).error, message);
  }
});

test('an unknown event or bad id is a 404', async (t) => {
  mockSupabaseAuth(t, postgrest({ revert_event: () => pgError('NXU04') }));

  assert.equal((await undo()).status, 404);
  assert.equal((await undo('nope')).status, 404);
});
```

`tests/changes-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/changes/route.ts';
import { authed, postgrest } from './support/graph-api.mjs';
import { eventRow, INTENT_ID } from './support/graph.mjs';
import { mockSupabaseAuth } from './support/supabase-auth.mjs';

const change = { ...eventRow, intent_goal: 'Plan Japan in December', reverted_by_event_id: null };

test('a page of changes with its cursor', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      changes_page: (args) => {
        asked = args;

        return [change];
      },
    }),
  );

  const response = await GET(authed(`http://localhost/api/changes?limit=1&intentId=${INTENT_ID}`));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(asked, { p_limit: 1, p_before_seq: null, p_intent_id: INTENT_ID });
  assert.equal(body.items[0].intentGoal, 'Plan Japan in December');
  assert.equal(body.nextCursor, '42');
});

test('a short page has no cursor, and the cursor is passed through', async (t) => {
  let asked;

  mockSupabaseAuth(
    t,
    postgrest({
      changes_page: (args) => {
        asked = args;

        return [change];
      },
    }),
  );

  const body = await (await GET(authed('http://localhost/api/changes?cursor=99'))).json();

  assert.equal(asked.p_before_seq, '99');
  assert.equal(asked.p_limit, 50);
  assert.equal(body.nextCursor, null);
});

test('a bad query is a 400', async (t) => {
  mockSupabaseAuth(t);

  const response = await GET(authed('http://localhost/api/changes?limit=500'));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid changes query.');
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --experimental-strip-types --test tests/intents-route.test.mjs tests/intent-snapshot-route.test.mjs tests/changesets-route.test.mjs tests/event-undo-route.test.mjs tests/changes-route.test.mjs`
Expected: FAIL with `Cannot find module …/api/intents/route.ts` (and the others).

- [ ] **Step 4: Write the routes**

All five map graph errors the same way, through one helper in `lib/graph`. Create
`apps/api/src/lib/graph/respond.ts`:

```ts
import { jsonError } from '../http/responses.ts';
import { SupabaseConfigurationError } from '../supabase/clients.ts';
import { ChangesetConflictError, ChangesetInvalidError, GraphNotFoundError } from './errors.ts';

/**
 * The response for an error from the graph code: 404, 400 or 409 with the error's user-safe
 * message, or a logged 500 with `fallback` for anything else.
 *
 * @example
 * return graphErrorResponse(error, '[changes]', 'Could not load changes', headers);
 */
export function graphErrorResponse(
  error: unknown,
  tag: string,
  fallback: string,
  headers: HeadersInit,
): Response {
  if (error instanceof GraphNotFoundError) {
    return jsonError('Not found.', 404, headers);
  }

  if (error instanceof ChangesetInvalidError) {
    return jsonError(error.message, 400, headers);
  }

  if (error instanceof ChangesetConflictError) {
    return jsonError(error.message, 409, headers);
  }

  console.error(
    tag,
    error instanceof SupabaseConfigurationError ? error.message : `${fallback} failed.`,
  );

  return jsonError(`${fallback}. Try again.`, 500, headers);
}
```

`apps/api/src/app/api/intents/route.ts`:

```ts
import {
  createIntentRequestSchema,
  graphSnapshotSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { createIntent } from '../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../lib/graph/respond.ts';
import { listIntents } from '../../../lib/graph/lists.ts';
import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getUserClient } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Home's cards. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const items = await listIntents(getUserClient(user.accessToken));

    return Response.json(intentListResponseSchema.parse({ items }), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not load your plans', headers);
  }
}

/** Starts a plan from a goal: the travel template's trip, workspace and derived state. */
export async function POST(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = createIntentRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError('Describe what you are planning in 3 to 500 characters.', 400, headers);
  }

  try {
    const snapshot = await createIntent(getUserClient(user.accessToken), parsed.data.goal);

    return Response.json(graphSnapshotSchema.parse(snapshot), { status: 201, headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
}
```

`apps/api/src/app/api/intents/[id]/route.ts`:

```ts
import { graphSnapshotSchema, idSchema } from '@nexui/types';

import { graphErrorResponse } from '../../../../lib/graph/respond.ts';
import { loadSnapshot } from '../../../../lib/graph/snapshot.ts';
import { corsHeaders, jsonError, preflight } from '../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

interface IntentRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/** One intent with its workspace, objects and relationships. */
export async function GET(request: Request, { params }: IntentRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const snapshot = await loadSnapshot(getUserClient(user.accessToken), id);

    return Response.json(graphSnapshotSchema.parse(snapshot), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intent]', 'Could not load that plan', headers);
  }
}
```

`apps/api/src/app/api/intents/[id]/changesets/route.ts`:

```ts
import { changesetRequestSchema, commitResponseSchema, fromUserOps, idSchema } from '@nexui/types';

import { commitChangeset } from '../../../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

interface ChangesetRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * The user's direct edits (for example a place's days). Derived changes ride in the same
 * changeset; the response carries the logged event and the updated intent.
 */
export async function POST(request: Request, { params }: ChangesetRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = changesetRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError('That change is not valid.', 400, headers);
  }

  try {
    const result = await commitChangeset(getUserClient(user.accessToken), {
      intentId: id,
      actor: 'user',
      ops: fromUserOps(parsed.data.ops),
    });

    return Response.json(commitResponseSchema.parse(result), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[changesets]', 'Could not save that change', headers);
  }
}
```

`apps/api/src/app/api/events/[id]/undo/route.ts`:

```ts
import { commitResponseSchema, idSchema } from '@nexui/types';

import { revertEvent } from '../../../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization']);

interface UndoRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Undo a changeset. Redo is this same call on the Undo's own event. */
export async function POST(request: Request, { params }: UndoRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const result = await revertEvent(getUserClient(user.accessToken), id);

    return Response.json(commitResponseSchema.parse(result), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[undo]', 'Could not undo', headers);
  }
}
```

`apps/api/src/app/api/changes/route.ts`:

```ts
import { changesQuerySchema, changesResponseSchema } from '@nexui/types';

import { graphErrorResponse } from '../../../lib/graph/respond.ts';
import { listChanges } from '../../../lib/graph/lists.ts';
import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getUserClient } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

/** The Changes feed: every changeset and Undo, newest first. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const search = new URL(request.url).searchParams;
  const parsed = changesQuerySchema.safeParse({
    limit: search.get('limit') ?? undefined,
    cursor: search.get('cursor') ?? undefined,
    intentId: search.get('intentId') ?? undefined,
  });

  if (!parsed.success) {
    return jsonError('Invalid changes query.', 400, headers);
  }

  try {
    const page = await listChanges(getUserClient(user.accessToken), parsed.data);

    return Response.json(changesResponseSchema.parse(page), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[changes]', 'Could not load changes', headers);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `node --experimental-strip-types --test tests/intents-route.test.mjs tests/intent-snapshot-route.test.mjs tests/changesets-route.test.mjs tests/event-undo-route.test.mjs tests/changes-route.test.mjs`
Expected: PASS (21 tests).
Run: `pnpm fix && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass.

- [ ] **Step 6: Review the API change**

Dispatch the `api-reviewer` and `security-reviewer` agents on the branch diff for
`apps/api`, `packages/types` and `supabase/`. Fix every finding they confirm, re-run the
checks from Step 5, and note in the commit message anything deliberately left.

- [ ] **Step 7: Commit**

```bash
git add apps/api tests
git commit -m "Add intent, changeset, undo and changes routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs and configuration

**Files:**

- Create: `docs/architecture/intent-graph.md`, `scripts/smoke-intent-graph.mjs`.
- Modify: `AGENTS.md`, `README.md`, `apps/api/.env.example`, `turbo.json`,
  `.claude/agents/api-reviewer.md` and `.claude/agents/security-reviewer.md` (only where they
  name deleted files).

- [ ] **Step 1: Write the live smoke script**

`scripts/smoke-intent-graph.mjs` (used in Task 11 and by later plans):

```js
#!/usr/bin/env node
/**
 * Exercises the intent graph API end to end as the QA user: create a trip, shorten a stop,
 * check the derived insight, undo, redo, and read Changes. Needs the API running and a QA
 * session from `node scripts/qa-session.mjs > .qa/session.json`.
 *
 * node scripts/smoke-intent-graph.mjs [.qa/session.json] [http://localhost:3000]
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [sessionPath = '.qa/session.json', api = 'http://localhost:3000'] = process.argv.slice(2);
const { session } = JSON.parse(readFileSync(sessionPath, 'utf8'));
const headers = {
  Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json',
};

async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

const created = await call('POST', '/api/intents', { goal: 'Smoke test: a weekend in Chicago' });
const intentId = created.intent.id;
const tripId = created.workspace.doc.anchorId;
const trip = created.objects.find((o) => o.id === tripId);

console.log(
  `created ${intentId}: "${created.intent.summary.line}" ${created.intent.summary.badge?.text}`,
);
assert.ok(
  created.objects.some((o) => o.kind === 'decision'),
  'an open length decision',
);

// Give the trip dates and two places: 3 days, 2 + 1 allocated.
const loopId = randomUUID();
const hydeId = randomUUID();
const place = (id, name, lat, lng, days, position) => ({
  op: 'insert_object',
  id,
  kind: 'place',
  title: name,
  data: { name, country: 'US', placeType: 'area', lat, lng, days },
  position,
});
const link = (sourceId) => ({
  op: 'insert_relationship',
  id: randomUUID(),
  sourceType: 'object',
  sourceId,
  targetType: 'object',
  targetId: tripId,
  type: 'part_of',
});
const planned = await call('POST', `/api/intents/${intentId}/changesets`, {
  ops: [
    {
      op: 'update_object',
      id: tripId,
      patch: { data: { ...trip.data, startDate: '2026-10-17', endDate: '2026-10-20' } },
    },
    place(loopId, 'The Loop', 41.88, -87.63, 2, 1),
    link(loopId),
    place(hydeId, 'Hyde Park', 41.79, -87.59, 1, 2),
    link(hydeId),
  ],
});

console.log(
  `planned: "${planned.snapshot.intent.summary.line}" ${planned.snapshot.intent.summary.badge?.text}`,
);
assert.equal(planned.snapshot.intent.summary.badge?.text, 'Every day planned');

const loop = planned.snapshot.objects.find((o) => o.id === loopId);
const shortened = await call('POST', `/api/intents/${intentId}/changesets`, {
  ops: [
    {
      op: 'update_object',
      id: loopId,
      expectedUpdatedAt: loop.updatedAt,
      patch: { data: { ...loop.data, days: 1 } },
    },
  ],
});
const insight = shortened.snapshot.objects.find((o) => o.kind === 'insight');

console.log(`shortened: insight "${insight?.data.text}" / ${insight?.data.detail}`);
assert.equal(insight?.data.text, 'You have 1 day unallocated');

const undone = await call('POST', `/api/events/${shortened.event.id}/undo`);

assert.ok(!undone.snapshot.objects.some((o) => o.kind === 'insight'), 'undo removes the insight');
console.log('undone: insight gone');

const redone = await call('POST', `/api/events/${undone.event.id}/undo`);

assert.ok(
  redone.snapshot.objects.some((o) => o.kind === 'insight'),
  'redo brings it back',
);
console.log('redone: insight back');

const changes = await call('GET', `/api/changes?intentId=${intentId}`);

console.log(`changes: ${changes.items.length} events, newest ${changes.items[0]?.actor}`);
assert.equal(changes.items.length, 5);
assert.equal(changes.items[1].revertedByEventId, redone.event.id);
console.log('smoke test passed');
```

- [ ] **Step 2: Write `docs/architecture/intent-graph.md`**

Write a short guide (about 120–200 lines) with these sections, matching what this plan built.
Cite file paths; don't restate the spec:

1. **What an intent is:** a goal plus its object graph and workspace doc. Link to the spec.
2. **Tables and writers:** the six tables, clients read-only, the security definer functions
   and what each does, the `private.apply_ops` core, and error codes `NXU04/08/09/10/22` with
   their HTTP mapping.
3. **Kinds:** `packages/types/src/kinds/registry.ts`, how to add a kind (schema + registry
   entry, no migration), and `kind_version` + `upgrade`.
4. **A changeset's path:** route → `fromUserOps` → `prepareChangeset` (review marking,
   validation, staging with `applyOps`, `deriveForTemplate`, `coalesceOps`, re-validation) →
   `apply_changeset` → `{ event, snapshot }`. Include the Kyoto/Tokyo example.
5. **Undo and Redo:** `revert_event`, the conflict and already-undone rules, and Redo as
   revert of the Undo.
6. **Workspace docs:** `anchorId`, query-bound sections, the Open band pin, and
   `evaluateQuery` shared by API and mobile.
7. **Theming:** tokens in `apps/mobile/src/lib/theme.ts`, `createThemedStyles` and
   `useColors`, and the guard test.
8. **Checking it:** `supabase/tests/intent-graph-smoke.sql` and
   `scripts/smoke-intent-graph.mjs`.

- [ ] **Step 3: Update `AGENTS.md`, `README.md`, env and turbo**

`AGENTS.md`:

- Project structure: replace the `apps/api` sentence's `decision-engine` mention with
  "graph code in `src/lib/graph/`, derivations in `src/lib/kinds/`, templates in
  `src/lib/templates/`". Replace the `supabase/migrations/` bullet with: "Postgres schema, RLS
  and the graph functions (see `docs/architecture/intent-graph.md`)."
- Commands: delete the `pnpm eval:intent` line. Add
  "`node scripts/smoke-intent-graph.mjs`: exercise the graph API as the QA user (API must be
  running)."
- Agents: delete the `intent-evaluator` line.
- Skills: delete the `add-intent` line. If no skills remain, delete the "Claude Code Skills"
  section.

`README.md`: rewrite the opening paragraph to describe the intent graph ("Nexui turns what
you're trying to accomplish into a persistent object graph rendered as a workspace"). Replace
the Magic Bar, `POST /api/intent` and Jev sections with a short "API" list of the six routes
from Task 9, and point to `docs/architecture/intent-graph.md`. Remove the `decision-engine`
project-tree lines and add `src/lib/graph/`, `src/lib/kinds/`, `src/lib/templates/`.

`apps/api/.env.example`: delete the `NEXUI_INTENT_MODEL` and `NEXUI_INTENT_TIMEOUT_MS` lines
and their comments. Change the `AI_PROVIDER` comment to
`# mock or live; used from the intelligence plan onward.` and keep `AI_PROVIDER=mock` and
`AI_GATEWAY_API_KEY=`.

`turbo.json`: in `@nexui/api#dev.passThroughEnv`, remove `NEXUI_INTENT_MODEL` and
`NEXUI_INTENT_TIMEOUT_MS`.

In `.claude/agents/*.md`, replace references to deleted paths (`decision-engine`,
`records`, `intent-events`) with the new `lib/graph` paths, only where a reviewer's
checklist names them.

- [ ] **Step 4: Check the docs**

Run: `grep -rn "eval:intent\|add-intent\|decision-engine\|intent-events\|lib/records\|instant-actions.md\|persistence.md" AGENTS.md README.md apps/api/AGENTS.md .claude docs/architecture turbo.json apps/api/.env.example`
Expected: no output.
Run: `pnpm format:check && pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Document the intent graph and add a live API smoke script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Apply to Supabase and smoke-test live

This task changes the shared dev database. **Stop and ask the user before Step 2.**

- [ ] **Step 1: Ask for the reset**

Tell the user: "Next I'll reset the linked dev database (`nexui-dev`) and apply the new
intent graph migration. This deletes every existing task, event, note and log row. Reply yes
to go ahead." Wait for an explicit yes. If the answer is no, stop here and report that plan 1
is complete except for the live checks.

- [ ] **Step 2: Reset and migrate**

Run: `pnpm exec supabase db reset --linked --yes`
Expected: "Finished supabase db reset" with the single `20260927000000_intent_graph.sql`
migration applied. If the CLI still prompts or rejects `--yes`, ask the user to run
`! pnpm exec supabase db reset --linked` themselves and answer its prompt.

- [ ] **Step 3: Run the SQL smoke script**

Ask the user to paste `supabase/tests/intent-graph-smoke.sql` into the Supabase SQL editor for
`nexui-dev` and run it (it rolls back). Expected: it completes with no assertion errors.
If a `psql` connection string for the dev database is available in the environment, run
`psql "$DEV_DATABASE_URL" -f supabase/tests/intent-graph-smoke.sql` instead.

- [ ] **Step 4: Run the live API smoke test**

Run `pnpm dev:api` in the background, then:

```bash
node scripts/qa-session.mjs > .qa/session.json
node scripts/smoke-intent-graph.mjs .qa/session.json http://localhost:3000
node scripts/qa-session.mjs --revoke .qa/session.json
curl -s http://localhost:3000/api/health
```

Expected: the smoke script prints each stage and ends with `smoke test passed`; health returns
`{"status":"ok"}`. Stop the dev server.

- [ ] **Step 5: Final branch checks**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`
Expected: all pass (`pnpm build` builds Next.js and exports Expo web).
Run: `git status --short`
Expected: clean (`.qa/` is gitignored).

If Steps 2–4 changed nothing in the repo, there's nothing to commit. Report the results of
each step, including anything the user ran themselves.
