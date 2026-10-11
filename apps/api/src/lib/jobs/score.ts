import { experimental_evaluate, type Experimental_EvaluationModel, type JSONValue } from 'ai';

import {
  PASS_REASONS,
  type Money,
  type ResumeProfile,
  type Salary,
  type SearchData,
} from '@nexui/types';

import type { GatewayOptions } from '#lib/ai';

import type { Posting } from './boards.ts';
import { compact } from './parts.ts';

/** At or above: a strong fit, for New (job search spec, section 5.4). */
export const STRONG_FIT = 0.85;

/** At or above, and below `STRONG_FIT`: worth the partial-fit card. */
export const PARTIAL_FIT = 0.6;

const SCORE_TIMEOUT_MS = 10_000;

/** What Jev and the explain call read about the person: the profile and criteria, never the resume. */
export interface Person {
  profile: ResumeProfile | null;
  criteria: {
    roles: string[];
    locations: string[];
    workModes: string[];
    salaryFloor: Money | null;
    industries: string[];
  };
  /** The last 10 roles they passed on, and why. */
  recentPasses: { reason: string; company: string; title: string }[];
}

export function personOf(search: SearchData, profile: ResumeProfile | null): Person {
  const reasonLabel = (reason: string): string =>
    PASS_REASONS.find((entry) => entry.value === reason)?.label ?? reason;

  return {
    profile,
    criteria: {
      roles: search.roles,
      locations: search.locations,
      workModes: search.workModes,
      salaryFloor: search.salaryFloor ?? null,
      industries: search.industries,
    },
    recentPasses: search.passReasons.slice(-10).map((pass) => ({
      reason: reasonLabel(pass.reason),
      company: pass.company,
      title: pass.title,
    })),
  };
}

/**
 * A Jev question id for a job key, which mock fixtures' `scores` use.
 *
 * @example
 * questionId('greenhouse:stripe:101') // 'greenhouse_stripe_101'
 */
export function questionId(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

function payText(salary: Salary | undefined): string | undefined {
  if (!salary) {
    return undefined;
  }

  const range = [salary.min, salary.max].filter((value) => value !== undefined).join('–');

  return `${range} ${salary.currency}`;
}

/** A role as one question carries it: title, company, place, mode, pay and a short summary. */
export function roleCard(posting: Posting): Record<string, unknown> {
  return compact({
    title: posting.title,
    company: posting.company,
    location: posting.location,
    workMode: posting.workMode,
    pay: payText(posting.salary),
    summary: posting.text.slice(0, 300) || undefined,
  });
}

const json = (value: unknown): JSONValue => JSON.parse(JSON.stringify(value)) as JSONValue;

/**
 * Scores candidates in one Jev call (spikes note 4.1): one `boolean` question per candidate,
 * "Is this a strong fit for this person?", each carrying its own role, since roles pointed at in
 * a large `state` silently lose their signal; `state` holds only the person. A 10-second abort
 * and one retry. Throws when Jev fails; the scan then surfaces nothing.
 */
export async function scoreRoles(
  person: Person,
  candidates: readonly Posting[],
  ai: { model: Experimental_EvaluationModel; providerOptions: GatewayOptions },
  budget?: AbortSignal,
): Promise<Map<string, number>> {
  const signals = [AbortSignal.timeout(SCORE_TIMEOUT_MS)];

  if (budget) {
    signals.push(budget);
  }

  const questions = Object.fromEntries(
    candidates.map((candidate) => [
      questionId(candidate.key),
      {
        type: 'boolean' as const,
        instructions: {
          ask: 'Is this a strong fit for this person?',
          role: json(roleCard(candidate)),
        },
      },
    ]),
  );
  const result = await experimental_evaluate({
    model: ai.model,
    state: { person: json(person) },
    questions,
    abortSignal: AbortSignal.any(signals),
    maxRetries: 1,
    providerOptions: ai.providerOptions,
  });
  const scores = new Map<string, number>();

  for (const candidate of candidates) {
    const answer = result.answers[questionId(candidate.key)];

    // A question Jev left unanswered has no score, so the scan neither shows nor drops it.
    if (answer?.type === 'boolean') {
      scores.set(candidate.key, answer.probability);
    }
  }

  return scores;
}
