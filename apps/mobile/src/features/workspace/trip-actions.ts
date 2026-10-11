import {
  tripParts,
  type ChangesetOp,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
} from '@nexui/types';

import type { CapabilityAction } from './workspace-actions.ts';

export const MAX_PLACE_DAYS = 365;

function findPlace(snapshot: GraphSnapshot, id: string): GraphObject | undefined {
  return snapshot.objects.find((object) => object.id === id && object.kind === 'place');
}

function routeIds(snapshot: GraphSnapshot): string[] {
  const anchorId = snapshot.workspace?.doc.anchorId;

  return anchorId ? tripParts(snapshot, anchorId).places.map((place) => place.id) : [];
}

// The route with one stop moved, or null when it can't move that way.
function movedRoute(snapshot: GraphSnapshot, placeId: string, by: -1 | 1): string[] | null {
  const ids = routeIds(snapshot);
  const from = ids.indexOf(placeId);
  const to = from + by;

  if (from < 0 || to < 0 || to >= ids.length) {
    return null;
  }

  const next = [...ids];

  next.splice(from, 1);
  next.splice(to, 0, placeId);

  return next;
}

/**
 * A stop's new day count as `trip.setPlaceDays`, shown at once, or null when the value is out of
 * range or unchanged. Values are absolute, so a burst of taps ends in the state the user saw
 * last. The route and the stop sheet both report it, after `rememberDays`.
 */
export function daysAction(place: GraphObject, days: number): CapabilityAction | null {
  const before = (place.data as PlaceData).days;

  if (!Number.isInteger(days) || days < 0 || days > MAX_PLACE_DAYS || days === before) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'trip.setPlaceDays', input: { placeId: place.id, days } },
    optimistic: [
      {
        op: 'update_object',
        id: place.id,
        patch: { data: { ...place.data, days } },
        origin: 'direct',
      },
    ],
  };
}

/**
 * A stop moved one place along the route as `trip.reorderPlaces`, with the positions it shows at
 * once, or null when it can't move that way.
 */
export function moveAction(
  snapshot: GraphSnapshot,
  placeId: string,
  by: -1 | 1,
): CapabilityAction | null {
  const placeIds = movedRoute(snapshot, placeId, by);

  if (!placeIds) {
    return null;
  }

  return {
    type: 'capability',
    request: { name: 'trip.reorderPlaces', input: { placeIds } },
    optimistic: placeIds.flatMap((id, index): ChangesetOp[] =>
      findPlace(snapshot, id)?.position === index + 1
        ? []
        : [{ op: 'update_object', id, patch: { position: index + 1 }, origin: 'direct' }],
    ),
  };
}
