import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import {
  applyOps,
  boardSchema,
  fitSchema,
  fitsFreeJson,
  searchParts,
  type ChangesetOp,
  type CompanyData,
  type GraphSnapshot,
  type InsightAction,
  type InsightData,
} from '@nexui/types';

import {
  CapabilityError,
  defineCapability,
  insertObject,
  link,
  refInput,
  requireKind,
  type CapabilityContext,
} from '#lib/capabilities';

import { jobsContext, withJobs } from './context.ts';
import { addRoleOps, roleInputSchema } from './roles.ts';
import type { FoundRole } from './scan.ts';
import { PARTIAL_INSIGHT_KEY } from './seed.ts';

const foundRoleSchema = roleInputSchema.extend({ fit: fitSchema });

const surfaceInput = z.strictObject({
  roles: z.array(foundRoleSchema).max(3),
  partial: foundRoleSchema.optional(),
  seen: z.array(z.string().min(1).max(200)).max(25),
  boards: z.array(z.strictObject({ companyId: refInput, board: boardSchema })).max(5),
});

type CapabilityInput = Extract<InsightAction, { type: 'capability' }>['input'];

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

// The card's "Add it": the role for `jobs.addRole`, within the 2,000 characters an action's input
// may hold, without its fit if it must; no button when even that is too long.
function addAction(role: FoundRole): InsightAction | null {
  const bare: Partial<FoundRole> = { ...role };

  delete bare.fit;

  for (const input of [role, bare]) {
    if (fitsFreeJson(input)) {
      return {
        type: 'capability',
        label: 'Add it',
        name: 'jobs.addRole',
        input: JSON.parse(JSON.stringify(input)) as CapabilityInput,
      };
    }
  }

  return null;
}

// "Also worth a look: Senior PM, Treasury at Tessera." with "Strong on payments, but on-site four
// days in Leeds." (job search spec, section 5.4, step 6).
function partialCard(role: FoundRole): InsightData {
  const reason = role.fit.reasons[0] ?? 'Close to what you want';
  const gap = role.fit.gaps[0];
  const actions: InsightAction[] = [];
  const add = addAction(role);

  if (add) {
    actions.push(add);
  }

  actions.push({
    type: 'ask',
    label: 'Ask about it',
    prompt: `Tell me more about ${role.title} at ${role.company.name}`.slice(0, 300),
  });

  return {
    text: `Also worth a look: ${role.title} at ${role.company.name}.`.slice(0, 160),
    detail: (gap ? `${reason}, but ${lowerFirst(gap)}.` : `${reason}.`).slice(0, 300),
    severity: 'info',
    derivedKey: PARTIAL_INSIGHT_KEY,
    actions,
  };
}

function surfaceLabel(added: number, partial: boolean): string {
  if (added > 0) {
    return `Found ${added} new ${added === 1 ? 'role' : 'roles'}`;
  }

  return partial ? 'Found a role worth a look' : 'Checked the job boards';
}

/**
 * Commits what a scan found (job search spec, section 5.4, steps 6 and 7): the boards found for
 * named companies, up to 3 roles into New with their companies, the partial-fit card in place of
 * the last one, and the considered keys in `context.jobs.seen` (the last 300). One changeset, so
 * Undo reverts the whole scan. A role the plan gained meanwhile is skipped. Code only.
 */
export const surfaceMatches = defineCapability({
  name: 'jobs.surfaceMatches',
  description: "Commits what a job search's scan found. Code only.",
  input: surfaceInput,
  policy: 'internal',
  exposeToModel: false,
  callableByUser: false,
  execute(input, ctx) {
    const jobs = jobsContext(ctx.graph.intent);

    if (!jobs) {
      throw new CapabilityError('This plan has no job search.');
    }

    const ops: ChangesetOp[] = [];
    let graph: GraphSnapshot = ctx.graph;
    // Each part reads the plan as the parts before it left it, so two roles at one new company
    // share it.
    const stage = (more: ChangesetOp[]): void => {
      ops.push(...more);
      graph = applyOps(graph, more, ctx.now);
    };
    const here = (): CapabilityContext => ({ ...ctx, graph });
    let added = 0;

    for (const { companyId, board } of input.boards) {
      const company = requireKind(here(), companyId, 'company');

      if (!(company.data as CompanyData).board) {
        stage([
          {
            op: 'update_object',
            id: company.id,
            patch: { data: { ...company.data, board } },
            origin: 'direct',
          },
        ]);
      }
    }

    for (const role of input.roles) {
      try {
        stage(addRoleOps(here(), role, 'new', true).ops);
        added += 1;
      } catch (error) {
        if (!(error instanceof CapabilityError)) {
          throw error;
        }
      }
    }

    if (input.partial) {
      const data = partialCard(input.partial);
      const card = searchParts(graph, ctx.anchorId).insights.find(
        (insight) => (insight.data as InsightData).derivedKey === PARTIAL_INSIGHT_KEY,
      );

      if (card) {
        stage([
          { op: 'update_object', id: card.id, patch: { title: data.text, data }, origin: 'direct' },
        ]);
      } else {
        const id = ctx.newId();

        stage([
          insertObject(here(), { id, kind: 'insight', title: data.text, data, position: null }),
          link(here(), id, 'part_of', ctx.anchorId),
        ]);
      }
    }

    const seen = [...jobs.seen.filter((key) => !input.seen.includes(key)), ...input.seen].slice(
      -300,
    );

    if (!isDeepStrictEqual(seen, jobs.seen)) {
      stage([
        {
          op: 'update_intent',
          patch: { context: withJobs(ctx.graph.intent.context, { ...jobs, seen }) },
          origin: 'direct',
        },
      ]);
    }

    if (ops.length === 0) {
      throw new CapabilityError('Nothing to change.');
    }

    return { output: {}, ops, label: surfaceLabel(added, input.partial !== undefined) };
  },
});
