import { INTENT_ID, STAMP } from './graph.mjs';

export const SEARCH_ID = 'f0000000-0000-4000-8000-000000000001';
export const COMPANY_ID = 'f0000000-0000-4000-8000-000000000002';
export const ROLE_ID = 'f0000000-0000-4000-8000-000000000003';
export const OTHER_ROLE_ID = 'f0000000-0000-4000-8000-000000000004';
export const INTERVIEW_ID = 'f0000000-0000-4000-8000-000000000005';
export const RESUME_ID = 'f0000000-0000-4000-8000-000000000006';

/** A search whose build run has set its criteria. */
export const searchData = {
  roles: ['Staff Product Manager'],
  locations: ['London'],
  workModes: ['hybrid', 'remote'],
  industries: ['fintech'],
  excludeCompanies: [],
  passReasons: [],
  status: 'active',
  roleChecks: 'on',
  forwarding: {},
};

/** A role's data: in New, from a Greenhouse board, unless `changes` says otherwise. */
export function roleData(changes = {}) {
  return {
    title: 'Staff Product Manager, Payments',
    url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
    source: { provider: 'greenhouse', token: 'halyard', job: '101' },
    location: 'London',
    workMode: 'hybrid',
    stage: 'new',
    followUps: 0,
    ...changes,
  };
}

/** One graph object in contract shape, in the fixture intent. */
export function jobObject(id, kind, data, extra = {}) {
  return {
    id,
    intentId: INTENT_ID,
    kind,
    kindVersion: 1,
    title: null,
    status: null,
    data,
    source: { type: 'user' },
    position: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

/** One object-to-object link in contract shape; `n` picks its id. */
export function jobLink(n, sourceId, targetId, type = 'part_of') {
  return {
    id: `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    intentId: INTENT_ID,
    sourceType: 'object',
    sourceId,
    targetType: 'object',
    targetId,
    type,
    metadata: null,
    createdAt: STAMP,
  };
}

/**
 * A job search intent in contract shape: the search, then `objects`, each `part_of` the search,
 * then `links`. Built directly rather than through `mapSnapshotRow`. By default the plan has
 * started and its workspace has no sections; pass `doc: jobSearchWorkspace(SEARCH_ID)` once it
 * exists (Task 4) when a capability needs one.
 */
export function jobSnapshot({
  objects = [],
  links = [],
  search = searchData,
  context = { jobs: { timezone: 'Europe/London', startedAt: STAMP, seen: [] } },
  doc = { version: 1, anchorId: SEARCH_ID, sections: [] },
} = {}) {
  return {
    intent: {
      id: INTENT_ID,
      goal: 'Find a Staff PM role in London',
      template: 'job_search',
      status: 'exploring',
      context,
      summary: { line: '' },
      createdAt: STAMP,
      updatedAt: STAMP,
      lastActivityAt: STAMP,
    },
    workspace: { intentId: INTENT_ID, version: 1, doc, updatedAt: STAMP },
    objects: [
      jobObject(SEARCH_ID, 'search', search, { title: 'Find a Staff PM role in London' }),
      ...objects,
    ],
    relationships: [
      ...objects.map((object, index) => jobLink(100 + index, object.id, SEARCH_ID)),
      ...links,
    ],
  };
}
