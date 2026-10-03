import { z } from 'zod';

import {
  legDataSchema,
  placeDataSchema,
  type ChangesetOp,
  type DecisionData,
  type GraphObject,
  type OptionData,
  type Section,
  type TripData,
} from '@nexui/types';

import { refInput } from './graph.ts';
import {
  insertObject,
  link,
  nameOf,
  nextPosition,
  placeSection,
  requireDoc,
  setSections,
  tripPlaces,
  type SectionSlot,
} from './helpers.ts';
import { checkNewRef, resolveRef } from './refs.ts';
import {
  CapabilityError,
  defineCapability,
  type Capability,
  type CapabilityContext,
} from './types.ts';

const optionInput = z.strictObject({
  label: z.string().min(1).max(100),
  summary: z.string().max(400),
  pros: z.array(z.string().max(120)).max(8).optional(),
  cons: z.array(z.string().max(120)).max(8).optional(),
  metrics: z
    .record(z.string().max(40), z.number())
    .optional()
    .describe('Up to 12 numbers to compare, such as {"hoursFromKyoto": 1}'),
  fit: z.string().max(120).optional().describe('One line on how it fits this trip'),
  place: placeDataSchema
    .extend({
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Days you'd suggest here if the trip has none free"),
    })
    .optional()
    .describe('The place this option would add to the route'),
  leg: legDataSchema.optional().describe('Getting to that place from the current last stop'),
});

const propose = defineCapability({
  name: 'decision.propose',
  description:
    'Put a choice to the user: a question with 2 to 4 options, pinned at the top of the plan. ' +
    'Use it instead of choosing for them. An option that would add a place carries that place, ' +
    "the days you'd suggest there, and how to get there from the last stop.",
  input: z.strictObject({
    ref: z.string().describe('A new short ref for the decision, such as rural-stop'),
    question: z.string().min(1).max(200),
    tradeoff: z.string().max(400).optional().describe('What the choice trades off, in a sentence'),
    options: z.array(optionInput).min(2).max(4),
  }),
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

    const last = tripPlaces(ctx).at(-1);
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

      // A candidate place is not part of the trip until the user picks it.
      if (option.place) {
        const { days: suggestedDays, ...place } = option.place;
        const placeId = ctx.newId();

        data.placeId = placeId;

        if (suggestedDays !== undefined) {
          data.suggestedDays = suggestedDays;
        }

        if (option.leg && last) {
          data.leg = { ...option.leg, fromPlaceId: last.id };
        }

        refs[`${optionRef}-place`] = placeId;
        ops.push(
          insertObject(ctx, {
            id: placeId,
            kind: 'place',
            title: place.name,
            data: { ...place, days: 0 },
            position: null,
          }),
        );
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

// Puts the chosen option's place on the route: last, with the days nothing else uses, and a leg
// from the stop before it. A place already on the route stays as it is.
function addChosenPlace(ctx: CapabilityContext, option: GraphObject): ChangesetOp[] {
  const placeId = (option.data as OptionData).placeId;

  if (!placeId) {
    return [];
  }

  const place = ctx.graph.objects.find((object) => object.id === placeId);

  if (place?.kind !== 'place') {
    throw new CapabilityError('That option’s place no longer exists.');
  }

  const onRoute = ctx.graph.relationships.some(
    (edge) =>
      edge.type === 'part_of' && edge.sourceId === place.id && edge.targetId === ctx.anchorId,
  );

  if (onRoute) {
    return [];
  }

  const trip = ctx.graph.objects.find((object) => object.id === ctx.anchorId);
  const free = Math.max(0, (trip?.data as TripData | undefined)?.derived?.unallocatedDays ?? 0);
  const last = tripPlaces(ctx).at(-1);
  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: place.id,
      patch: { data: { ...place.data, days: free }, position: nextPosition(ctx) },
      origin: 'direct',
    },
    link(ctx, place.id, 'part_of', ctx.anchorId),
  ];

  if (last) {
    const legId = ctx.newId();

    ops.push(
      insertObject(ctx, {
        id: legId,
        kind: 'leg',
        title: `${nameOf(last)} → ${nameOf(place)}`,
        data: { mode: 'other' },
        position: null,
      }),
      link(ctx, legId, 'part_of', ctx.anchorId),
      link(ctx, legId, 'leg_from', last.id),
      link(ctx, legId, 'leg_to', place.id),
    );
  }

  return ops;
}

const resolve = defineCapability({
  name: 'decision.resolve',
  description:
    'Settle an open decision with one of its options, or dismiss it by leaving optionId out. ' +
    'Choosing an option with a place adds that place to the end of the route with the free ' +
    'days, and a leg to it.',
  input: z.strictObject({ decisionId: refInput, optionId: refInput.optional() }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const decision = resolveRef(ctx.refs, ctx.graph, input.decisionId);

    if (decision.kind !== 'decision') {
      throw new CapabilityError(`${nameOf(decision)} is not a decision.`);
    }

    const data = decision.data as DecisionData;

    if (data.status !== 'open') {
      throw new CapabilityError('That question is already settled.');
    }

    if (data.derivedKey) {
      throw new CapabilityError('That question settles itself as the trip changes.');
    }

    let next: DecisionData = { ...data, status: 'dismissed' };
    let label = `Dismissed "${data.question}"`;
    const placeOps: ChangesetOp[] = [];

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
      placeOps.push(...addChosenPlace(ctx, option));
    }

    const ops: ChangesetOp[] = [
      { op: 'update_object', id: decision.id, patch: { data: next }, origin: 'direct' },
      ...placeOps,
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

export const DECISION_CAPABILITIES: readonly Capability[] = [propose, resolve];
