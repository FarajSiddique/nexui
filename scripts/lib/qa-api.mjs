/**
 * Calls the API as the QA user, for the scripts in `scripts/`. Needs the API running and a QA
 * session from `node scripts/qa-session.mjs > .qa/session.json`. NEXUI_SESSION and NEXUI_API
 * override .qa/session.json and http://localhost:3000.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { isActiveRunStatus } from '../../packages/types/src/runs.ts';

/** The session `qa-session.mjs` saved. */
export function readSession(path = process.env.NEXUI_SESSION ?? '.qa/session.json') {
  return JSON.parse(readFileSync(path, 'utf8')).session;
}

/** `call` and `waitForRun` against `api`, with the session's token. */
export function qaApi(session, api = process.env.NEXUI_API ?? 'http://localhost:3000') {
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

  // Polls until the run is no longer queued, running or stopping.
  async function waitForRun(runId, seconds = 300) {
    for (let attempt = 0; attempt < seconds; attempt += 1) {
      const run = await call('GET', `/api/runs/${runId}`);

      if (!isActiveRunStatus(run.status)) {
        return run;
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`run ${runId} did not finish in ${seconds} seconds`);
  }

  return { call, waitForRun };
}

/**
 * A Supabase client with the secret key, for the scripts' own bookkeeping (tagging and cleaning
 * up eval plans). Refuses unless apps/api/.env.local's SUPABASE_URL is the QA_SUPABASE_REF project.
 */
export async function qaAdmin() {
  process.loadEnvFile('apps/api/.env.local');

  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const ref = process.env.QA_SUPABASE_REF?.trim();

  if (!url || !secretKey || !ref) {
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_SECRET_KEY and QA_SUPABASE_REF in apps/api/.env.local.',
    );
  }

  if (new URL(url).hostname.split('.')[0] !== ref) {
    throw new Error('SUPABASE_URL is not the QA_SUPABASE_REF project. Refusing.');
  }

  const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
  const { createClient } = await import(apiRequire.resolve('@supabase/supabase-js'));

  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function printRun(run) {
  console.log(`run ${run.id}: ${run.status}${run.error ? ` (${run.error})` : ''}`);

  for (const entry of run.progress) {
    console.log(`  step ${entry.step} ${entry.ok ? 'ok ' : 'err'} ${entry.error ?? entry.label}`);
  }

  const usage = run.modelUsage;

  console.log(
    `  ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out (${usage.model ?? '-'})`,
  );
}

export async function printPlan(call, intentId) {
  const snapshot = await call('GET', `/api/intents/${intentId}`);
  const { line, badge } = snapshot.intent.summary;

  console.log(`intent ${intentId}: "${line}" ${badge?.text ?? ''}`);

  for (const object of snapshot.objects.filter((o) =>
    ['place', 'leg', 'decision'].includes(o.kind),
  )) {
    const detail =
      object.kind === 'place'
        ? ` ${object.data.days}d @ ${object.data.lat},${object.data.lng}`
        : '';

    console.log(`  ${object.kind} ${object.title}${detail}`);
  }

  return snapshot;
}
