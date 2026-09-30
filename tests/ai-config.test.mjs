import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiConfigurationError,
  gatewayOptions,
  readAiConfig,
} from '../apps/api/src/lib/ai/config.ts';
import { graphErrorResponse } from '../apps/api/src/lib/graph/respond.ts';

test('mock is the default and needs no key', () => {
  const config = readAiConfig({});

  assert.equal(config.provider, 'mock');
  assert.equal(config.gatewayApiKey, null);
  assert.deepEqual(config.models, {
    perception: 'typesafe-ai/jev',
    fast: 'anthropic/claude-haiku-4.5',
    reasoning: 'anthropic/claude-sonnet-5.5',
  });
  assert.deepEqual(config.fallbacks, {
    perception: [],
    fast: ['anthropic/claude-sonnet-5'],
    reasoning: ['anthropic/claude-sonnet-5'],
  });
});

test('live needs the Gateway key', () => {
  assert.throws(
    () => readAiConfig({ AI_PROVIDER: 'live' }),
    (error) =>
      error instanceof AiConfigurationError &&
      error.message === 'AI_PROVIDER=live needs AI_GATEWAY_API_KEY.',
  );
  assert.equal(
    readAiConfig({ AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: ' vck_test ' }).gatewayApiKey,
    'vck_test',
  );
});

test('an unknown provider is refused', () => {
  assert.throws(() => readAiConfig({ AI_PROVIDER: 'openai' }), /AI_PROVIDER must be mock or live/);
});

test('tiers and fallbacks come from the environment', () => {
  const config = readAiConfig({
    NEXUI_MODEL_FAST: 'anthropic/claude-sonnet-5',
    NEXUI_MODEL_REASONING: ' anthropic/claude-opus-5.5 ',
    NEXUI_MODEL_REASONING_FALLBACKS: 'anthropic/claude-sonnet-5.5, anthropic/claude-sonnet-5',
    NEXUI_MODEL_FAST_FALLBACKS: '',
  });

  assert.equal(config.models.fast, 'anthropic/claude-sonnet-5');
  assert.equal(config.models.reasoning, 'anthropic/claude-opus-5.5');
  assert.deepEqual(config.fallbacks.reasoning, [
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-sonnet-5',
  ]);
  assert.deepEqual(config.fallbacks.fast, []);
  assert.equal(config.models.perception, 'typesafe-ai/jev');
});

test('a malformed model id names the variable, not the value', () => {
  assert.throws(
    () => readAiConfig({ NEXUI_MODEL_FAST: 'haiku please; rm -rf' }),
    (error) =>
      error instanceof AiConfigurationError &&
      error.message.startsWith('NEXUI_MODEL_FAST must be a Gateway model id') &&
      !error.message.includes('rm -rf'),
  );
  assert.throws(
    () => readAiConfig({ NEXUI_MODEL_REASONING_FALLBACKS: 'anthropic/ok,bad id' }),
    /NEXUI_MODEL_REASONING_FALLBACKS must be a Gateway model id/,
  );
});

test('gatewayOptions is empty without fallbacks', () => {
  assert.equal(gatewayOptions([]), undefined);
  assert.deepEqual(gatewayOptions(['anthropic/claude-sonnet-5']), {
    gateway: { models: ['anthropic/claude-sonnet-5'] },
  });
});

test('a configuration error is logged by its message and answered with a safe 500', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const response = graphErrorResponse(
    new AiConfigurationError('AI_PROVIDER must be mock or live.'),
    '[intents]',
    'Could not start that plan',
    {},
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Could not start that plan. Try again.');
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[intents]',
    'AI_PROVIDER must be mock or live.',
  ]);
});
