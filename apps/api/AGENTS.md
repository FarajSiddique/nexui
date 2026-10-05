# API Guidelines

These rules add to the root `AGENTS.md` for the Next.js API. Rules marked _(lint)_ are enforced by `apps/api/eslint.config.mjs`.

## Route handlers

- A `route.ts` authenticates, parses, validates, calls a `src/lib/<domain>/` function, and maps the result to a response. Keep business logic out of route files.
- Follow this order inside a handler:
  1. `verifyRequest(request, headers)`. If it returns a `Response`, return that response.
  2. `await request.json()` inside `try`/`catch`. Respond with 400 `Invalid JSON` if parsing fails. Routes that write the intent graph use `readJsonBody(request, headers)` from `src/lib/http/json-body.ts` instead, which also answers 413 above 65 536 characters.
  3. `safeParse` the body with a schema from `@nexui/types`. Respond with 400 and a user-safe message if it fails.
  4. Do the work, then `schema.parse` the response body before sending it.
- Build responses with `src/lib/http/responses.ts`: `corsHeaders` once per route, `preflight` for `OPTIONS`, and `jsonError` for failures. Send the route's headers on every response.
- Cron routes (`src/app/api/cron/`) are server to server: they start with `verifyCronRequest(request, headers)` instead of `verifyRequest`, send only `Cache-Control: no-store` (no CORS headers), and take no body.
- Error bodies are always `{ error: string }`. The message must be safe to show a user, so never include provider errors, stack traces, or IDs.

## Errors and logging

- Log with `console.error('[tag]', message)`, where the tag names the route or module (`[intent]`, `[auth]`). Use `console.info` only for development diagnostics behind a `NODE_ENV` check. _(lint: `no-console` allows `error`, `warn`, and `info`)_
- Never log tokens, request bodies, email addresses, or raw provider errors.
- Represent known failure modes as `Error` subclasses (e.g. `SupabaseConfigurationError`). Log their message, and log a generic message for anything else.

## Configuration

- Read environment variables through an `env` parameter that defaults to `process.env` (see `verifyRequest`), so tests can pass explicit values.
- Server secrets stay in `apps/api`. Never import server modules from `packages/types` or the mobile app.
- AI settings come from `readAiConfig` (`src/lib/ai/config.ts`); routes open AI sessions with `sessionOpener()`. Route tests pin `AI_PROVIDER=mock` with `useMockAi(t)` and collect runs instead of calling `after()` with `captureRuns(t)` (`tests/support/ai.mjs`).

## Types and imports

- Exported functions have explicit parameter and return types. _(lint: `explicit-module-boundary-types`)_
- Use `import type` for type-only imports. _(lint)_
- Each `src/lib/<domain>/` has an `index.ts` barrel that re-exports, by name, what other code may use. Import another domain, or `src/lib` from a route, through its barrel: `import { loadSnapshot } from '#lib/graph'`. `#lib/*` is a Node subpath import in `package.json`, so Next.js, `tsc` and the Node test runner all resolve it. _(lint: `no-restricted-imports` bans `../` paths and `#lib/<domain>/<file>`)_
- Inside a domain, import siblings directly with `./file.ts`, never the domain's own barrel, which would load it in a cycle. _(lint)_
- A barrel holds only `export { … } from './file.ts'` and `export type { … } from './file.ts'` lines; code lives in the domain's other files. _(lint: `no-restricted-syntax`)_ Re-export types with `export type`, because Node strips types file by file. When another domain needs a new name, add it to the barrel; a new domain needs its `index.ts` before `#lib/<domain>` resolves.
- Some barrels import each other in a cycle (for example `graph` and `runs`). That is safe only while cross-domain imports are used inside functions, so never use one at module top level (a `const`, `class … extends`, or array built from another domain's export). The exception is the registries' load chain: a domain on it may use the exports of the domains below it at top level (`lib/kinds` imports no other domain, `lib/capabilities` only `lib/kinds`, `lib/travel` only `lib/capabilities`, and `lib/templates` never `lib/graph`, `lib/staging`, `lib/runs` or `lib/orchestrator`), which is how `TRAVEL_CAPABILITIES` and `TEMPLATES` are built at load time. `tests/api-load-order.test.mjs` enforces the chain and loads every domain first in a fresh process. Everywhere else the rule stands.
- Import groups go in this order: Node builtins, packages, `@nexui/*`, `#lib/*`, then relative paths, with a blank line between groups. _(lint: `import/order`)_
- Relative imports include the `.ts` extension, because the Node test runner loads source files directly.
- Derive request and response contracts from Zod schemas in `@nexui/types`.

## Tests

- Each route has a `tests/<name>-route.test.mjs` that calls the exported handler directly with a `Request`. Stub external services at the network boundary (see `tests/support/supabase-auth.mjs`) instead of mocking modules.
