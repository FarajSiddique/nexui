import assert from 'node:assert/strict';
import test from 'node:test';

import { AiConfigurationError } from '../apps/api/src/lib/ai/config.ts';
import { FIXTURES } from '../apps/api/src/lib/ai/fixtures/index.ts';
import { findFixture } from '../apps/api/src/lib/ai/mock.ts';
import { sessionOpener } from '../apps/api/src/lib/ai/session.ts';
import { createStager } from '../apps/api/src/lib/staging/stage.ts';
import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { chooseTemplate, routeAsk } from '../apps/api/src/lib/perception/perceive.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { idSequence, RUN_ID, seedRow, TRIP_ID } from './support/graph.mjs';

const CAPABILITIES = TEMPLATES.travel.capabilities;
const findCapability = (name) => CAPABILITIES.find((capability) => capability.name === name);

const fixture = {
  name: 'test-job',
  kind: 'create_intent',
  match: ['new', 'job'],
  perception: { template: 'none', route: 'edit' },
  steps: [[{ capability: 'object.update', input: { ref: 'trip', data: { pace: 'slow' } } }]],
};

test('a fixture matches when every phrase is in the text, for its kind', () => {
  const fixtures = [fixture];

  assert.equal(findFixture(fixtures, 'create_intent', 'Find a NEW job in Berlin'), fixture);
  assert.equal(findFixture(fixtures, 'create_intent', 'Find a job'), null);
  assert.equal(findFixture(fixtures, 'ask', 'Find a new job'), null);
});

test('a mock session answers Jev from its fixture and replays its steps, then stops', async () => {
  const session = sessionOpener({ AI_PROVIDER: 'mock' }, [fixture])(
    'create_intent',
    'Find a new job',
  );

  assert.deepEqual(await chooseTemplate(session.evaluationModel, 'Find a new job'), {
    value: 'none',
    source: 'model',
  });
  assert.deepEqual(
    await routeAsk(session.evaluationModel, { text: 'Find a new job', goal: '', summary: '' }),
    { value: 'edit', source: 'model' },
  );

  const model = session.languageModel('reasoning');
  const first = await model.doGenerate({ prompt: [] });
  const second = await model.doGenerate({ prompt: [] });

  assert.deepEqual(first.content, [
    {
      type: 'tool-call',
      toolCallId: 'mock-0-0',
      toolName: 'object_update',
      input: JSON.stringify({ ref: 'trip', data: { pace: 'slow' } }),
    },
  ]);
  assert.deepEqual(second.content, [{ type: 'text', text: 'Done.' }]);
  assert.equal(session.providerOptions('fast'), undefined);
});

test('without a fixture, mock perception says travel and reasoning, and the model changes nothing', async () => {
  const session = sessionOpener({}, [fixture])('ask', 'Something else entirely');

  assert.equal((await chooseTemplate(session.evaluationModel, 'x')).value, 'travel');
  assert.equal(
    (await routeAsk(session.evaluationModel, { text: 'x', goal: '', summary: '' })).value,
    'reasoning',
  );
  assert.deepEqual((await session.languageModel('fast').doGenerate({ prompt: [] })).content, [
    { type: 'text', text: 'Done.' },
  ]);
});

test('a live session uses the configured Gateway models and fallbacks', () => {
  const session = sessionOpener({ AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: 'vck_test' })(
    'ask',
    'Make Kyoto 3 days',
  );

  assert.equal(session.languageModel('fast').modelId, 'anthropic/claude-haiku-4.5');
  assert.equal(session.languageModel('reasoning').modelId, 'anthropic/claude-sonnet-5.5');
  assert.equal(session.evaluationModel.modelId, 'typesafe-ai/jev');
  assert.deepEqual(session.providerOptions('reasoning'), {
    gateway: { models: ['anthropic/claude-sonnet-5'] },
  });
  assert.equal(session.providerOptions('perception'), undefined);
});

test('a misconfigured provider is refused when a session opener is made', () => {
  assert.throws(() => sessionOpener({ AI_PROVIDER: 'live' }), AiConfigurationError);
});

test('shipped fixtures are well formed', () => {
  const names = FIXTURES.map((shipped) => shipped.name);

  assert.ok(FIXTURES.length > 0);
  assert.equal(new Set(names).size, names.length);

  for (const shipped of FIXTURES) {
    assert.ok(shipped.match.length > 0, shipped.name);
    assert.ok(
      shipped.match.every((phrase) => phrase === phrase.toLowerCase()),
      shipped.name,
    );

    for (const call of shipped.steps.flat()) {
      const capability = findCapability(call.capability);

      assert.ok(capability?.exposeToModel, `${shipped.name}: ${call.capability}`);
      assert.equal(capability.input.safeParse(call.input).success, true, JSON.stringify(call));
    }
  }
});

test('every create fixture replays cleanly against a freshly seeded trip', () => {
  for (const shipped of FIXTURES.filter((candidate) => candidate.kind === 'create_intent')) {
    const stager = createStager({
      capabilities: CAPABILITIES,
      snapshot: mapSnapshotRow(seedRow(travelWorkspace(TRIP_ID))),
      actor: 'ai',
      runId: RUN_ID,
      newId: idSequence(),
    });

    for (const call of shipped.steps.flat()) {
      stager.call(call.capability, call.input);
    }

    assert.ok(
      stager.graph().objects.some((object) => object.kind === 'place'),
      `${shipped.name} adds places`,
    );
  }
});
