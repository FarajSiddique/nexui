import { z } from 'zod';

import type { ChangesetOp, PlaceData } from '@nexui/types';

import {
  anchorParts,
  CapabilityError,
  dayCount,
  DECISION_CAPABILITIES,
  defineCapability,
  graphCapabilities,
  nameOf,
  refInput,
  requireKind,
  workspaceCapabilities,
  type Capability,
  type CapabilityScope,
} from '#lib/capabilities';

/** A trip's kinds, for the generic capabilities, and the examples their descriptions use. */
export const TRAVEL_SCOPE: CapabilityScope = {
  anchorKind: 'trip',
  kinds: ['trip', 'place', 'leg', 'stay', 'decision', 'option', 'insight', 'thing'],
  examples: {
    objectRef: 'kyoto or tokyo-kyoto',
    decisionRef: 'rural-stop',
    metric: '{"hoursFromKyoto": 1}',
    sectionId: 'place-costs',
    field: 'data.days',
  },
};

const setPlaceDays = defineCapability({
  name: 'trip.setPlaceDays',
  description: 'Set how many whole days the trip spends at one of its places.',
  input: z.strictObject({ placeId: refInput, days: z.number().int().min(0).max(365) }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const place = requireKind(ctx, input.placeId, 'place');

    if ((place.data as PlaceData).days === input.days) {
      throw new CapabilityError(`${nameOf(place)} already has ${dayCount(input.days)}.`);
    }

    return {
      output: {},
      ops: [
        {
          op: 'update_object',
          id: place.id,
          patch: { data: { ...place.data, days: input.days } },
          origin: 'direct',
        },
      ],
      label: `Set ${nameOf(place)} to ${dayCount(input.days)}`,
    };
  },
});

const reorderPlaces = defineCapability({
  name: 'trip.reorderPlaces',
  description: 'Put the route in a new order. List every place on the route, first stop first.',
  input: z.strictObject({ placeIds: z.array(refInput).min(1).max(60) }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const current = anchorParts(ctx, 'place');
    const ordered = input.placeIds.map((ref) => requireKind(ctx, ref, 'place'));
    const ids = new Set(ordered.map((place) => place.id));

    if (
      ordered.length !== current.length ||
      ids.size !== current.length ||
      current.some((place) => !ids.has(place.id))
    ) {
      throw new CapabilityError('List every stop on the route exactly once.');
    }

    const ops = ordered.flatMap((place, index): ChangesetOp[] =>
      place.position === index + 1
        ? []
        : [{ op: 'update_object', id: place.id, patch: { position: index + 1 }, origin: 'direct' }],
    );

    if (ops.length === 0) {
      throw new CapabilityError('The route is already in that order.');
    }

    return { output: {}, ops, label: 'Reordered the route' };
  },
});

/**
 * Everything a trip's runs and buttons may call, in the order models see it: the graph
 * capabilities, the trip's own, decisions, then the workspace layout. `derive.trip` isn't one:
 * it runs inside every changeset, and nothing calls it by name.
 */
export const TRAVEL_CAPABILITIES: readonly Capability[] = [
  ...graphCapabilities(TRAVEL_SCOPE),
  setPlaceDays,
  reorderPlaces,
  ...DECISION_CAPABILITIES,
  ...workspaceCapabilities(TRAVEL_SCOPE),
];
