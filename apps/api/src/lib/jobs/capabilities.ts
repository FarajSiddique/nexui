import { z } from 'zod';

import {
  interviewDataSchema,
  personDataSchema,
  type ChangesetOp,
  type DocumentData,
  type GraphObject,
  type InterviewData,
  type OpportunityData,
  type PersonData,
  type SearchData,
  type Stage,
} from '@nexui/types';

import {
  CapabilityError,
  checkNewRef,
  decisionCapabilities,
  defineCapability,
  graphCapabilities,
  insertObject,
  link,
  nameOf,
  refInput,
  requireKind,
  resolveRef,
  workspaceCapabilities,
  type Capability,
  type CapabilityContext,
  type CapabilityScope,
} from '#lib/capabilities';

import { JOB_DECISIONS } from './decisions.ts';
import { compact } from './parts.ts';
import { ROLE_CAPABILITIES } from './roles.ts';

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

// Stages an interview moves a role on from.
const BEFORE_INTERVIEWS: readonly Stage[] = ['new', 'interested', 'applied'];

const DRAFT_TYPES = ['cover_letter', 'brief', 'follow_up', 'withdrawal'] as const;

const DRAFT_LABELS: Record<(typeof DRAFT_TYPES)[number], string> = {
  cover_letter: 'Cover letter',
  brief: 'Brief',
  follow_up: 'Follow-up',
  withdrawal: 'Withdrawal note',
};

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// The people already linked `for` a role.
function peopleFor(ctx: CapabilityContext, roleId: string): GraphObject[] {
  const ids = new Set(
    ctx.graph.relationships
      .filter((edge) => edge.type === 'for' && edge.targetId === roleId)
      .map((edge) => edge.sourceId),
  );

  return ctx.graph.objects.filter((object) => object.kind === 'person' && ids.has(object.id));
}

const addInterview = defineCapability({
  name: 'jobs.addInterview',
  description:
    'Add an interview for a role, and who it is with, and move the role to Interviewing. at is ' +
    'an ISO date-time with offset, or a date when no time was given.',
  input: z.strictObject({
    objectId: refInput,
    ref: z.string().optional().describe('A new short ref for the interview, such as screen'),
    at: interviewDataSchema.shape.at,
    label: z.string().trim().min(1).max(60),
    with: z
      .strictObject({
        name: z.string().trim().min(1).max(100),
        role: personDataSchema.shape.role.optional(),
        email: z.email().max(200).optional(),
      })
      .optional(),
    link: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .optional(),
    notes: z.string().max(500).optional(),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    if (input.ref !== undefined) {
      checkNewRef(ctx.refs, input.ref);
    }

    const role = requireKind(ctx, input.objectId, 'opportunity');
    const roleData = role.data as OpportunityData;

    if (roleData.stage === 'closed') {
      throw new CapabilityError(`${nameOf(role)} is closed.`);
    }

    const interviewId = ctx.newId();
    const ops: ChangesetOp[] = [
      insertObject(ctx, {
        id: interviewId,
        kind: 'interview',
        title: input.label,
        data: compact<InterviewData>({
          at: input.at,
          label: input.label,
          with: input.with?.name,
          link: input.link,
          notes: input.notes,
        }),
        position: null,
      }),
      link(ctx, interviewId, 'part_of', ctx.anchorId),
      link(ctx, interviewId, 'for', role.id),
    ];
    const person = input.with;

    if (
      person &&
      !peopleFor(ctx, role.id).some(
        (known) => (known.data as PersonData).name.toLowerCase() === person.name.toLowerCase(),
      )
    ) {
      const personId = ctx.newId();

      ops.push(
        insertObject(ctx, {
          id: personId,
          kind: 'person',
          title: person.name,
          data: compact<PersonData>({
            name: person.name,
            role: person.role ?? 'interviewer',
            email: person.email,
          }),
          position: null,
        }),
        link(ctx, personId, 'part_of', ctx.anchorId),
        link(ctx, personId, 'for', role.id),
      );
    }

    if (BEFORE_INTERVIEWS.includes(roleData.stage)) {
      ops.push({
        op: 'update_object',
        id: role.id,
        patch: { data: { ...roleData, stage: 'interviewing' } },
        origin: 'direct',
      });
    }

    const refs: Record<string, string> = {};

    if (input.ref !== undefined) {
      refs[input.ref] = interviewId;
    }

    return {
      output: input.ref === undefined ? {} : { ref: input.ref },
      ops,
      label: `Added ${input.label} for ${nameOf(role)}`,
      refs,
    };
  },
});

const draft = defineCapability({
  name: 'jobs.draft',
  description:
    'Write a draft for a role or an interview: a cover letter, a brief (an application brief ' +
    'for a role, an interview brief for an interview), a follow-up email or a withdrawal note. ' +
    'Nothing is sent.',
  input: z.strictObject({
    for: refInput,
    docType: z.enum(DRAFT_TYPES),
    body: z.string().trim().min(1).max(8_000),
    subject: z.string().max(200).optional(),
    to: z.email().max(200).optional(),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const target = resolveRef(ctx.refs, ctx.graph, input.for);

    if (target.kind !== 'opportunity' && target.kind !== 'interview') {
      throw new CapabilityError(`A draft is for a role or an interview, not ${nameOf(target)}.`);
    }

    const id = ctx.newId();
    const kind = DRAFT_LABELS[input.docType];

    return {
      output: {},
      ops: [
        insertObject(ctx, {
          id,
          kind: 'document',
          title: `${kind} for ${nameOf(target)}`.slice(0, 200),
          data: compact<DocumentData>({
            docType: input.docType,
            body: input.body,
            subject: input.subject,
            to: input.to,
          }),
          position: null,
        }),
        link(ctx, id, 'part_of', ctx.anchorId),
        link(ctx, id, 'for', target.id),
      ],
      label: `Drafted a ${kind.toLowerCase()} for ${nameOf(target)}`,
    };
  },
});

const setSearchStatus = defineCapability({
  name: 'jobs.setSearchStatus',
  description:
    'Pause or resume the search (status), or resume new-role checks after they paused ' +
    '(roleChecks on).',
  input: z.strictObject({
    status: z.enum(['active', 'paused']).optional(),
    roleChecks: z.literal('on').optional(),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const search = requireKind(ctx, ctx.refs.anchor, 'search');
    const data = search.data as SearchData;

    if (data.status === 'hired') {
      throw new CapabilityError('This search ended with a hire.');
    }

    const next: SearchData = { ...data };
    const changes: string[] = [];

    if (input.status && input.status !== data.status) {
      next.status = input.status;
      changes.push(input.status === 'paused' ? 'paused the search' : 'resumed the search');
    }

    if (input.roleChecks && data.roleChecks !== 'on') {
      next.roleChecks = 'on';
      changes.push('resumed new-role checks');
    }

    if (changes.length === 0) {
      throw new CapabilityError('The search is already like that.');
    }

    return {
      output: {},
      ops: [{ op: 'update_object', id: search.id, patch: { data: next }, origin: 'direct' }],
      label: capitalized(changes.join(' and ')),
    };
  },
});

/**
 * Everything a job search's runs and buttons may call, in the order models see it: the graph
 * capabilities, job search's own (Tasks 5, 7 and 14), decisions, then the workspace layout.
 * `derive.jobSearch` isn't one: it runs inside every changeset.
 */
export const JOB_SEARCH_CAPABILITIES: readonly Capability[] = [
  ...graphCapabilities(JOBS_SCOPE),
  ...ROLE_CAPABILITIES,
  addInterview,
  draft,
  setSearchStatus,
  ...decisionCapabilities(JOBS_SCOPE, JOB_DECISIONS),
  ...workspaceCapabilities(JOBS_SCOPE),
];
