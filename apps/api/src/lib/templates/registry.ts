import type { Template } from '@nexui/types';

import { JOB_SEARCH_TEMPLATE } from '#lib/jobs';
import { TRAVEL_TEMPLATE } from '#lib/travel';

import type { TemplateDefinition } from './types.ts';

type Env = Record<string, string | undefined>;

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
 * variable is `on`.
 *
 * @example
 * routableTemplates({}).map((template) => template.name) // ['travel']
 */
export function routableTemplates(env: Env = process.env): TemplateDefinition[] {
  return Object.values(TEMPLATES).filter(
    (template) => template.gate === undefined || env[template.gate]?.trim() === 'on',
  );
}

/**
 * What Nexui says about a goal no template fits: the saved goal's summary line, and the refusal
 * to ask about it or change it (job search spec, section 2).
 */
export const UNSUPPORTED_GOAL = "Nexui can't plan this yet.";
