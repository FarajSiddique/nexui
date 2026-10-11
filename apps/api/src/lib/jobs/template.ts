import type { TemplateDefinition } from '#lib/templates';

import { JOB_SEARCH_CAPABILITIES, JOBS_SCOPE } from './capabilities.ts';
import { JOB_SEARCH_LOOKUPS } from './lookups.ts';
import { RESUME_INTAKE } from './resume.ts';
import { jobsContext, jobsContextSchema } from './context.ts';
import { deriveJobSearch } from './derive.ts';
import { JOB_SEARCH_PROMPT } from './prompt.ts';
import { scanAfterBuild } from './scan.ts';
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
  singleActive: true,
  context: { jobs: jobsContextSchema },
  timeZone: (snapshot) => jobsContext(snapshot.intent)?.timezone,
  figures: [
    { key: 'new', label: 'new roles' },
    { key: 'inPlay', label: 'roles in play' },
  ],
  seed: seedJobSearchOps,
  derive: ({ staged, anchorId, now, newId }) => deriveJobSearch(staged, anchorId, now, newId),
  capabilities: JOB_SEARCH_CAPABILITIES,
  lookups: JOB_SEARCH_LOOKUPS,
  intake: RESUME_INTAKE,
  afterBuild: scanAfterBuild,
  prompt: JOB_SEARCH_PROMPT,
};
