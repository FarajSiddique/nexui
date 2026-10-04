/**
 * Pushes this checkout's migrations to one of nexui's Supabase projects without relinking the
 * checkout. It copies `supabase/config.toml` and `supabase/migrations` into a temp folder, links
 * that copy to the project, runs `supabase db push` there and deletes the copy. Supabase lists
 * the migrations it will apply and asks Y/n before it changes anything.
 *
 * Prod is guarded: the checkout must be on `main`, match `origin/main`, and have no uncommitted
 * changes under `supabase/`. You also type `prod` to go ahead.
 *
 * @example
 * pnpm db:push:dev                 // push to dev (toprlatastzpzirodbao)
 * pnpm db:push:prod                // push to prod (cusjvjmulmixhqkvrsuk)
 * pnpm db:push:prod --dry-run      // list what would be pushed; change nothing
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PROJECTS = { dev: 'toprlatastzpzirodbao', prod: 'cusjvjmulmixhqkvrsuk' };

function fail(message) {
  console.error(`[db-push] ${message}`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Runs the repo's Supabase CLI with the terminal attached, so its prompts reach you.
function supabase(args) {
  const result = spawnSync('pnpm', ['exec', 'supabase', ...args], { stdio: 'inherit' });

  return result.status ?? 1;
}

// Prod only takes migrations that are on main: no other branch, nothing unpushed or unpulled,
// and no uncommitted edits to a migration.
function checkProdSource() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

  if (branch !== 'main') {
    fail(`Prod pushes run from main, and this checkout is on ${branch}.`);
  }

  git('fetch', '--quiet', 'origin', 'main');

  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    fail('This main differs from origin/main. Pull (or push) first.');
  }

  if (git('status', '--porcelain', '--', 'supabase') !== '') {
    fail('supabase/ has uncommitted changes. Commit or discard them first.');
  }
}

async function confirmProd() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Type "prod" to push to prod (${PROJECTS.prod}): `);

  prompt.close();

  if (answer.trim() !== 'prod') {
    fail('Stopped. Nothing was pushed.');
  }
}

const [target, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
const ref = PROJECTS[target];

if (!ref) {
  fail('Usage: pnpm db:push:dev | pnpm db:push:prod [--dry-run]');
}

process.chdir(git('rev-parse', '--show-toplevel'));

if (target === 'prod') {
  checkProdSource();

  if (!dryRun) {
    await confirmProd();
  }
}

const workdir = mkdtempSync(join(tmpdir(), `nexui-db-push-${target}-`));
let status = 1;

try {
  cpSync('supabase/config.toml', join(workdir, 'supabase', 'config.toml'));
  cpSync('supabase/migrations', join(workdir, 'supabase', 'migrations'), { recursive: true });

  console.log(`[db-push] Linking a temporary copy to ${target} (${ref}).`);
  status = supabase(['link', '--project-ref', ref, '--workdir', workdir]);

  if (status === 0) {
    const push = ['db', 'push', '--workdir', workdir];

    if (dryRun) {
      push.push('--dry-run');
    }

    status = supabase(push);
  }
} finally {
  // The link lives only in the copy, so this checkout's own link never changes.
  rmSync(workdir, { recursive: true, force: true });
}

process.exitCode = status;
