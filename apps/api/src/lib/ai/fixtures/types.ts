import type { RunKind, RunRoute } from '@nexui/types';

import type { TemplateChoice } from '#lib/perception';

/** One tool call the model made, with the input it sent (refs, not ids). */
export interface FixtureToolCall {
  capability: string;
  input: Record<string, unknown>;
}

/**
 * A run recorded from live models by `scripts/record-fixture.mjs`, replayed when
 * `AI_PROVIDER=mock`.
 */
export interface RunFixture {
  name: string;
  kind: RunKind;
  /** Every phrase, in lowercase, must appear in the goal or the request. */
  match: readonly string[];
  /** What Jev answered. */
  perception: { template?: TemplateChoice; route?: RunRoute };
  /** Each model step's tool calls, in order. */
  steps: readonly (readonly FixtureToolCall[])[];
  /** What a structured-output call (a resume read) answers in mock mode, as JSON. */
  output?: unknown;
  /** Jev's probability for each `boolean` question, by question id (`questionId`), for a scan. */
  scores?: Readonly<Record<string, number>>;
}
