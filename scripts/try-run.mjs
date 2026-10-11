#!/usr/bin/env node
/**
 * Starts runs from the command line as the QA user and prints what they did. Needs the API
 * running and a QA session from `node scripts/qa-session.mjs > .qa/session.json`.
 *
 * node scripts/try-run.mjs goal "<goal>"               create an intent and wait for its run
 * node scripts/try-run.mjs ask <intentId> "<request>"   ask, and wait for the run
 * node scripts/try-run.mjs free-day <intentId>          fix the trip's length, then free a day
 * node scripts/try-run.mjs start <intentId> [resume.pdf]     start a job search, and wait for its run
 *
 * NEXUI_SESSION and NEXUI_API override .qa/session.json and http://localhost:3000.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { printPlan, printRun, qaApi, readSession } from './lib/qa-api.mjs';

const [command, ...args] = process.argv.slice(2);
const { call, postForm, waitForRun } = qaApi(readSession());

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
  await printPlan(call, intentId);
}

switch (command) {
  case 'goal': {
    const started = await call('POST', '/api/intents', { goal: args[0] });

    if (started.outcome === 'awaiting_resume') {
      console.log(
        `intent ${started.snapshot.intent.id} (${started.snapshot.intent.template}) waits: ` +
          `node scripts/try-run.mjs start ${started.snapshot.intent.id} [resume.pdf]`,
      );
      break;
    }

    if (started.outcome === 'existing_search') {
      console.log(`a job search is already going: intent ${started.intentId}`);
      break;
    }

    if (started.outcome !== 'started') {
      console.log(`saved, not planned (${started.outcome})`);
      break;
    }

    const { snapshot, runId } = started;

    console.log(`intent ${snapshot.intent.id} (${snapshot.intent.template})`);
    printRun(await waitForRun(runId));
    await printPlan(call, snapshot.intent.id);
    break;
  }

  case 'ask': {
    const { runId, route } = await call('POST', `/api/intents/${args[0]}/ask`, { text: args[1] });

    console.log(`routed to ${route}`);
    printRun(await waitForRun(runId));
    await printPlan(call, args[0]);
    break;
  }

  case 'free-day':
    await freeDay(args[0]);
    break;
  case 'start': {
    const [intentId, pdf] = args;
    let form = null;

    if (pdf) {
      form = new FormData();
      form.set('file', new File([readFileSync(pdf)], basename(pdf), { type: 'application/pdf' }));
    }

    const started = await postForm(`/api/intents/${intentId}/start`, form);

    console.log(`intent ${intentId}: resume ${started.intake}`);
    printRun(await waitForRun(started.runId));
    await printPlan(call, intentId);
    break;
  }
  default:
    console.error(
      'Usage: try-run.mjs goal "<goal>" | ask <intentId> "<request>" | free-day <intentId> | start <intentId> [resume.pdf]',
    );
    process.exit(1);
}
