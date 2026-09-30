#!/usr/bin/env node
/**
 * Starts runs from the command line as the QA user and prints what they did. Needs the API
 * running and a QA session from `node scripts/qa-session.mjs > .qa/session.json`.
 *
 * node scripts/try-run.mjs goal "<goal>"               create an intent and wait for its run
 * node scripts/try-run.mjs ask <intentId> "<request>"   ask, and wait for the run
 * node scripts/try-run.mjs free-day <intentId>          fix the trip's length, then free a day
 *
 * NEXUI_SESSION and NEXUI_API override .qa/session.json and http://localhost:3000.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const api = process.env.NEXUI_API ?? 'http://localhost:3000';
const { session } = JSON.parse(
  readFileSync(process.env.NEXUI_SESSION ?? '.qa/session.json', 'utf8'),
);
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

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const run = await call('GET', `/api/runs/${runId}`);

    if (run.status !== 'queued' && run.status !== 'running') {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`run ${runId} did not finish in 5 minutes`);
}

function printRun(run) {
  console.log(`run ${run.id}: ${run.status}${run.error ? ` (${run.error})` : ''}`);

  for (const entry of run.progress) {
    console.log(`  step ${entry.step} ${entry.ok ? 'ok ' : 'err'} ${entry.error ?? entry.label}`);
  }

  const usage = run.modelUsage;

  console.log(
    `  ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out (${usage.model ?? '-'})`,
  );
}

async function printPlan(intentId) {
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

// Gives a trip without dates a length equal to its days so far, then takes a day from its
// first stop, which leaves one unallocated day and the "Ask Nexui for ideas" insight.
async function freeDay(intentId) {
  const snapshot = await call('GET', `/api/intents/${intentId}`);
  const tripId = snapshot.workspace.doc.anchorId;
  const trip = snapshot.objects.find((object) => object.id === tripId);
  const onTrip = new Set(
    snapshot.relationships
      .filter((edge) => edge.type === 'part_of' && edge.targetId === tripId)
      .map((edge) => edge.sourceId),
  );
  const places = snapshot.objects
    .filter((object) => object.kind === 'place' && onTrip.has(object.id))
    .sort((a, b) => a.position - b.position);

  assert.ok(places[0]?.data.days > 1, 'the first stop needs at least 2 days');

  const ops = [];

  if (!trip.data.startDate && !trip.data.totalDays) {
    const data = {
      ...trip.data,
      totalDays: places.reduce((sum, place) => sum + place.data.days, 0),
    };

    delete data.derived;
    ops.push({ op: 'update_object', id: tripId, patch: { data } });
  }

  ops.push({
    op: 'update_object',
    id: places[0].id,
    patch: { data: { ...places[0].data, days: places[0].data.days - 1 } },
  });
  await call('POST', `/api/intents/${intentId}/changesets`, { ops });
  await printPlan(intentId);
}

switch (command) {
  case 'goal': {
    const { snapshot, runId } = await call('POST', '/api/intents', { goal: args[0] });

    console.log(`intent ${snapshot.intent.id} (${snapshot.intent.template ?? 'no template'})`);

    if (runId) {
      printRun(await waitForRun(runId));
    }

    await printPlan(snapshot.intent.id);
    break;
  }

  case 'ask': {
    const { runId, route } = await call('POST', `/api/intents/${args[0]}/ask`, { text: args[1] });

    console.log(`routed to ${route}`);
    printRun(await waitForRun(runId));
    await printPlan(args[0]);
    break;
  }

  case 'free-day':
    await freeDay(args[0]);
    break;
  default:
    console.error(
      'Usage: try-run.mjs goal "<goal>" | ask <intentId> "<request>" | free-day <intentId>',
    );
    process.exit(1);
}
