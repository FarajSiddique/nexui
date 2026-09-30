import { createGateway, type Experimental_EvaluationModel, type LanguageModel } from 'ai';

import type { RunKind } from '@nexui/types';

import { gatewayOptions, readAiConfig, type GatewayOptions, type ModelPurpose } from './config.ts';
import { FIXTURES } from './fixtures/index.ts';
import { findFixture, mockEvaluationModel, mockLanguageModel } from './mock.ts';
import type { RunFixture } from './fixtures/types.ts';

export type ModelTier = 'fast' | 'reasoning';

/** The models for one goal or ask: Jev for perception and a language model per tier. */
export interface AiSession {
  evaluationModel: Experimental_EvaluationModel;
  /** A fresh model; a mock one replays its fixture from the first step. */
  languageModel(tier: ModelTier): LanguageModel;
  providerOptions(purpose: ModelPurpose): GatewayOptions;
}

export type OpenSession = (kind: RunKind, text: string) => AiSession;

type Env = Record<string, string | undefined>;

/**
 * Opens AI sessions as `AI_PROVIDER` says: live ones call Vercel AI Gateway with the configured
 * models and fallbacks; mock ones replay the fixture that matches the text.
 *
 * @example
 * const session = sessionOpener()('ask', 'Make Kyoto 3 days');
 * await routeAsk(session.evaluationModel, { text, goal, summary });
 */
export function sessionOpener(
  env: Env = process.env,
  fixtures: readonly RunFixture[] = FIXTURES,
): OpenSession {
  const config = readAiConfig(env);

  if (config.provider === 'mock') {
    return (kind, text) => {
      const fixture = findFixture(fixtures, kind, text);

      return {
        evaluationModel: mockEvaluationModel(fixture),
        languageModel: () => mockLanguageModel(fixture),
        providerOptions: () => undefined,
      };
    };
  }

  const gateway = createGateway({ apiKey: config.gatewayApiKey ?? undefined });

  return () => ({
    evaluationModel: gateway.evaluationModel(config.models.perception),
    languageModel: (tier) => gateway.languageModel(config.models[tier]),
    providerOptions: (purpose) => gatewayOptions(config.fallbacks[purpose]),
  });
}
