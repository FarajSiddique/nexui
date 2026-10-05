import { z } from 'zod';

import {
  legDataSchema,
  placeDataSchema,
  type ChangesetOp,
  type GraphObject,
  type LegData,
  type OptionData,
  type PlaceData,
  type TripData,
} from '@nexui/types';

import {
  anchorParts,
  CapabilityError,
  insertObject,
  link,
  nameOf,
  nextPosition,
  refInput,
  unlinkOps,
  type CapabilityContext,
  type DecisionOptions,
} from '#lib/capabilities';

// A trip option's own fields, after the shared ones.
const OPTION_FIELDS = {
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
};

// Reads those fields back, typed, from an option the proposal already parsed.
const optionFields = z.object(OPTION_FIELDS);

// The stop on the route that `ref` names, if it names one.
function stopNamed(ctx: CapabilityContext, ref: string): GraphObject | undefined {
  const id = ctx.refs.byRef.get(ref) ?? ref;

  return anchorParts(ctx, 'place').find((place) => place.id === id);
}

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

  const last = anchorParts(ctx, 'place').at(-1);
  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: place.id,
      patch: {
        data: { ...place.data, days: chosenDays(ctx, data) },
        position: nextPosition(ctx, 'place'),
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
  const stop = anchorParts(ctx, 'place').find((place) => place.id === data.extendPlaceId);

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
  const onRoute = new Set(anchorParts(ctx, 'place').map((place) => place.id));
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

/**
 * A trip's decision options (readiness doc, section 3.11): an option may carry a place to add to
 * the route, with the days to give it and the leg to reach it, or name a stop to extend. Picking
 * one puts that place on the route or gives that stop the days; candidates nobody chose go.
 */
export const TRAVEL_DECISIONS: DecisionOptions = {
  fields: OPTION_FIELDS,
  proposeHelp:
    "An option that would add a place carries that place, the days you'd suggest there, and " +
    'how to get there from the last stop. An option that gives the days to a stop already on ' +
    'the route (more time in Kyoto) names it in extend.',
  resolveHelp:
    'Choosing an option with a place adds that place to the end of the route with the free days ' +
    '(or its suggested days), and a leg to it; one that extends a stop gives it those days. ' +
    'Candidates nobody chose are removed.',
  propose(option, ctx, optionRef) {
    const { place, leg, extend } = optionFields.parse(option);
    const data: Partial<OptionData> = {};
    const ops: ChangesetOp[] = [];
    const refs: Record<string, string> = {};

    if (place && extend) {
      throw new CapabilityError(`"${option.label}" adds a place or extends a stop, not both.`);
    }

    // A ref that names no stop on the route is dropped, so a recorded proposal replays on any
    // trip; picking the option then settles the question and leaves the days as they are.
    const extended = extend ? stopNamed(ctx, extend) : undefined;

    if (extended) {
      data.extendPlaceId = extended.id;
    }

    // A candidate place is not part of the trip until the user picks it.
    if (place) {
      const { days: suggestedDays, ...placeData } = place;
      const placeId = ctx.newId();
      const last = anchorParts(ctx, 'place').at(-1);

      data.placeId = placeId;

      if (suggestedDays !== undefined) {
        data.suggestedDays = suggestedDays;
      }

      if (leg && last) {
        data.leg = { ...leg, fromPlaceId: last.id };
      }

      refs[`${optionRef}-place`] = placeId;
      ops.push(
        insertObject(ctx, {
          id: placeId,
          kind: 'place',
          title: placeData.name,
          data: { ...placeData, days: 0 },
          position: null,
        }),
      );
    }

    return { data, ops, refs };
  },
  choose: (ctx, option) => [...addChosenPlace(ctx, option), ...extendChosenStop(ctx, option)],
  settle: removeCandidates,
};
