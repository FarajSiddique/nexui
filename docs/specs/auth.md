# Auth setup checklist

What has to be configured outside the repo for sign-in to work: the Supabase projects, email
codes, Google, Apple, the API's env, and EAS builds. For how sign-in behaves in code, see
[Authentication](../architecture/authentication.md). The original v1 setup and implementation
plan is in git history: `git show 911639f^:docs/specs/auth.md`.

## Identifiers

- iOS bundle ID and Android package: `ai.faraj.nexui` (`apps/mobile/app.config.ts`). It is
  permanent once the app is released.
- URL scheme: `nexui`.
- The Apple App ID is the same `ai.faraj.nexui`. It is also the Client ID of Supabase's Apple
  provider and the API's `APPLE_CLIENT_ID`.

## Supabase projects

Two projects: `nexui-dev` (local development, Vercel Preview and Development) and `nexui-prod`
(Vercel Production). In each:

1. **Settings → API Keys:** note the project URL, the publishable key (`sb_publishable_…`) and
   the secret key (`sb_secret_…`, server only).
2. **Settings → JWT Keys:** use asymmetric signing keys (ES256).
3. **Authentication → Sign In / Providers:** allow new users to sign up, and confirm email.
4. **Authentication → URL Configuration:** Site URL `nexui://`; Redirect URLs `nexui://**`.

## Email codes

1. **Authentication → Emails → SMTP Settings:** use custom SMTP, not Supabase's built-in sender
   (it only mails your org's members, about twice an hour).
   - Without a domain, Resend's sandbox (`smtp.resend.com`, port `465`, user `resend`, the API
     key as password, sender `onboarding@resend.dev`) delivers only to the Resend account's own
     address. A Mailtrap Email Sandbox inbox (`sandbox.smtp.mailtrap.io`, port `2525`) accepts
     any address and shows the mail in its web inbox.
   - Once a domain is bought: verify it in Resend (SPF, DKIM, DMARC) and send from an address on
     it in both projects.
2. **Templates:** Magic Link and Confirm signup show `{{ .Token }}`, not
   `{{ .ConfirmationURL }}`, e.g. `<h2>Your Nexui code</h2><p>{{ .Token }}</p>`.
3. **Sign In / Providers → Email:** Email OTP Length `6` (the app rejects other lengths) and an
   expiry such as 600 s.
4. **Rate Limits:** raise the email limits once custom SMTP is on.

## Google

1. **Google Cloud → Google Auth Platform:** an External app with the `openid`, `email` and
   `profile` scopes, and testers added as test users. Testing mode allows 100 test users;
   publishing needs privacy and terms URLs on a verified domain.
2. **Clients:**
   - Web application: its ID is the mobile `webClientId`, and Supabase uses its secret.
   - iOS, for the bundle ID: its client ID and reversed client ID.
   - Android, for the package plus a SHA-1: one client per signing key (the EAS keystore, later
     Play App Signing).
3. **Supabase → Auth → Providers → Google:** enable it; Client IDs are the web, iOS and Android
   IDs, comma-separated, web first; paste the web client secret. Turn on "Skip nonce check" only if
   iOS sign-in fails with a nonce error.

## Apple

Native sign-in on iOS needs no secret in Supabase. The API's `.p8` key is used only to revoke
Nexui's access when an Apple user deletes their account. Apple isn't offered on web or Android.

1. **Apple Developer → Identifiers:** App ID `ai.faraj.nexui` has the Sign in with Apple
   capability. EAS usually turns it on from `ios.usesAppleSignIn`.
2. **Apple Developer → Keys → +:** a key with Sign in with Apple, configured for that App ID.
   Download the `.p8` (it can be downloaded only once) and note its Key ID and your Team ID (top
   right of the portal).
3. **Supabase, dev then prod → Auth → Providers → Apple:** enable it, set Client IDs to
   `ai.faraj.nexui`, leave the secret key empty, and leave "Allow users without an email" off.
4. **API env:** the four `APPLE_*` values in `apps/api/.env.local` and in Vercel (Production,
   Preview and Development); see the table below. `APPLE_PRIVATE_KEY` is the whole `.p8` file,
   BEGIN and END lines included: in `.env.local`, paste it in double quotes as in `.env.example`;
   in Vercel, paste it as is.
5. **Before launch, once a domain is bought:** under Certificates, Identifiers & Profiles →
   Services → Sign in with Apple for Email Communication, register the sending domain and address
   so mail reaches Hide My Email (`privaterelay.appleid.com`) addresses.

## EAS builds

Native Google and Apple sign-in don't run in Expo Go; use an EAS build with the dev client.

- Run `eas login` once. `apps/mobile/eas.json` has `development` (dev client, registered
  devices), `development-simulator` (iOS Simulator), `preview` (internal distribution, registered
  devices; `pnpm build:preview`) and `production`.
- Register an iPhone with `eas device:create` before building for it.
- `.env` isn't uploaded, so EAS environments hold the `EXPO_PUBLIC_*` values, including
  `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`; production points at prod Supabase and the Vercel URL.
- Android: after the first Android build, get the keystore's SHA-1 from `eas credentials` and
  create its Google Android client.
- A change to native modules or entitlements, such as adding Apple sign-in, needs new dev-client
  and preview builds. Test Apple on a physical iPhone; the Simulator only supports limited
  testing.

## Where each value goes

| Value                                        | Where it goes                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Bundle ID / package                          | `apps/mobile/app.config.ts`                                                                                                       |
| Supabase URL + publishable key (dev)         | `apps/mobile/.env`, `apps/api/.env.local`, EAS development/preview, Vercel Preview + Dev                                          |
| Supabase URL + publishable key (prod)        | EAS production, Vercel Production                                                                                                 |
| Supabase secret key                          | `apps/api/.env.local` (dev) and Vercel only; never the mobile app                                                                 |
| Google web client ID                         | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, Supabase Google provider                                                                      |
| Google web client secret                     | Supabase Google provider only                                                                                                     |
| Google iOS client ID / reversed client ID    | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` (and EAS env)                                            |
| Apple Team ID, Key ID, `.p8` text, client ID | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` in `apps/api/.env.local` and Vercel; never the mobile app |
| Vercel production URL                        | EAS production `EXPO_PUBLIC_API_URL`                                                                                              |
