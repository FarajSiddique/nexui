# Authentication

Nexui supports email codes, native Google sign-in, and Sign in with Apple on iOS,
all through Supabase. The mobile app owns the UI; Supabase owns the session. The API verifies a bearer token on each
protected request and never stores a user session.

## Follow an operation

```text
Sign-in / Verify / Account screen
  → auth.ts (connects dependencies once)
  → auth-actions.ts (email, Google and Apple token exchange, sign-out)
  → Supabase
  → session-lifecycle.ts → session store → root route guard
```

For Google, `google-sign-in.ts` configures the native SDK when first needed, opens
the account picker, and returns an ID token. Cancellation returns `null` without
contacting Supabase. The auth action exchanges the token for a Supabase session.
Google sign-in is unavailable in the web preview.

Apple sign-in is iOS only, so the sign-in screen shows its button only there, above
Google. `apple-sign-in.ts` makes a random nonce, gives Apple's sheet its SHA-256
hash, and returns the ID token with the raw nonce; Supabase hashes the raw nonce and
compares. It asks for the name and email. Cancellation returns `null` without
contacting Supabase. Apple sends the name only on the first authorization, so after
a successful exchange the action saves any name parts as `full_name`, `given_name`
and `family_name` in user metadata, best-effort: a failed update doesn't fail
sign-in. Supabase links an Apple identity to an existing user with the same verified
email; a Hide My Email address makes a separate user.

Email actions validate and normalize the address. Verification keeps leading zeroes:
`012345` is a six-digit code, not a number. The screen controls the resend countdown;
the Supabase project's rate limit is authoritative. See [setup](../specs/auth.md).

## Session ownership and lifecycle

`supabase.ts` creates the client and chooses storage: browser localStorage on web,
the chunked SecureStore adapter on native. The Zustand store only mirrors Supabase
events for rendering and routing; changing it is not a substitute for signing out.

The root layout starts `startSessionLifecycle()` in an effect and returns its
cleanup. The initial session event releases the loading screen. Later sign-in,
refresh, and sign-out events update the same store. The callback stays synchronous:
Supabase awaits callbacks, so calling an auth operation inside one can deadlock.

On native, the lifecycle starts refresh in the foreground and stops it in the
background or on unmount. Starts and stops are serialized per client because the
SDK starts asynchronously; cleanup or remount must not leave an extra timer running.
On web, Supabase manages browser visibility itself.

## Requests and failure handling

`api.ts` owns endpoints, request bodies, validation, and timeouts.
`authenticated-fetch.ts` reads the session, attaches its token, and sends the request.
On a 401 it refreshes once and retries; a second 401 rejects. Other statuses return
to the caller. Cancellation is checked between steps, but the SDK's token operations
cannot themselves be cancelled by the request's signal. A failed refresh propagates;
this helper does not force sign-out. Supabase events determine routing.

Sign-out forgets Google's account selection on a best-effort basis, then calls
Supabase. A returned error triggers one local-scope attempt. Local scope can still
require network access: an expired session while offline can fail both attempts.
The action then rejects and the Account screen restores its controls. This does
not guarantee offline credential removal.

Deletion first calls `DELETE /api/account`, which verifies the token and deletes
only that user with the server's secret key. The mobile app then clears its
remaining session. These are separate steps: failed cleanup does not undo deletion.
The Account screen reports either failure through its deletion error state.

An account that signed in with Apple also has Nexui's Apple access revoked, after
the user is gone (delete, then revoke):

- On iOS, when `app_metadata.providers` includes `apple`, the Account screen opens
  Apple's sheet once more and sends its authorization code in the request body.
  Cancelling the sheet keeps the account.
- The API looks the user up, deletes it, and only then exchanges the code with
  Apple (`src/lib/apple/revoke-access.ts`) and revokes the refresh token. It signs
  Apple's client secret per request with the `.p8` key in `APPLE_PRIVATE_KEY`, so
  nothing needs rotating, and stores nothing from Apple.
- The answer is `200 { appleAccessRemains }`. Access remains when the account has an
  Apple identity and there was no code (web and Android), Apple failed or isn't
  configured, or the code came from a different Apple ID. Failures are logged by
  class, never with the code, a token, or Apple's user ID.
- When access remains, the app sets a flag in `use-auth-notice-store.ts` before
  clearing the session. The sign-in screen then shows how to remove Nexui under Sign
  in with Apple in Apple Account settings, until the user dismisses it or starts a
  sign-in. The notice lives on the sign-in screen because the session can also end
  on its own once the user is deleted (a failed refresh signs out), and the flag
  survives that.

## Boundaries and verification

`createAuthActions()` accepts the Supabase methods it uses and small Google and
Apple adapters. Tests directly import the operations without loading React Native or
installing custom module loaders. `AuthActionError` marks messages safe to display;
unexpected errors receive generic UI messages. Error subclasses serve as identifiers.

`pnpm test` covers auth actions, cancellation, token refresh/retry, lifecycle cleanup,
real-client session restoration, server verification, and account deletion. Network
boundaries are simulated; tests do not open Google's or Apple's native sheets or send
email. `tests/apple-revoke-access.test.mjs` checks the client secret with a generated
P-256 key.
Also run `pnpm fix`, lint, typecheck, formatting checks, and builds after changes.

Before a native release, verify email sign-in/resend, Google success/cancellation,
restoration after restarting, foreground/background refresh, offline sign-out,
and deletion on a simulator or device. Apple needs a physical iPhone: first sign-in
saves the name, a second sign-in keeps it, cancelling stays on sign-in, the same
email as a Google account links to one user, Hide My Email makes a separate user,
deleting an Apple account removes Nexui under Sign in with Apple in Settings,
cancelling Apple's sheet keeps the account, and deleting an Apple-linked account on
web shows the sign-in notice.
