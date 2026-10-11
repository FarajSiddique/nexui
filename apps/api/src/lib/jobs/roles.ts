import { z } from 'zod';

import {
  boardSchema,
  fitSchema,
  jobKey,
  jobSourceSchema,
  OUTCOME_LABELS,
  outcomeSchema,
  passReasonSchema,
  salarySchema,
  STAGES,
  stageSchema,
  timestampSchema,
  workModeSchema,
  type ChangesetOp,
  type CompanyData,
  type GraphObject,
  type OpportunityData,
  type SearchData,
  type Stage,
} from '@nexui/types';

import {
  anchorParts,
  CapabilityError,
  checkNewRef,
  defineCapability,
  insertObject,
  link,
  nameOf,
  refInput,
  requireKind,
  type Capability,
  type CapabilityContext,
} from '#lib/capabilities';

import { companyName, compact } from './parts.ts';

/** A role to add: what a board lookup or the scan found, or what the user described. */
export const roleInputSchema = z.strictObject({
  company: z.strictObject({
    name: z.string().trim().min(1).max(100),
    domain: z
      .string()
      .regex(/^[a-z0-9.-]{1,253}$/)
      .optional(),
    board: boardSchema.optional(),
  }),
  title: z.string().trim().min(1).max(200),
  url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  source: jobSourceSchema.optional(),
  location: z.string().max(120).optional(),
  workMode: workModeSchema.optional(),
  salary: salarySchema.optional(),
  postedAt: timestampSchema.optional(),
  fit: fitSchema.optional(),
});

export type RoleInput = z.infer<typeof roleInputSchema>;

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const stageLabel = (stage: Stage): string =>
  STAGES.find((entry) => entry.value === stage)?.label ?? stage;

function searchOf(ctx: CapabilityContext): { object: GraphObject; data: SearchData } {
  const object = requireKind(ctx, ctx.refs.anchor, 'search');

  return { object, data: object.data as SearchData };
}

/** Whether the search never shows roles at this company. */
export function isExcluded(search: SearchData, company: string): boolean {
  return search.excludeCompanies.some((name) => sameName(name, company));
}

// The plan's company on that board, or with that name in any case.
function findCompany(
  ctx: CapabilityContext,
  company: RoleInput['company'],
): GraphObject | undefined {
  return anchorParts(ctx, 'company').find((candidate) => {
    const data = candidate.data as CompanyData;
    const sameBoard =
      company.board !== undefined &&
      data.board?.provider === company.board.provider &&
      data.board.token === company.board.token;

    return sameBoard || sameName(data.name, company.name);
  });
}

/** The plan's role for this posting, by its board key or its URL, whatever its stage. */
export function findRole(
  ctx: CapabilityContext,
  role: Pick<RoleInput, 'source' | 'url'>,
): GraphObject | undefined {
  const key = role.source ? jobKey(role.source) : null;

  return anchorParts(ctx, 'opportunity').find((candidate) => {
    const data = candidate.data as OpportunityData;

    return (
      (key !== null && data.source !== undefined && jobKey(data.source) === key) ||
      (role.url !== undefined && data.url === role.url)
    );
  });
}

/**
 * Ops that add a role to the search, `at` its company: the plan's when it has it (given the
 * board if it lacked one), else a new company that isn't a target. A role from a board is
 * stamped live now when `confirmed`: code read it from its board (the scan, or a button carrying
 * what a scan found), never on a model's word (Decision 21). Refused for a company the search
 * never shows, or a role the plan has.
 */
export function addRoleOps(
  ctx: CapabilityContext,
  role: RoleInput,
  stage: Stage,
  confirmed: boolean,
): { ops: ChangesetOp[]; roleId: string } {
  if (isExcluded(searchOf(ctx).data, role.company.name)) {
    throw new CapabilityError(`${role.company.name} is on this search's never-show list.`);
  }

  if (findRole(ctx, role)) {
    throw new CapabilityError(`${role.title} at ${role.company.name} is already in this search.`);
  }

  const ops: ChangesetOp[] = [];
  const known = findCompany(ctx, role.company);
  let companyId: string;

  if (known) {
    companyId = known.id;

    if (role.company.board && !(known.data as CompanyData).board) {
      ops.push({
        op: 'update_object',
        id: known.id,
        patch: { data: { ...known.data, board: role.company.board } },
        origin: 'direct',
      });
    }
  } else {
    companyId = ctx.newId();
    ops.push(
      insertObject(ctx, {
        id: companyId,
        kind: 'company',
        title: role.company.name,
        data: compact<CompanyData>({
          name: role.company.name,
          domain: role.company.domain,
          board: role.company.board,
          target: false,
        }),
        position: null,
      }),
      link(ctx, companyId, 'part_of', ctx.anchorId),
    );
  }

  const roleId = ctx.newId();
  const data = compact<OpportunityData>({
    title: role.title,
    url: role.url,
    source: role.source,
    location: role.location,
    workMode: role.workMode,
    salary: role.salary,
    postedAt: role.postedAt,
    fit: role.fit,
    stage,
    followUps: 0,
    lastSeenLiveAt: confirmed && role.source ? ctx.now : undefined,
  });

  ops.push(
    insertObject(ctx, { id: roleId, kind: 'opportunity', title: role.title, data, position: null }),
    link(ctx, roleId, 'part_of', ctx.anchorId),
    link(ctx, roleId, 'at', companyId),
  );

  return { ops, roleId };
}

const addRole = defineCapability({
  name: 'jobs.addRole',
  description:
    'Add a role to the search, in New, with its company. Use a posting jobs_lookup returned, ' +
    'copying its source and URL exactly, or a role the user described.',
  input: roleInputSchema.extend({
    ref: z.string().optional().describe('A new short ref for the role, such as halyard-pm'),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const { ref, ...role } = input;

    if (ref !== undefined) {
      checkNewRef(ctx.refs, ref);
    }

    // A model's word on a role is its title and where it is: the fit is the scan's judgement,
    // and liveness is what code checked (Decision 21). The app's buttons carry what a scan found.
    if (ctx.actor === 'ai') {
      delete role.fit;
    }

    const { ops, roleId } = addRoleOps(ctx, role, 'new', ctx.actor !== 'ai');
    const refs: Record<string, string> = {};

    if (ref !== undefined) {
      refs[ref] = roleId;
    }

    return {
      output: ref === undefined ? {} : { ref },
      ops,
      label: `Added ${role.title} at ${role.company.name}`,
      refs,
    };
  },
});

const setStage = defineCapability({
  name: 'jobs.setStage',
  description:
    'Move a role to another stage. Closing it needs an outcome: passed, rejected, withdrew, ' +
    'no_reply, posting_closed, declined or accepted. Accepted ends the search as hired, and only ' +
    'the user may set it.',
  input: z.strictObject({
    objectId: refInput,
    stage: stageSchema,
    outcome: outcomeSchema.optional(),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const role = requireKind(ctx, input.objectId, 'opportunity');
    const data = role.data as OpportunityData;

    if (input.stage === 'closed' && !input.outcome) {
      throw new CapabilityError('Say how the role closed, such as rejected or withdrew.');
    }

    if (input.stage !== 'closed' && input.outcome) {
      throw new CapabilityError('Only a closed role has an outcome.');
    }

    // Accept offer lives in the role sheet (spec section 8); it ends the search, so no model
    // decides it (Decision 21).
    if (input.outcome === 'accepted' && ctx.actor === 'ai') {
      throw new CapabilityError("Accepting an offer is the user's call, from the role's sheet.");
    }

    if (data.stage === input.stage && data.outcome === input.outcome) {
      throw new CapabilityError(`${nameOf(role)} is already ${stageLabel(input.stage)}.`);
    }

    const next: OpportunityData = { ...data, stage: input.stage };

    delete next.outcome;

    if (input.outcome) {
      next.outcome = input.outcome;
    }

    if (input.stage === 'applied' && !data.appliedAt) {
      next.appliedAt = ctx.now;
    }

    const label = input.outcome
      ? `Closed ${nameOf(role)} (${OUTCOME_LABELS[input.outcome]})`
      : `Moved ${nameOf(role)} to ${stageLabel(input.stage)}`;

    return {
      output: {},
      ops: [{ op: 'update_object', id: role.id, patch: { data: next }, origin: 'direct' }],
      label,
    };
  },
});

const pass = defineCapability({
  name: 'jobs.pass',
  description:
    'Pass on a role: it closes as passed, and a reason, if given, joins the pass reasons the ' +
    'scans learn from.',
  input: z.strictObject({ objectId: refInput, reason: passReasonSchema.optional() }),
  policy: 'internal',
  exposeToModel: false,
  callableByUser: true,
  execute(input, ctx) {
    const role = requireKind(ctx, input.objectId, 'opportunity');
    const data = role.data as OpportunityData;

    if (data.stage === 'closed') {
      throw new CapabilityError(`${nameOf(role)} is already closed.`);
    }

    const ops: ChangesetOp[] = [
      {
        op: 'update_object',
        id: role.id,
        patch: { data: { ...data, stage: 'closed', outcome: 'passed' } },
        origin: 'direct',
      },
    ];

    if (input.reason) {
      const search = searchOf(ctx);
      const entry = {
        reason: input.reason,
        company: companyName(ctx.graph, role).slice(0, 100),
        title: data.title,
        at: ctx.now,
      };

      ops.push({
        op: 'update_object',
        id: search.object.id,
        patch: {
          data: { ...search.data, passReasons: [...search.data.passReasons, entry].slice(-30) },
        },
        origin: 'direct',
      });
    }

    return { output: {}, ops, label: `Passed on ${nameOf(role)}` };
  },
});

const logContact = defineCapability({
  name: 'jobs.logContact',
  description:
    'Record contact about a role: sent (the user sent a follow-up) or received (the company ' +
    'replied).',
  input: z.strictObject({
    objectId: refInput,
    direction: z.enum(['sent', 'received']),
    at: timestampSchema.optional(),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const role = requireKind(ctx, input.objectId, 'opportunity');
    const data = role.data as OpportunityData;
    const next: OpportunityData = { ...data, lastContactAt: input.at ?? ctx.now };

    if (input.direction === 'sent') {
      next.followUps = Math.min(2, data.followUps + 1);
    }

    return {
      output: {},
      ops: [{ op: 'update_object', id: role.id, patch: { data: next }, origin: 'direct' }],
      label:
        input.direction === 'sent'
          ? `Sent a follow-up for ${nameOf(role)}`
          : `Heard back about ${nameOf(role)}`,
    };
  },
});

/** The capabilities that add a role and move it along. */
export const ROLE_CAPABILITIES: readonly Capability[] = [addRole, setStage, pass, logContact];
