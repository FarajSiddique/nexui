import type { Template } from '@nexui/types';

import { JOB_SEARCH_TEMPLATE } from '#lib/jobs';
import { TRAVEL_TEMPLATE } from '#lib/travel';

import type { TemplateDefinition } from './types.ts';

/** Answers whether a template's gate, a Vercel flag, is on (`readFlag` in `lib/flags`). */
export type GateCheck = (flag: string) => Promise<boolean>;

/** Every template, by name. A name `templateSchema` lists without an entry fails typecheck. */
export const TEMPLATES: Record<Template, TemplateDefinition> = {
  travel: TRAVEL_TEMPLATE,
  job_search: JOB_SEARCH_TEMPLATE,
};

/** The template an intent uses, or null for a goal Nexui can't plan yet. */
export function templateFor(name: Template | null): TemplateDefinition | null {
  return name === null ? null : TEMPLATES[name];
}

/**
 * The templates Jev may route a new goal to: every one without a `gate`, and each whose gate
 * flag is on.
 *
 * @example
 * (await routableTemplates(async () => false)).map((template) => template.name) // ['travel']
 */
export async function routableTemplates(isOn: GateCheck): Promise<TemplateDefinition[]> {
  const templates = Object.values(TEMPLATES);
  const open = await Promise.all(
    templates.map((template) => (template.gate === undefined ? true : isOn(template.gate))),
  );

  return templates.filter((_, index) => open[index]);
}

/**
 * What Nexui says about a goal no template fits: the saved goal's summary line, and the refusal
 * to ask about it or change it (job search spec, section 2).
 */
export const UNSUPPORTED_GOAL = "Nexui can't plan this yet.";
