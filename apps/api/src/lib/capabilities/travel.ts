import { z } from 'zod';

import type { ChangesetOp, PlaceData } from '@nexui/types';

import { refInput } from './graph.ts';
import { dayCount, nameOf, requirePlace, tripPlaces } from './helpers.ts';
import { CapabilityError, defineCapability, type Capability } from './types.ts';

const setPlaceDays = defineCapability({
  name: 'trip.setPlaceDays',
  description: 'Set how many whole days the trip spends at one of its places.',
  input: z.strictObject({ placeId: refInput, days: z.number().int().min(0).max(365) }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: true,
  execute(input, ctx) {
    const place = requirePlace(ctx, input.placeId);

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
    const current = tripPlaces(ctx);
    const ordered = input.placeIds.map((ref) => requirePlace(ctx, ref));
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

export const TRAVEL_CAPABILITIES: readonly Capability[] = [setPlaceDays, reorderPlaces];
