import type { TemplateDefinition } from '#lib/templates';

import { JOB_SEARCH_CAPABILITIES, JOBS_SCOPE } from './capabilities.ts';
import { RESUME_INTAKE } from './resume.ts';
import { jobsContextSchema } from './context.ts';
import { deriveJobSearch } from './derive.ts';
import { JOB_SEARCH_PROMPT } from './prompt.ts';
import { seedJobSearchOps } from './seed.ts';

/** Job search (job search spec): Nexui's second template, declared like the first. */
export const JOB_SEARCH_TEMPLATE: TemplateDefinition = {
  name: 'job_search',
  anchorKind: 'search',
  anchorRef: 'search',
  kinds: JOBS_SCOPE.kinds,
  perception:
    'Getting a job: a job search, a career move, roles at named companies, or one application ' +
    'or interview, such as prep for a Google interview.',
  gate: 'JOB_SEARCH',
  context: { jobs: jobsContextSchema },
  figures: [
    { key: 'new', label: 'new roles' },
    { key: 'inPlay', label: 'roles in play' },
  ],
  seed: seedJobSearchOps,
  derive: ({ staged, anchorId, now, newId }) => deriveJobSearch(staged, anchorId, now, newId),
  capabilities: JOB_SEARCH_CAPABILITIES,
  intake: RESUME_INTAKE,
  prompt: JOB_SEARCH_PROMPT,
};
