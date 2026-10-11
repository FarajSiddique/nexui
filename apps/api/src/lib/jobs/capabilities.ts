import {
  decisionCapabilities,
  graphCapabilities,
  workspaceCapabilities,
  type Capability,
  type CapabilityScope,
} from '#lib/capabilities';

import { JOB_DECISIONS } from './decisions.ts';

/** A job search's kinds, for the generic capabilities, and the examples their descriptions use. */
export const JOBS_SCOPE: CapabilityScope = {
  anchorKind: 'search',
  kinds: [
    'search',
    'company',
    'opportunity',
    'person',
    'interview',
    'document',
    'decision',
    'option',
    'insight',
    'thing',
  ],
  examples: {
    objectRef: 'stripe or halyard-recruiter',
    decisionRef: 'work-mode',
    metric: '{"daysInOffice": 2}',
    sectionId: 'target-companies',
    field: 'data.stage',
  },
};

/**
 * Everything a job search's runs and buttons may call, in the order models see it: the graph
 * capabilities, job search's own (Tasks 5, 7 and 14), decisions, then the workspace layout.
 * `derive.jobSearch` isn't one: it runs inside every changeset.
 */
export const JOB_SEARCH_CAPABILITIES: readonly Capability[] = [
  ...graphCapabilities(JOBS_SCOPE),
  ...decisionCapabilities(JOBS_SCOPE, JOB_DECISIONS),
  ...workspaceCapabilities(JOBS_SCOPE),
];
