import { z } from 'zod';

import type { ChangesetOp, DecisionData, OptionData, Section } from '@nexui/types';

import { refInput } from './graph.ts';
import {
  insertObject,
  link,
  nameOf,
  placeSection,
  requireDoc,
  requireKind,
  setSections,
  type SectionSlot,
} from './helpers.ts';
import { checkNewRef, resolveRef } from './refs.ts';
import {
  CapabilityError,
  defineCapability,
  shapedInput,
  type Capability,
  type CapabilityScope,
  type DecisionOptions,
  type OptionInput,
} from './types.ts';

interface ProposeInput {
  ref: string;
  question: string;
  tradeoff?: string | undefined;
  options: OptionInput[];
}

// An option's fields: the ones every template shares, then the template's own.
function optionSchema(scope: CapabilityScope, options: DecisionOptions | undefined): z.ZodType {
  return z.strictObject({
    label: z.string().min(1).max(100),
    summary: z.string().max(400),
    pros: z.array(z.string().max(120)).max(8).optional(),
    cons: z.array(z.string().max(120)).max(8).optional(),
    metrics: z
      .record(z.string().max(40), z.number())
      .optional()
      .describe(`Up to 12 numbers to compare, such as ${scope.examples.metric}`),
    fit: z
      .string()
      .max(120)
      .optional()
      .describe(`One line on how it fits this ${scope.anchorKind}`),
    ...options?.fields,
  });
}

function propose(scope: CapabilityScope, options: DecisionOptions | undefined): Capability {
  const base =
    'Put a choice to the user: a question with 2 to 4 options, pinned at the top of the plan. ' +
    'Use it instead of choosing for them.';

  return defineCapability<ProposeInput>({
    name: 'decision.propose',
    description: options ? `${base} ${options.proposeHelp}` : base,
    input: shapedInput<ProposeInput>(
      z.strictObject({
        ref: z
          .string()
          .describe(`A new short ref for the decision, such as ${scope.examples.decisionRef}`),
        question: z.string().min(1).max(200),
        tradeoff: z
          .string()
          .max(400)
          .optional()
          .describe('What the choice trades off, in a sentence'),
        options: z.array(optionSchema(scope, options)).min(2).max(4),
      }),
    ),
    policy: 'internal',
    exposeToModel: true,
    callableByUser: false,
    execute(input, ctx) {
      checkNewRef(ctx.refs, input.ref);

      const doc = requireDoc(ctx);
      const decisionId = ctx.newId();
      const decision: DecisionData = { question: input.question, status: 'open' };

      if (input.tradeoff) {
        decision.tradeoff = input.tradeoff;
      }

      if (ctx.actor === 'ai' && ctx.request) {
        // Cutting inside an emoji leaves half a surrogate pair, which Postgres rejects in jsonb.
        decision.asked = ctx.request.slice(0, 300).replace(/[\uD800-\uDBFF]$/, '');
      }

      const ops: ChangesetOp[] = [
        insertObject(ctx, {
          id: decisionId,
          kind: 'decision',
          title: input.question,
          data: decision,
          position: null,
        }),
        link(ctx, decisionId, 'part_of', ctx.anchorId),
      ];
      const refs: Record<string, string> = { [input.ref]: decisionId };
      const optionRefs: string[] = [];

      input.options.forEach((option, index) => {
        const optionRef = `${input.ref}-${index + 1}`;
        const optionId = ctx.newId();
        const data: OptionData = {
          label: option.label,
          summary: option.summary,
          pros: option.pros ?? [],
          cons: option.cons ?? [],
          metrics: option.metrics ?? {},
        };

        if (option.fit) {
          data.fit = option.fit;
        }

        // What the template's option carries, such as a trip's candidate place, comes first.
        const carried = options?.propose(option, ctx, optionRef);

        if (carried) {
          Object.assign(data, carried.data);
          Object.assign(refs, carried.refs);
          ops.push(...carried.ops);
        }

        refs[optionRef] = optionId;
        optionRefs.push(optionRef);
        ops.push(
          insertObject(ctx, {
            id: optionId,
            kind: 'option',
            title: option.label,
            data,
            position: index + 1,
          }),
          link(ctx, optionId, 'option_of', decisionId),
        );
      });

      for (const ref of Object.keys(refs)) {
        if (ctx.refs.byRef.has(ref)) {
          throw new CapabilityError(`The ref "${ref}" is already used.`);
        }
      }

      const section: Section = {
        id: `decision-${decisionId}`,
        type: 'decision',
        decisionId,
        pin: 'open',
        fields: [
          { field: 'data.summary', label: 'Summary' },
          { field: 'data.fit', label: 'Fit' },
        ],
      };
      const slot: SectionSlot = doc.sections.some((existing) => existing.id === 'insights')
        ? { after: 'insights' }
        : 'last';

      ops.push(setSections(doc, placeSection(doc.sections, section, slot)));

      return {
        output: { ref: input.ref, options: optionRefs },
        ops,
        label: `Asked "${input.question}"`,
        refs,
      };
    },
  });
}

function resolve(scope: CapabilityScope, options: DecisionOptions | undefined): Capability {
  const base =
    'Settle an open decision with one of its options, or dismiss it by leaving optionId out.';

  return defineCapability({
    name: 'decision.resolve',
    description: options ? `${base} ${options.resolveHelp}` : base,
    input: z.strictObject({ decisionId: refInput, optionId: refInput.optional() }),
    policy: 'internal',
    exposeToModel: true,
    callableByUser: true,
    execute(input, ctx) {
      const decision = requireKind(ctx, input.decisionId, 'decision');
      const data = decision.data as DecisionData;

      if (data.status !== 'open') {
        throw new CapabilityError('That question is already settled.');
      }

      if (data.derivedKey) {
        throw new CapabilityError(
          `That question settles itself as the ${scope.anchorKind} changes.`,
        );
      }

      let next: DecisionData = { ...data, status: 'dismissed' };
      let label = `Dismissed "${data.question}"`;
      const chosenOps: ChangesetOp[] = [];

      if (input.optionId) {
        const option = resolveRef(ctx.refs, ctx.graph, input.optionId);
        const belongs =
          option.kind === 'option' &&
          ctx.graph.relationships.some(
            (edge) =>
              edge.type === 'option_of' &&
              edge.sourceId === option.id &&
              edge.targetId === decision.id,
          );

        if (!belongs) {
          throw new CapabilityError(`${nameOf(option)} is not an option for this question.`);
        }

        next = { ...data, status: 'resolved', chosenOptionId: option.id };
        label = `Chose ${nameOf(option)}`;
        chosenOps.push(...(options?.choose(ctx, option) ?? []));
      }

      const chosenOptionId = next.status === 'resolved' ? (next.chosenOptionId ?? null) : null;
      const ops: ChangesetOp[] = [
        { op: 'update_object', id: decision.id, patch: { data: next }, origin: 'direct' },
        ...chosenOps,
        ...(options?.settle(ctx, decision.id, chosenOptionId) ?? []),
      ];
      const doc = ctx.graph.workspace?.doc;

      if (doc) {
        const kept = doc.sections.filter(
          (section) => !(section.type === 'decision' && section.decisionId === decision.id),
        );

        if (kept.length !== doc.sections.length) {
          ops.push(setSections(doc, kept));
        }
      }

      return { output: {}, ops, label };
    },
  });
}

/**
 * `decision.propose` and `decision.resolve` for a template. Its `DecisionOptions` add the fields
 * its options carry and what a pick does; without them, options are plain choices.
 */
export function decisionCapabilities(
  scope: CapabilityScope,
  options?: DecisionOptions,
): Capability[] {
  return [propose(scope, options), resolve(scope, options)];
}
