import {
  OUTCOME_LABELS,
  WORK_MODES,
  type OpportunityData,
  type Outcome,
  type Salary,
  type WorkMode,
} from '@nexui/types';

import { capitalize, formatMoney } from '#lib';

/** @example workModeLabel('onsite') // 'On-site' */
export function workModeLabel(mode: WorkMode): string {
  return WORK_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

/**
 * A role's pay as the board gave it.
 *
 * @example
 * salaryText({ min: 130000, max: 150000, currency: 'GBP' }) // '£130k–£150k'
 * salaryText({ min: 90000, currency: 'USD' }) // 'from $90k'
 */
export function salaryText(salary: Salary | undefined): string {
  if (!salary) {
    return '';
  }

  const money = (amount: number): string => formatMoney({ amount, currency: salary.currency });

  if (salary.min !== undefined && salary.max !== undefined) {
    return salary.min === salary.max
      ? money(salary.min)
      : `${money(salary.min)}–${money(salary.max)}`;
  }

  if (salary.min !== undefined) {
    return `from ${money(salary.min)}`;
  }

  return salary.max === undefined ? '' : `up to ${money(salary.max)}`;
}

/** Where a role is and how it's worked: "London, hybrid", "On-site", or ''. */
export function placeLine(role: Pick<OpportunityData, 'location' | 'workMode'>): string {
  const mode = role.workMode ? workModeLabel(role.workMode) : '';
  // A role the user or a model added can have a blank location.
  const location = role.location ?? '';

  if (location && mode) {
    return `${location}, ${mode.toLowerCase()}`;
  }

  return location || mode;
}

/** A role's card line, leaving out what it lacks: "Halyard · London, hybrid · £130k–£150k". */
export function roleLine(role: OpportunityData, company: string | null): string {
  return [company ?? '', placeLine(role), salaryText(role.salary)]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/** @example outcomeLabel('no_reply') // 'No reply' */
export function outcomeLabel(outcome: Outcome): string {
  return capitalize(OUTCOME_LABELS[outcome]);
}

/**
 * The host a role's link opens, shown before the user leaves the app: a role a model added may
 * link to any https page (PR #43). Null for a link that isn't https or doesn't parse.
 *
 * @example linkHost('https://apply.example.net/jobs/1?ref=x') // 'apply.example.net'
 */
export function linkHost(url: string): string | null {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}
