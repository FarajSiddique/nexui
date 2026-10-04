import { z } from 'zod';

import {
  legDataSchema,
  placeDataSchema,
  type ChangesetOp,
  type DecisionData,
  type GraphObject,
  type LegData,
  type OptionData,
  type PlaceData,
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
  unlinkOps,
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
  extend: refInput
    .optional()
    .describe('Instead of a place: the stop on the route this option gives the days to'),
});

// The stop on the route that `ref` names, if it names one.
function stopNamed(ctx: CapabilityContext, ref: string): GraphObject | undefined {
  const id = ctx.refs.byRef.get(ref) ?? ref;

  return tripPlaces(ctx).find((place) => place.id === id);
}

const propose = defineCapability({
  name: 'decision.propose',
  description:
    'Put a choice to the user: a question with 2 to 4 options, pinned at the top of the plan. ' +
    'Use it instead of choosing for them. An option that would add a place carries that place, ' +
    "the days you'd suggest there, and how to get there from the last stop. An option that " +
    'gives the days to a stop already on the route (more time in Kyoto) names it in extend.',
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

      if (option.place && option.extend) {
        throw new CapabilityError(`"${option.label}" adds a place or extends a stop, not both.`);
      }

      // A ref that names no stop on the route is dropped, so a recorded proposal replays on any
      // trip; picking the option then settles the question and leaves the days as they are.
      const extended = option.extend ? stopNamed(ctx, option.extend) : undefined;

      if (extended) {
        data.extendPlaceId = extended.id;
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

// The days a pick hands out: the trip's free days, else what its option suggested, else 1.
function chosenDays(ctx: CapabilityContext, option: OptionData): number {
  const trip = ctx.graph.objects.find((object) => object.id === ctx.anchorId);
  const free = (trip?.data as TripData | undefined)?.derived?.unallocatedDays ?? null;

  if (free !== null && free > 0) {
    return free;
  }

  return option.suggestedDays ?? 1;
}

// The new leg's data: the option's hint while the stop it was measured from is still last.
function chosenLeg(option: OptionData, last: GraphObject): LegData {
  const hint = option.leg;

  if (!hint || hint.fromPlaceId !== last.id) {
    return { mode: 'other' };
  }

  const leg: LegData = { mode: hint.mode };

  if (hint.estHours !== undefined) {
    leg.estHours = hint.estHours;
  }

  if (hint.estCost) {
    leg.estCost = hint.estCost;
  }

  return leg;
}

// Puts the chosen option's place on the route: last, with `chosenDays`, and a leg from the stop
// before it. A place already on the route stays as it is.
function addChosenPlace(ctx: CapabilityContext, option: GraphObject): ChangesetOp[] {
  const data = option.data as OptionData;

  if (!data.placeId) {
    return [];
  }

  const place = ctx.graph.objects.find((object) => object.id === data.placeId);

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

  const last = tripPlaces(ctx).at(-1);
  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: place.id,
      patch: {
        data: { ...place.data, days: chosenDays(ctx, data) },
        position: nextPosition(ctx),
      },
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
        data: chosenLeg(data, last),
        position: null,
      }),
      link(ctx, legId, 'part_of', ctx.anchorId),
      link(ctx, legId, 'leg_from', last.id),
      link(ctx, legId, 'leg_to', place.id),
    );
  }

  return ops;
}

// Adds `chosenDays` to the stop the chosen option extends, while that stop is still on the route.
function extendChosenStop(ctx: CapabilityContext, option: GraphObject): ChangesetOp[] {
  const data = option.data as OptionData;
  const stop = tripPlaces(ctx).find((place) => place.id === data.extendPlaceId);

  if (!stop) {
    return [];
  }

  const place = stop.data as PlaceData;

  return [
    {
      op: 'update_object',
      id: stop.id,
      patch: { data: { ...place, days: place.days + chosenDays(ctx, data) } },
      origin: 'direct',
    },
  ];
}

// Deletes the candidate places of a settled decision's options, except the chosen one's and any
// the user already put on the route. Undo of the changeset restores them.
function removeCandidates(
  ctx: CapabilityContext,
  decisionId: string,
  chosenOptionId: string | null,
): ChangesetOp[] {
  const onRoute = new Set(tripPlaces(ctx).map((place) => place.id));
  const gone = ctx.graph.relationships
    .filter((edge) => edge.type === 'option_of' && edge.targetId === decisionId)
    .filter((edge) => edge.sourceId !== chosenOptionId)
    .map((edge) => ctx.graph.objects.find((object) => object.id === edge.sourceId))
    .map((option) => (option?.data as Partial<OptionData> | undefined)?.placeId)
    .filter((placeId): placeId is string => typeof placeId === 'string')
    .filter(
      (placeId) =>
        !onRoute.has(placeId) &&
        ctx.graph.objects.some((object) => object.id === placeId && object.kind === 'place'),
    );

  return [
    ...gone.map((id): ChangesetOp => ({ op: 'delete_object', id, origin: 'direct' })),
    ...unlinkOps(ctx, gone),
  ];
}

const resolve = defineCapability({
  name: 'decision.resolve',
  description:
    'Settle an open decision with one of its options, or dismiss it by leaving optionId out. ' +
    'Choosing an option with a place adds that place to the end of the route with the free ' +
    'days (or its suggested days), and a leg to it; one that extends a stop gives it those ' +
    'days. Candidates nobody chose are removed.',
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
      placeOps.push(...addChosenPlace(ctx, option), ...extendChosenStop(ctx, option));
    }

    const chosenOptionId = next.status === 'resolved' ? (next.chosenOptionId ?? null) : null;
    const ops: ChangesetOp[] = [
      { op: 'update_object', id: decision.id, patch: { data: next }, origin: 'direct' },
      ...placeOps,
      ...removeCandidates(ctx, decision.id, chosenOptionId),
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
