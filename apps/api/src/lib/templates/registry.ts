import type { Template } from '@nexui/types';

import { TRAVEL_TEMPLATE } from '#lib/travel';

import type { TemplateDefinition } from './types.ts';

/** Every template, by name. A name `templateSchema` lists without an entry fails typecheck. */
export const TEMPLATES: Record<Template, TemplateDefinition> = {
  travel: TRAVEL_TEMPLATE,
};

/** The template an intent uses, or null for a goal Nexui can't plan yet. */
export function templateFor(name: Template | null): TemplateDefinition | null {
  return name === null ? null : TEMPLATES[name];
}
