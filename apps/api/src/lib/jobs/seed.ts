import {
  STAGES,
  type ChangesetOp,
  type GraphQuery,
  type InsightData,
  type KindName,
  type SearchData,
  type WorkspaceDoc,
} from '@nexui/types';

import type { SeedInput } from '#lib/templates';

type ObjectsQuery = Extract<GraphQuery, { from: 'objects' }>;

/** The derived key of the card about the resume, from the seed until a resume is read. */
export const RESUME_INSIGHT_KEY = 'search.resume';

/** The derived key of the partial-fit card a scan leaves ("Also worth a look"). */
export const PARTIAL_INSIGHT_KEY = 'search.partial';

/** The Open band's card while the plan waits for its resume (spec section 4, step 5). */
export const START_INSIGHT: InsightData = {
  text: 'Add your resume to start',
  detail:
    'Nexui uses it to screen roles and tailor your drafts. It reads the PDF once and doesn’t ' +
    'keep the file.',
  severity: 'attention',
  derivedKey: RESUME_INSIGHT_KEY,
  actions: [
    { type: 'upload', label: 'Add resume', docType: 'resume' },
    { type: 'start', label: 'Start without' },
  ],
};

function partOf(kind: KindName, searchId: string): ObjectsQuery {
  return {
    from: 'objects',
    kind,
    related: { type: 'part_of', to: { objectId: searchId }, direction: 'out' },
  };
}

/**
 * The job search workspace, top to bottom as spec section 3.2 draws it: the figures, the pinned
 * insights (decisions are added after them), interviews coming up, the pipeline, and the
 * companies the user named. The meta line is the app's.
 */
export function jobSearchWorkspace(searchId: string): WorkspaceDoc {
  return {
    version: 1,
    anchorId: searchId,
    sections: [
      {
        id: 'metrics',
        type: 'metric',
        metrics: [
          { label: 'new', derived: 'search.new', format: 'count', emphasis: 'whenPositive' },
          { label: 'in play', derived: 'search.inPlay', format: 'count' },
          { label: 'interviews this week', derived: 'search.interviewsThisWeek', format: 'count' },
        ],
      },
      {
        id: 'insights',
        type: 'insight',
        pin: 'open',
        query: { ...partOf('insight', searchId), sort: 'position' },
      },
      {
        id: 'coming-up',
        type: 'timeline',
        title: 'Coming up',
        query: { ...partOf('interview', searchId), sort: { field: 'data.at', dir: 'asc' } },
        dateField: 'data.at',
        labelField: 'data.label',
        empty: 'No interviews yet',
      },
      {
        id: 'pipeline',
        type: 'pipeline',
        title: 'Roles',
        query: { ...partOf('opportunity', searchId), sort: { field: 'createdAt', dir: 'desc' } },
        stageField: 'data.stage',
        stages: STAGES.map(({ value, label }) => ({ value, label })),
        collapsedStages: ['closed'],
        cardActions: [
          {
            stage: 'new',
            actions: [
              {
                label: 'Interested',
                capability: 'jobs.setStage',
                input: { stage: 'interested' },
                tone: 'primary',
              },
              { label: 'Pass', capability: 'jobs.pass', tone: 'secondary', pick: 'passReason' },
            ],
          },
        ],
      },
      {
        id: 'watching',
        type: 'objectList',
        title: 'Watching',
        query: {
          ...partOf('company', searchId),
          where: [{ field: 'data.target', op: 'eq', value: true }],
          sort: { field: 'createdAt', dir: 'asc' },
        },
        card: 'compact',
        empty: 'Name a company to watch its roles',
      },
    ],
  };
}

// A new search: no criteria yet, every work mode, checks on.
function newSearch(): SearchData {
  return {
    roles: [],
    locations: [],
    workModes: ['remote', 'hybrid', 'onsite'],
    industries: [],
    excludeCompanies: [],
    passReasons: [],
    status: 'active',
    roleChecks: 'on',
    forwarding: {},
  };
}

/**
 * A new job search: the search named after the goal, its workspace, the card asking for a
 * resume, and its bookkeeping with the device's time zone. The build run waits for `start`.
 */
export function seedJobSearchOps(input: SeedInput, newId: () => string): ChangesetOp[] {
  const searchId = newId();
  const insightId = newId();

  return [
    {
      op: 'insert_object',
      id: searchId,
      kind: 'search',
      kindVersion: 1,
      title: input.goal.trim().slice(0, 200),
      status: null,
      data: newSearch(),
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
    { op: 'set_workspace', doc: jobSearchWorkspace(searchId), origin: 'direct' },
    {
      op: 'insert_object',
      id: insightId,
      kind: 'insight',
      kindVersion: 1,
      title: START_INSIGHT.text,
      status: null,
      data: START_INSIGHT,
      source: { type: 'derived' },
      position: null,
      origin: 'direct',
    },
    {
      op: 'insert_relationship',
      id: newId(),
      sourceType: 'object',
      sourceId: insightId,
      targetType: 'object',
      targetId: searchId,
      type: 'part_of',
      metadata: null,
      origin: 'direct',
    },
    {
      op: 'update_intent',
      patch: { context: { jobs: { timezone: input.timezone, seen: [] } } },
      origin: 'direct',
    },
  ];
}
