export type AiProviderName = 'mock' | 'live';
export type ModelPurpose = 'perception' | 'fast' | 'reasoning';

export interface AiConfig {
  provider: AiProviderName;
  gatewayApiKey: string | null;
  /** Gateway model ids: Jev for perception, then the two cognition tiers. */
  models: Record<ModelPurpose, string>;
  /** Tried in order by the Gateway when the main model fails. */
  fallbacks: Record<ModelPurpose, string[]>;
}

/** Gateway provider options that add fallback models, or nothing. */
export type GatewayOptions = { gateway: { models: string[] } } | undefined;

type Env = Record<string, string | undefined>;

/** Nexui's AI settings are missing or malformed. `message` names the variable, never its value. */
export class AiConfigurationError extends Error {}

const MODEL_ID = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/;

const ENV_NAMES: Record<ModelPurpose, string> = {
  perception: 'NEXUI_MODEL_PERCEPTION',
  fast: 'NEXUI_MODEL_FAST',
  reasoning: 'NEXUI_MODEL_REASONING',
};

const DEFAULT_MODELS: Record<ModelPurpose, string> = {
  perception: 'typesafe-ai/jev',
  fast: 'anthropic/claude-haiku-4.5',
  reasoning: 'anthropic/claude-sonnet-5.5',
};

const DEFAULT_FALLBACKS: Record<ModelPurpose, string[]> = {
  perception: [],
  fast: ['anthropic/claude-sonnet-5'],
  reasoning: ['anthropic/claude-sonnet-5'],
};

function checkModelId(name: string, value: string): string {
  if (!MODEL_ID.test(value)) {
    throw new AiConfigurationError(
      `${name} must be a Gateway model id such as anthropic/claude-haiku-4.5.`,
    );
  }

  return value;
}

function readModel(env: Env, purpose: ModelPurpose): string {
  const name = ENV_NAMES[purpose];
  const value = env[name]?.trim();

  return value ? checkModelId(name, value) : DEFAULT_MODELS[purpose];
}

// Unset keeps the default; an empty value turns fallbacks off.
function readFallbacks(env: Env, purpose: ModelPurpose): string[] {
  const name = `${ENV_NAMES[purpose]}_FALLBACKS`;
  const value = env[name];

  if (value === undefined) {
    return [...DEFAULT_FALLBACKS[purpose]];
  }

  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => checkModelId(name, id));
}

/**
 * Reads the AI settings. `AI_PROVIDER` is `mock` (the default: recorded fixtures, no network) or
 * `live` (Vercel AI Gateway, which needs `AI_GATEWAY_API_KEY`).
 *
 * @example
 * readAiConfig({ AI_PROVIDER: 'live', AI_GATEWAY_API_KEY: 'vck_…' }).models.fast
 * // 'anthropic/claude-haiku-4.5'
 */
export function readAiConfig(env: Env = process.env): AiConfig {
  const provider = env.AI_PROVIDER?.trim() || 'mock';

  if (provider !== 'mock' && provider !== 'live') {
    throw new AiConfigurationError('AI_PROVIDER must be mock or live.');
  }

  const gatewayApiKey = env.AI_GATEWAY_API_KEY?.trim() || null;

  if (provider === 'live' && !gatewayApiKey) {
    throw new AiConfigurationError('AI_PROVIDER=live needs AI_GATEWAY_API_KEY.');
  }

  return {
    provider,
    gatewayApiKey,
    models: {
      perception: readModel(env, 'perception'),
      fast: readModel(env, 'fast'),
      reasoning: readModel(env, 'reasoning'),
    },
    fallbacks: {
      perception: readFallbacks(env, 'perception'),
      fast: readFallbacks(env, 'fast'),
      reasoning: readFallbacks(env, 'reasoning'),
    },
  };
}

/**
 * @example
 * gatewayOptions(['anthropic/claude-sonnet-5']) // { gateway: { models: ['anthropic/claude-sonnet-5'] } }
 */
export function gatewayOptions(models: readonly string[]): GatewayOptions {
  return models.length > 0 ? { gateway: { models: [...models] } } : undefined;
}
