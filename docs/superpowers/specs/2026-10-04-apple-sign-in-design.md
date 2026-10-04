# Sign in with Apple on iOS

**Status:** approved in conversation on 2026-10-04; awaiting review of this written spec.
**Adds to:** the email-code and Google sign-in described in `docs/architecture/authentication.md`.
It replaces "Part C: Apple fast-follow" of the old `docs/specs/auth.md` (removed in `911639f`),
which said "no API changes"; account deletion now has to revoke Apple's tokens.

**Why now:** App Store Guideline 4.8 asks an app that offers Google sign-in to also offer a login
that keeps the user's email private. Email codes share the real address, so in practice that means
Sign in with Apple. It must ship before the external TestFlight beta on 2026-11-23.

## 0. Decisions made while brainstorming

| Topic            | Decision                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platforms        | **iOS only**, with the native sheet. Web keeps email codes; Google and Apple on web are one later piece of work. Android stays out until after launch.                                         |
| Shape            | Mirror Google: an `apple-sign-in.ts` adapter, a third dependency of `createAuthActions`, and a `signInWithApple()` action. No provider registry for two providers.                             |
| Name             | Request name and email. When Apple sends a name (first authorization only), save `full_name`, `given_name` and `family_name` to user metadata, best-effort.                                    |
| Deletion         | Apple users on iOS confirm with Apple once more when deleting. `DELETE /api/account` deletes the user, then exchanges that code and revokes the token. Nothing about Apple is stored.          |
| Revocation fails | Deletion still happens (Apple TN3194). The response says Apple access remains, and the app tells the user how to remove Nexui under Sign in with Apple.                                        |
| Secrets          | The API signs a short-lived client secret per request with the `.p8` key, so there is no 6-month rotation. Native sign-in needs no secret in Supabase.                                         |
| Sign-in copy     | The subtitle follows the platform; web stops mentioning Google, which it doesn't show.                                                                                                         |
| Setup docs       | `docs/specs/auth.md` returns as a short setup checklist (Supabase, Google, Apple, env), which `AGENTS.md` and `app.config.ts` already link to.                                                 |
| Packaging        | One plan and one PR: contracts, API, mobile, config, docs, in that order.                                                                                                                      |
| Out of scope     | Apple or Google on web and Android; storing Apple refresh tokens; Apple's server-to-server notifications (Supabase doesn't support them); registering an email domain for Hide My Email relay. |

## 1. Sign-in on iOS

**Adapter: `apps/mobile/src/lib/apple-sign-in.ts`.** `getAppleCredential()` mirrors
`getGoogleIdToken()`:

1. Off iOS, it throws `AuthActionError('Apple sign-in needs the iOS app.')`.
2. It makes a raw nonce (`Crypto.randomUUID()`) and its SHA-256 hex digest
   (`Crypto.digestStringAsync`), both from `expo-crypto`.
3. It calls `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`
   with the **hashed** nonce. Supabase hashes the raw nonce and compares it with the token's.
4. It returns `{ idToken, nonce, givenName, familyName, authorizationCode }`, with the **raw**
   nonce and `null` for missing name parts.

A cancelled sheet (`ERR_REQUEST_CANCELED`) returns `null`. A missing `identityToken` throws
`'Apple did not return an ID token.'`; any other failure throws `'Apple sign-in failed. Try
again.'`. `isAvailableAsync()` is skipped: it is always true on the iOS versions SDK 57 supports.

**Actions: `apps/mobile/src/lib/auth-actions.ts`.**

- `AppleCredential` and `AppleAuth { getCredential(): Promise<AppleCredential | null> }` sit next
  to `GoogleAuth`. `createAuthActions(auth, google, apple)` takes the adapter, and `AuthClient`
  adds `updateUser`. `auth.ts` wires `getAppleCredential` in and exports the new actions.
- `signInWithApple(): Promise<boolean>` returns `false` when the sheet was cancelled. Otherwise it
  calls `signInWithIdToken({ provider: 'apple', token: idToken, nonce })`; an error becomes
  `'Apple sign-in failed. Try again.'`. After a successful exchange, if either name part is
  present it calls `updateUser({ data: { full_name, given_name, family_name } })`, where
  `full_name` joins the present parts with a space. Errors from `updateUser`, returned or thrown,
  are ignored: the name is a nicety and sign-in has already succeeded.
- `getAppleDeletionCode(): Promise<string | null>` opens the same sheet and returns its
  `authorizationCode`, or `null` when cancelled. A credential without a code throws
  `'Apple did not confirm. Try again.'`.
- `signOut` and `clearDeletedAccount` don't change: Apple keeps no session on the device.

**Screen: `apps/mobile/src/app/(auth)/sign-in.tsx`.**

- On iOS only, `AppleAuthenticationButton` sits **above** Google: type `CONTINUE`, full width and
  52 pt high like the Google button, `BLACK` when `useScheme()` is light and `WHITE` when dark
  (`useScheme()` follows the in-app Appearance setting).
- `Pending` gains `'apple'`, and `continueWithApple()` follows `continueWithGoogle()`. The Apple
  button has no `disabled` prop, so while anything is pending its wrapper dims it and ignores
  touches (`pointerEvents="none"`).
- The subtitle depends on the platform:
  - iOS: "Use Apple or Google, or get a one-time code by email."
  - Android: "Use Google, or get a one-time code by email." (unchanged)
  - Web: "Get a one-time code by email."

**Account linking needs no code.** Supabase links identities that share a verified email, so
Apple with the same address as an existing Google or email user signs into that user. A Hide My
Email address creates a separate user, which is expected.

## 2. Account deletion and revocation

**Contracts (`packages/types/src/auth.ts`).** The mobile app and API change together.

```ts
export const deleteAccountRequestSchema = z.object({
  appleAuthorizationCode: z.string().min(1).max(1024).optional(),
});

export const deleteAccountResponseSchema = z.object({
  appleAccessRemains: z.boolean(),
});
```

`DELETE /api/account` always takes a JSON body (`{}` without a code) and answers
`200 { appleAccessRemains }` instead of `204`.

**Account screen (`apps/mobile/src/app/(app)/account.tsx`).** An account "uses Apple" when
`session.user.app_metadata.providers` includes `'apple'`.

1. On iOS, if the account uses Apple, the danger card adds: "You'll confirm with Apple so Nexui's
   access to your Apple ID is removed too."
2. `onDelete()` on iOS for an Apple account first calls `getAppleDeletionCode()`. A `null`
   (cancelled) restores the controls, deletes nothing and shows no error. On other platforms, or
   without Apple, there is no code.
3. It calls `deleteAccount(code)`, then `clearDeletedAccount()` as today.
4. If `appleAccessRemains` is true, it sets a flag in a small local store
   (`apps/mobile/src/stores/use-auth-notice-store.ts`) **before** clearing the session. The
   sign-in screen shows a dismissible notice while the flag is set: the account is deleted, and to
   finish, remove Nexui under Sign in with Apple in Apple Account settings (on an Apple device, or
   at account.apple.com). Dismissing it clears the flag, and so does starting any sign-in from
   that screen.

The notice lives on the sign-in screen, not the Account screen, because the session can end on its
own once the user is gone: a failed refresh makes supabase-js sign out, and the root layout then
leaves the Account screen. The flag survives that swap.

**`deleteAccount(appleAuthorizationCode?)` (`apps/mobile/src/lib/api.ts`)** sends the JSON body,
parses `deleteAccountResponseSchema`, and returns it. Its timeout rises from 10 s to 20 s, because
the server now makes up to two Apple calls after deleting; timing out after a successful deletion
would show an error for an account that is gone.

**Route (`apps/api/src/app/api/account/route.ts`)**, in the order `apps/api/AGENTS.md` sets:
`verifyRequest`; `request.json()` in `try`/`catch` (400 `Invalid JSON`); `safeParse` with
`deleteAccountRequestSchema` (400 `'Invalid request.'`); then `deleteAccount(...)` from
`src/lib/account/`; then `deleteAccountResponseSchema.parse` on the answer. CORS headers allow
`Content-Type`. A thrown deletion error is a generic 500, as today.

**`apps/api/src/lib/account/delete-account.ts`.**
`deleteAccount(userId, appleAuthorizationCode, env = process.env): Promise<DeleteAccountResponse>`:

1. Load the user with `admin.auth.admin.getUserById` and find the identity with
   `provider === 'apple'`. Its `identity_data.sub` is Apple's user ID. A failed lookup throws, so
   nothing is deleted.
2. Delete the user with `admin.auth.admin.deleteUser`. A failure throws. Apple is never called for
   an account that still exists.
3. Without an Apple identity, return `{ appleAccessRemains: false }`.
4. With one but no code, return `{ appleAccessRemains: true }`. This is the normal web and
   Android case and is not logged.
5. Otherwise call `revokeAppleAccess(code, env)`. Access remains unless it succeeds **and** the
   revoked grant's subject equals the identity's `sub`. A mismatch means the user confirmed with a
   different Apple ID; that grant is still revoked, because the confirmation just created it.
   Failures are logged as `console.error('[account]', message)` with the error class's message or a
   generic one, never the code, a token or the subject.

**`apps/api/src/lib/apple/revoke-access.ts`.**
`revokeAppleAccess(authorizationCode, env = process.env): Promise<{ subject: string }>`:

1. Read `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` and `APPLE_CLIENT_ID`. A missing value
   throws `AppleConfigurationError` naming the variable. `APPLE_PRIVATE_KEY` is the `.p8` file's
   PEM text; literal `\n` sequences become newlines, so it fits a single-line env value.
2. Sign a client secret, an ES256 JWT, with Node's
   `crypto.sign('sha256', …, { key, dsaEncoding: 'ieee-p1363' })` and base64url. No new
   dependency.
   - Header: `{ alg: 'ES256', kid: APPLE_KEY_ID }`.
   - Claims: `iss` is `APPLE_TEAM_ID`, `sub` is `APPLE_CLIENT_ID`, `aud` is
     `https://appleid.apple.com`, and `exp` is 300 s after `iat`.
3. POST form-encoded `client_id`, `client_secret`, `code` and `grant_type=authorization_code` to
   `https://appleid.apple.com/auth/token`. Read `refresh_token`, and `sub` from the `id_token`
   payload. The token came straight from Apple over TLS in answer to this request, so it is decoded,
   not verified.
4. POST `client_id`, `client_secret`, `token` (the refresh token) and
   `token_type_hint=refresh_token` to `https://appleid.apple.com/auth/revoke`.
5. Each call has a 5 s timeout (`AbortSignal.timeout`). A non-2xx answer, a missing field or a
   timeout throws `AppleRevocationError` with a fixed message per step.

## 3. Setup and configuration

**Code.**

- `apps/mobile`: add `expo-apple-authentication` and `expo-crypto` with `npx expo install`, so the
  SDK 57 versions are pinned.
- `apps/mobile/app.config.ts`: `ios.usesAppleSignIn: true` and the `'expo-apple-authentication'`
  plugin. Native modules change, so the next dev-client and preview builds are new EAS builds.
- `apps/api/.env.example`: the four `APPLE_*` variables, marked server-only, next to
  `SUPABASE_SECRET_KEY`.

**Manual steps (the user runs these; the checklist in `docs/specs/auth.md` records them).**

1. **Apple Developer:** confirm the Sign in with Apple capability on App ID `ai.faraj.nexui` (EAS
   usually enables it from `usesAppleSignIn`). Under Keys, create a Sign in with Apple key for that
   App ID, download the `.p8` (available once), and note the Key ID and Team ID.
2. **Supabase, dev then prod:** Auth → Providers → Apple: enable it, set Client IDs to
   `ai.faraj.nexui`, leave the secret empty, and leave "Allow users without an email" off.
3. **Env:** the four `APPLE_*` values in `apps/api/.env.local` and in Vercel (Production,
   Preview, Development).
4. **Builds:** new EAS dev-client and preview builds; test on a physical iPhone, since the Simulator
   only supports limited testing.
5. **Launch checklist (later):** once a domain is bought, register its email sender under
   "Sign in with Apple for Email Communication" so mail reaches Hide My Email addresses.

**Docs.**

- `docs/specs/auth.md` returns as a setup checklist only: Supabase projects and URL settings,
  email-code SMTP and template, Google Cloud clients, Apple, EAS builds, and a table of where each
  value goes. The original plan stays in git history.
- `docs/architecture/authentication.md` gains the Apple flow, deletion as "delete, then revoke",
  the sign-in notice, and the Apple checks in the native release list.
- `AGENTS.md` says Supabase, Google and Apple credentials are needed for sign-in, and the
  `app.config.ts` comment points to the checklist's identifiers section.

## 4. Testing and verification

**Automated (`pnpm test`; network boundaries stubbed, as the current tests do).**

- `tests/mobile-auth.test.mjs` adds an Apple adapter and `updateUser` to `setup()`:
  - cancellation returns `false` and never calls Supabase;
  - success exchanges the ID token with `provider: 'apple'` and the raw nonce;
  - a name is saved as `full_name`, `given_name` and `family_name`, and a given name alone still
    sets `full_name`;
  - no name means no `updateUser`;
  - a failing or throwing `updateUser` still returns `true`;
  - exchange errors become the generic message;
  - `getAppleDeletionCode()` returns `null` on cancel and the code otherwise.
- `tests/account-route.test.mjs` updates the existing cases for the JSON body and `200`, and adds:
  - bad JSON and bad bodies return 400 and delete nothing;
  - no Apple identity: deleted, `false`, no Apple calls;
  - Apple identity with a code: delete, token exchange and revoke happen in that order, `false`;
  - Apple identity without a code: deleted, `true`, no Apple calls;
  - a failed exchange or revoke: still `200` and `true`, and logs contain no code or token;
  - a subject mismatch: revoked, `true`;
  - missing Apple env: deleted, `true`, the configuration message logged;
  - a failed deletion: `500`, no Apple calls.
- New `tests/apple-revoke-access.test.mjs`: the client secret's header and claims, and its
  signature verifies with the public half of a P-256 key the test generates; the `/auth/token` and
  `/auth/revoke` form fields; `\n`-escaped keys are accepted.
- The nonce hashing lives in the native adapter, which Node can't load; the device check covers it,
  since a wrong hash fails sign-in.

**Checks before handoff.** `pnpm fix`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm build`; then `api-reviewer`, `mobile-reviewer`, `security-reviewer` and `docs-keeper`.

**On a physical iPhone (preview build, dev Supabase).**

1. First Apple sign-in sharing the real email: signed in, and the Supabase user has the name.
2. Sign out and in again: no name is sent, and the saved name stays.
3. Cancel the sheet: still on sign-in, no error.
4. Apple with the same email as the Google account: the same user, now with both identities.
5. Hide My Email: a separate user with a relay address.
6. Delete an Apple account: confirm with Apple, the account is gone, and Nexui no longer appears
   under Sign in with Apple in Settings.
7. Cancel the Apple sheet while deleting: the account is kept.
8. On web, sign in by email code to an Apple-linked account and delete it: the sign-in screen shows
   the Settings notice.
9. Google and email sign-in still work; the web subtitle shows the new copy.

## 5. Done when

- Apple sign-in works on a physical iPhone against dev and prod Supabase, with all nine device checks
  passing.
- Deleting an Apple account on iOS revokes Nexui's Apple access, and every other path tells the user
  how to remove it.
- `pnpm test`, lint, typecheck, format check and build pass, and the four reviewers have no open
  findings.
- The prod Supabase Apple provider and the Vercel production `APPLE_*` values are in place before the
  external TestFlight beta on 2026-11-23.
