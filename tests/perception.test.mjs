import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseTemplate, routeAsk } from '../apps/api/src/lib/perception/perceive.ts';
import { TEMPLATES } from '../apps/api/src/lib/templates/registry.ts';
import { Experimental_EvaluationMockModelV4, failingEvaluationModel } from './support/ai.mjs';

function answering(answers, seen = []) {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      seen.push(options);

      return { answers, warnings: [] };
    },
  });
}

test('Jev picks the template from the goal alone', async () => {
  const seen = [];
  const model = answering({ template: { type: 'choice', choice: 'none' } }, seen);
  const providerOptions = { gateway: { models: ['anthropic/claude-haiku-4.5'] } };

  assert.deepEqual(await chooseTemplate(model, 'Find a new job', { providerOptions }), {
    value: 'none',
    source: 'model',
  });
  assert.deepEqual(seen[0].state, { goal: 'Find a new job' });
  assert.deepEqual(Object.keys(seen[0].questions.template.criteria), ['travel', 'none']);
  assert.deepEqual(seen[0].providerOptions, providerOptions);
});

test('Jev routes an ask with the plan as context', async () => {
  const seen = [];
  const model = answering({ route: { type: 'choice', choice: 'edit' } }, seen);
  const ask = {
    text: 'Make Kyoto 3 days',
    goal: 'Plan Japan in December',
    summary: 'Dec 12 – 20, 8 days, 2 stops',
  };

  assert.deepEqual(await routeAsk(model, ask), { value: 'edit', source: 'model' });
  assert.deepEqual(seen[0].state, {
    goal: 'Plan Japan in December',
    plan: 'Dec 12 – 20, 8 days, 2 stops',
    request: 'Make Kyoto 3 days',
  });
  assert.deepEqual(Object.keys(seen[0].questions.route.criteria), ['edit', 'fast', 'reasoning']);
});

test('when Jev fails, a goal is a trip and an ask gets the reasoning tier', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  assert.deepEqual(await chooseTemplate(failingEvaluationModel(), 'Plan Japan'), {
    value: 'travel',
    source: 'fallback',
  });
  assert.deepEqual(
    await routeAsk(failingEvaluationModel(), { text: 'Hi there', goal: 'Plan Japan', summary: '' }),
    { value: 'reasoning', source: 'fallback' },
  );
  assert.equal(logged.mock.callCount(), 2);
  assert.equal(logged.mock.calls[0].arguments[0], '[perception]');
  assert.doesNotMatch(logged.mock.calls[0].arguments[1], /gateway unavailable/);
});

test('a slow Jev is abandoned after the timeout', async (t) => {
  t.mock.method(console, 'error', () => {});

  const slow = new Experimental_EvaluationMockModelV4({
    doEvaluate: ({ abortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve({ answers: { template: { type: 'choice', choice: 'none' } }, warnings: [] }),
          10_000,
        );

        abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      }),
  });
  const started = Date.now();

  assert.deepEqual(await chooseTemplate(slow, 'Plan Japan', { timeoutMs: 20 }), {
    value: 'travel',
    source: 'fallback',
  });
  assert.ok(Date.now() - started < 1_000);
});

test('a slow Jev is abandoned after the timeout when routing an ask', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  const slow = new Experimental_EvaluationMockModelV4({
    doEvaluate: ({ abortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ answers: { route: { type: 'choice', choice: 'edit' } }, warnings: [] }),
          10_000,
        );

        abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      }),
  });
  const started = Date.now();
  const ask = { text: 'Make Kyoto 3 days', goal: 'Plan Japan', summary: '' };

  assert.deepEqual(await routeAsk(slow, ask, { timeoutMs: 20 }), {
    value: 'reasoning',
    source: 'fallback',
  });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(logged.mock.calls[0].arguments[0], '[perception]');
  assert.equal(logged.mock.calls[0].arguments[1], 'Ask routing failed; using the reasoning tier.');
});

test("Jev reads each template's own sentence, then the one for no template", async () => {
  const seen = [];

  await chooseTemplate(
    answering({ template: { type: 'choice', choice: 'travel' } }, seen),
    'Plan Japan',
  );

  const { criteria } = seen[0].questions.template;

  assert.deepEqual(Object.keys(criteria), [...Object.keys(TEMPLATES), 'none']);

  for (const template of Object.values(TEMPLATES)) {
    assert.equal(criteria[template.name], template.perception);
  }
});
