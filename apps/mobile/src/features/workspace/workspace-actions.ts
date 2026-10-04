import {
  tripParts,
  type CapabilityRequest,
  type ChangesetOp,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
} from '@nexui/types';

/** What a primitive reports upward. The workspace screen turns it into a request. */
export type WorkspaceAction =
  | { type: 'setDays'; placeId: string; days: number }
  | { type: 'move'; placeId: string; by: -1 | 1 }
  | { type: 'resolveDecision'; decisionId: string; optionId: string | null }
  | { type: 'capability'; name: string; input: CapabilityRequest['input'] }
  | { type: 'ask'; prompt: string }
  | { type: 'openPlace'; placeId: string };

/** Every action that calls the API; `ask` and `openPlace` open a sheet instead. */
export type ServerAction = Exclude<WorkspaceAction, { type: 'ask' } | { type: 'openPlace' }>;

type SetDaysAction = Extract<WorkspaceAction, { type: 'setDays' }>;

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

function validDays(snapshot: GraphSnapshot, placeId: string, days: number): boolean {
  const place = findPlace(snapshot, placeId);

  return (
    place !== undefined &&
    Number.isInteger(days) &&
    days >= 0 &&
    days <= MAX_PLACE_DAYS &&
    (place.data as PlaceData).days !== days
  );
}

/**
 * The action for a day stepper tap, or null when the new value is out of range or unchanged.
 * The route and the stop sheet both report it, after `rememberDays`.
 */
export function daysAction(place: GraphObject, days: number): SetDaysAction | null {
  const before = (place.data as PlaceData).days;

  if (!Number.isInteger(days) || days < 0 || days > MAX_PLACE_DAYS || days === before) {
    return null;
  }

  return { type: 'setDays', placeId: place.id, days };
}

/**
 * The user-callable capability an action makes, or null when there is nothing to send (the
 * value is unchanged, or a stop was moved past the end). Values are absolute, so a burst of
 * taps ends in the state the user saw last.
 */
export function capabilityFor(
  action: ServerAction,
  snapshot: GraphSnapshot,
): CapabilityRequest | null {
  switch (action.type) {
    case 'setDays':
      return validDays(snapshot, action.placeId, action.days)
        ? { name: 'trip.setPlaceDays', input: { placeId: action.placeId, days: action.days } }
        : null;
    case 'move': {
      const placeIds = movedRoute(snapshot, action.placeId, action.by);

      return placeIds ? { name: 'trip.reorderPlaces', input: { placeIds } } : null;
    }

    case 'resolveDecision':
      return {
        name: 'decision.resolve',
        input: action.optionId
          ? { decisionId: action.decisionId, optionId: action.optionId }
          : { decisionId: action.decisionId },
      };
    case 'capability':
      return { name: action.name, input: action.input };
  }
}

/**
 * Ops that show an edit at once, for display only: the server recomputes and answers with the
 * committed snapshot. Decisions and insight buttons get none, because only the server knows
 * their outcome.
 */
export function optimisticOps(action: ServerAction, snapshot: GraphSnapshot): ChangesetOp[] {
  if (action.type === 'setDays') {
    const place = findPlace(snapshot, action.placeId);

    if (!place || !validDays(snapshot, action.placeId, action.days)) {
      return [];
    }

    return [
      {
        op: 'update_object',
        id: place.id,
        patch: { data: { ...place.data, days: action.days } },
        origin: 'direct',
      },
    ];
  }

  if (action.type === 'move') {
    const order = movedRoute(snapshot, action.placeId, action.by) ?? [];

    return order.flatMap((id, index): ChangesetOp[] =>
      findPlace(snapshot, id)?.position === index + 1
        ? []
        : [{ op: 'update_object', id, patch: { position: index + 1 }, origin: 'direct' }],
    );
  }

  return [];
}
