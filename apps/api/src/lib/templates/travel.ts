import type { ChangesetOp, GraphQuery, WorkspaceDoc } from '@nexui/types';

function partOf(kind: 'place' | 'leg' | 'insight', tripId: string): GraphQuery {
  return {
    from: 'objects',
    kind,
    related: { type: 'part_of', to: { objectId: tripId }, direction: 'out' },
    sort: 'position',
  };
}

/**
 * The travel template's starting workspace, in the order of the chosen design (spec section I):
 * map, metrics, day bar, the pinned insights, then the editable route.
 */
export function travelWorkspace(tripId: string): WorkspaceDoc {
  const places = partOf('place', tripId);

  return {
    version: 1,
    anchorId: tripId,
    sections: [
      { id: 'map', type: 'map', places, legs: partOf('leg', tripId) },
      {
        id: 'metrics',
        type: 'metric',
        metrics: [
          { label: 'days in total', derived: 'trip.totalDays', format: 'days' },
          {
            label: 'unallocated',
            derived: 'trip.unallocatedDays',
            format: 'days',
            emphasis: 'whenPositive',
          },
          { label: 'approximate cost', derived: 'trip.estCost', format: 'currency' },
        ],
      },
      {
        id: 'days',
        type: 'allocation',
        parts: places,
        valueField: 'data.days',
        labelField: 'data.name',
        total: 'trip.totalDays',
      },
      { id: 'insights', type: 'insight', pin: 'open', query: partOf('insight', tripId) },
      {
        id: 'route',
        type: 'route',
        query: places,
        editable: ['days', 'order'],
        showUnallocated: true,
      },
    ],
  };
}

/**
 * A new travel intent: an empty trip named after the goal, and its workspace. The intelligence
 * plan fills in destinations and places; until then the trip length is an open decision.
 */
export function seedTravelOps(goal: string, newId: () => string): ChangesetOp[] {
  const tripId = newId();

  return [
    {
      op: 'insert_object',
      id: tripId,
      kind: 'trip',
      kindVersion: 1,
      title: goal.trim().slice(0, 200),
      status: null,
      data: { destinations: [], currency: 'USD' },
      source: { type: 'user' },
      position: null,
      origin: 'direct',
    },
    { op: 'set_workspace', doc: travelWorkspace(tripId), origin: 'direct' },
  ];
}
