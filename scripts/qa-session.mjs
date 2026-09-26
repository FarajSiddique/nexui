/**
 * Signs the dedicated QA account in to the dev Supabase project without sending email, and
 * prints the session for the qa agent to put in Expo web's localStorage.
 *
 * Creates the account (email already confirmed, `app_metadata.qa = true`) on first run,
 * generates a magic-link token with the admin API, and verifies it with the publishable key.
 * It refuses to run unless `QA_SUPABASE_REF` names the project in both the API's and the
 * mobile app's env, and refuses to sign in to any account it didn't create.
 *
 * `--revoke <file>` signs out only the session saved in that file, then deletes the file, so
 * QA runs in other worktrees keep their own sessions. Run it after every smoke test.
 *
 * Needs in `apps/api/.env.local`: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
 * QA_EMAIL (an address nobody uses; no mail is sent) and QA_SUPABASE_REF (the nexui-dev ref).
 *
 * @example
 * node scripts/qa-session.mjs > .qa/anchored-shell/a/session.json
 * // → {"storageKey":"sb-abcd1234-auth-token","session":{…}}
 * node scripts/qa-session.mjs --revoke .qa/anchored-shell/a/session.json
 */
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { createClient } = await import(apiRequire.resolve('@supabase/supabase-js'));

function fail(message) {
  console.error(`[qa-session] ${message}`);
  process.exit(1);
}

const projectRefOf = (url) => new URL(url).hostname.split('.')[0];

function readConfig() {
  try {
    process.loadEnvFile('apps/api/.env.local');
    process.loadEnvFile('apps/mobile/.env');
  } catch {
    fail('Could not read apps/api/.env.local and apps/mobile/.env. Run this from the repo root.');
  }

  const names = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'QA_EMAIL',
    'QA_SUPABASE_REF',
    'EXPO_PUBLIC_SUPABASE_URL',
  ];
  const missing = names.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    fail(
      `Set ${missing.join(', ')} (API values in apps/api/.env.local, Expo in apps/mobile/.env).`,
    );
  }

  const url = process.env.SUPABASE_URL.trim();
  const projectRef = projectRefOf(url);
  const expected = process.env.QA_SUPABASE_REF.trim();

  if (projectRef !== expected || projectRefOf(process.env.EXPO_PUBLIC_SUPABASE_URL) !== expected) {
    fail('The API and Expo Supabase URLs must both be the QA_SUPABASE_REF project. Refusing.');
  }

  return {
    url,
    projectRef,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY.trim(),
    secretKey: process.env.SUPABASE_SECRET_KEY.trim(),
    email: process.env.QA_EMAIL.trim(),
  };
}

const noPersistence = { auth: { persistSession: false, autoRefreshToken: false } };

async function ensureUser(admin, email) {
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { qa: true },
  });

  if (error && error.code !== 'email_exists') {
    fail(`Could not create the QA user (${error.code ?? error.status}).`);
  }
}

async function signIn(config) {
  const admin = createClient(config.url, config.secretKey, noPersistence);

  await ensureUser(admin, config.email);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: config.email,
  });

  if (linkError) {
    fail(`Could not generate a sign-in token (${linkError.code ?? linkError.status}).`);
  }

  // An existing account with this email that the script didn't create belongs to a person.
  if (link.user.app_metadata?.qa !== true) {
    fail('QA_EMAIL belongs to an account this script did not create. Use an unused address.');
  }

  const client = createClient(config.url, config.publishableKey, noPersistence);
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });

  if (error || !data.session) {
    fail(`Could not verify the sign-in token (${error?.code ?? 'no session'}).`);
  }

  return data.session;
}

function readSessionFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).session;
  } catch {
    fail(`Could not read a session from ${path}.`);
  }
}

async function revokeOne(config, sessionFile) {
  const session = readSessionFile(sessionFile);
  const admin = createClient(config.url, config.secretKey, noPersistence);
  const { error } = await admin.auth.admin.signOut(session.access_token, 'local');

  if (error) {
    fail(`Could not revoke the QA session (${error.code ?? error.status}).`);
  }

  rmSync(sessionFile);
}

function readArgs() {
  try {
    return parseArgs({ options: { revoke: { type: 'string' } } }).values;
  } catch {
    fail('Usage: node scripts/qa-session.mjs [--revoke <session file>]');
  }
}

const values = readArgs();

try {
  const config = readConfig();

  if (values.revoke) {
    await revokeOne(config, values.revoke);
    console.error('[qa-session] Signed out the saved QA session and deleted its file.');
  } else {
    const session = await signIn(config);

    // supabase-js on web stores the session as JSON under this key.
    console.log(JSON.stringify({ storageKey: `sb-${config.projectRef}-auth-token`, session }));
  }
} catch {
  fail('Unexpected error. Check the network and the Supabase keys.');
}
