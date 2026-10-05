# nexui

Nexui turns what you're trying to accomplish into a persistent object graph, rendered as a
workspace made of registered primitives. The first slice is travel: describe a trip, and Nexui
keeps a graph of places, legs and decisions that every edit — yours or Nexui's — changes as one
undoable changeset. See [Intent graph](docs/architecture/intent-graph.md) for how it works.
Users sign in with Supabase Auth (emailed 6-digit code, native Google, or Sign in with Apple on
iOS). Setup steps are in `docs/specs/auth.md`. For the current auth flow and ownership boundaries, see
[Authentication](docs/architecture/authentication.md).

## Requirements

- Node.js 24 LTS recommended (`nvm use`); minimum 22.13.
- pnpm 10.34.5: `npm install --global pnpm@10.34.5`.
- An EAS development build on the iOS Simulator or an Android device. Native Google
  and Apple sign-in don't run in Expo Go (see "EAS builds" in `docs/specs/auth.md`). The web preview
  supports email-code sign-in only.

## Start development

From the repository root:

```bash
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
cp apps/api/.env.example apps/api/.env.local
pnpm dev
```

This starts the API on port **3000** and Expo/Metro on port **8081** through
Turborepo. Open <http://localhost:8081> for the web preview. Expo's terminal output
also provides a URL/QR code for Expo Go. For interactive Expo keyboard shortcuts,
run the apps in separate terminals:

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:mobile
```

In the Expo terminal, press `i` for iOS, `a` for Android, or `w` for web. You can
also run `pnpm dev:web` to launch the browser preview directly. Stop an existing
Expo process before starting another on port 8081.

The mobile app requests `/api/health`, validates its response with shared Zod, and
shows **Connected** or **Unreachable** on the Account tab. It rechecks every 15
seconds and offers a manual check; a banner repeats the same status on every other
tab, but only while unreachable. A small example Zustand store remains available for
future local UI state; health data lives in TanStack Query. Health requests time out
after five seconds.

## API

Six routes, all under `apps/api/src/app/api/` and bearer-authenticated (health is public):

- `GET /api/intents` — Home's cards.
- `POST /api/intents` — start a plan from a goal, seeding the travel template.
- `GET /api/intents/:id` — one intent with its workspace, objects and relationships.
- `POST /api/intents/:id/changesets` — apply a changeset; derived changes ride along with it.
- `POST /api/events/:id/undo` — Undo a changeset; the same call on the Undo's own event is Redo.
- `GET /api/changes` — the Changes feed, newest first.

See [Intent graph](docs/architecture/intent-graph.md) for how a changeset is validated, derived
and committed, and for the database and kind registry behind it.

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}

pnpm lint
pnpm fix             # ESLint autofixes, then Prettier formatting
pnpm typecheck
pnpm test
pnpm format:check
pnpm format          # apply formatting
pnpm build           # Next.js production build + Expo web export
```

`pnpm build` does not create native binaries. Native packaging can be added when
needed. All workspaces are private, and shared TypeScript source is consumed
directly by Next.js and Expo, so no separate package build/watch process is needed.

Control statements always use braces and multiline bodies, even for one-statement
guards. `pnpm lint` enforces braces; `pnpm fix` adds missing braces and formats them.
Use `pnpm lint:fix` for ESLint fixes alone.

In VS Code, open the repository root and install the recommended ESLint and Prettier
extensions. The checked-in workspace settings apply ESLint fixes and Prettier formatting
on explicit save, with ESLint configured for each workspace. Agent conventions live in
`AGENTS.md`; `CLAUDE.md` imports them for Claude Code.

## Device networking and environment

`apps/mobile/.env` contains only public app configuration:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

| Preview target                       | API URL                              |
| ------------------------------------ | ------------------------------------ |
| Browser or iOS simulator on this Mac | `http://localhost:3000`              |
| Android Studio emulator              | `http://10.0.2.2:3000`               |
| Physical phone                       | `http://<your-computer-LAN-IP>:3000` |

For a phone, put both devices on the same network and allow port 3000 through the
computer's firewall. The API binds to `0.0.0.0` for LAN access. `localhost` on a
phone refers to the phone itself. Expo tunneling does not tunnel the API; an API
URL reachable from the device is still required. Restart Expo after changing env.

Supabase, Google and Apple values are required for sign-in; the `.env.example` files
list them. The mobile app gets only the publishable key. `SUPABASE_SECRET_KEY` lives only
in `apps/api/.env.local`, where AI runs, account deletion and the place media cache and
photo bucket use it. The `APPLE_*` values live there too; account deletion uses them to
revoke Apple access.
`CRON_SECRET`, also API-only, authorizes Vercel's cron call to `GET /api/cron/runs`.
`WIKIMEDIA_CONTACT` there is an email address or URL Wikimedia can reach us at; the stop
details and photo lookup sends it in its User-Agent, and leaving it empty turns lookups off.

`EXPO_PUBLIC_*` is bundled into the app, and `NEXT_PUBLIC_*` is public configuration.
Never use either prefix for secrets. Future server credentials belong only in the
API's environment, without a public prefix. Environment files are ignored by git;
the `.env.example` files are tracked. Turbo passes the AI settings (AI_PROVIDER,
AI_GATEWAY_API_KEY and NEXUI_MODEL_*) and WIKIMEDIA_CONTACT only to the API dev task. Do not add Gateway keys to
Expo configuration or any public environment variable.

`GET /api/health` is public, and `GET /api/cron/runs` takes `Bearer <CRON_SECRET>`. The intent graph routes and `DELETE /api/account` require
`Authorization: Bearer <Supabase access token>` and return 401 without one. They allow
cross-origin requests for Expo web, and no cookies are involved.

## Structure and extension points

```text
apps/
  mobile/
    src/app/                  # Root layout (auth guard), (auth) and (app) route groups
    src/features/             # Per-area components, helpers and stores: auth, home, workspace, changes, compose, …
    src/ui/                   # Shared building blocks: buttons, pills, list states, tab header
    src/theme/                # Palettes, fonts, useTheme and the appearance choice
    src/data/                 # API client, Supabase client, TanStack Query hooks, Realtime, health
    src/lib/                  # Pure helpers shared across features (format.ts)
  api/
    src/app/api/health/        # GET /api/health
    src/app/api/intents/       # GET, POST /api/intents; :id and :id/changesets
    src/app/api/events/        # POST /api/events/:id/undo
    src/app/api/changes/       # GET /api/changes
    src/app/api/cron/runs/     # GET /api/cron/runs (Vercel Cron: reaps and starts AI runs)
    src/app/api/account/       # DELETE /api/account (deletes the signed-in user, revokes Apple access)
    src/lib/account/           # deleteAccount: delete the user, then revoke Apple access
    src/lib/apple/             # Apple client secret and token revocation
    src/lib/graph/             # applyChangeset, undo, snapshot loading, error mapping
    src/lib/kinds/             # KIND_BEHAVIOUR: how the generic capabilities treat each kind
    src/lib/templates/         # TEMPLATES: each template's definition and its dispatch
    src/lib/travel/            # The travel template: seed, deriveTrip, capabilities, prompt
    src/lib/supabase/          # Server clients and Bearer-token verification
packages/
  types/src/                  # Shared Zod schemas and inferred contracts
  config/                     # Strict TS, shared ESLint, Prettier
tests/                         # Node tests: contracts, graph queries/derivations/commit,
                               # routes, migration static checks, theme tokens, auth
```

- Add a kind by adding its Zod schema and a `KIND_REGISTRY` entry in
  `packages/types/src/kinds/`; no migration is needed. Add its `KIND_CARDS` entry and its
  `KIND_BEHAVIOUR` entry in `apps/api/src/lib/kinds/behaviour.ts`, and list it in the
  `kinds` of the template that holds it (`apps/api/src/lib/travel/` for trips, registered in
  `apps/api/src/lib/templates/registry.ts`). See
  [Intent graph](docs/architecture/intent-graph.md).
- Protect a new API route with `verifyRequest()` from
  `apps/api/src/lib/supabase/verify-request.ts`, which returns the user or a ready
  401 response. Keep Supabase clients and data access in `apps/api/src/lib/supabase/`.
- Add shared request/response schemas in `packages/types`. Infer TypeScript types
  from Zod so runtime validation and compile-time contracts remain aligned. Keep
  this package independent of React, server code, and secrets.
- Framework lint presets stay with their apps; shared package rules, formatting,
  and strict TypeScript defaults live in `packages/config`.

Dependency versions follow Expo's SDK 57 compatibility metadata. The scaffold uses
[Expo's built-in monorepo support](https://docs.expo.dev/guides/monorepos/) and the
[Expo Router installation setup](https://docs.expo.dev/router/installation/).
