import type { GraphObject, GraphSnapshot } from '../../graph.ts';
import { evaluateQuery } from '../../query.ts';
import { convertMoney, type Money } from '../money.ts';
import type { LegData, PlaceData, StayData, TripData, TripDerived } from './schemas.ts';

/**
 * Whole days between two ISO dates.
 *
 * @example
 * daysBetween('2026-12-12', '2026-12-20') // 8
 */
export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

/** Everything `part_of` a trip, by kind; places in route order. */
export function tripParts(
  snapshot: GraphSnapshot,
  tripId: string,
): {
  places: GraphObject[];
  legs: GraphObject[];
  stays: GraphObject[];
  decisions: GraphObject[];
  insights: GraphObject[];
} {
  const partOf = (kind: 'place' | 'leg' | 'stay' | 'decision' | 'insight'): GraphObject[] =>
    evaluateQuery(snapshot, {
      from: 'objects',
      kind,
      related: { type: 'part_of', to: { objectId: tripId }, direction: 'out' },
      sort: 'position',
    });

  return {
    places: partOf('place'),
    legs: partOf('leg'),
    stays: partOf('stay'),
    decisions: partOf('decision'),
    insights: partOf('insight'),
  };
}

/**
 * The trip's days and approximate cost, computed only from the graph (no model involved).
 * Dates win over `totalDays`; costs in unknown currencies are skipped and flagged.
 */
export function tripFigures(snapshot: GraphSnapshot, tripId: string): TripDerived {
  const trip = snapshot.objects.find((object) => object.id === tripId);
  const data = (trip?.data ?? {}) as Partial<TripData>;
  const currency = data.currency ?? 'USD';
  const { places, legs, stays } = tripParts(snapshot, tripId);
  const totalDays =
    data.startDate && data.endDate
      ? daysBetween(data.startDate, data.endDate)
      : (data.totalDays ?? null);
  const allocatedDays = places.reduce((sum, place) => sum + (place.data as PlaceData).days, 0);

  let amount = 0;
  let priced = false;
  let costIncomplete = false;

  const add = (money: Money | undefined, times = 1): void => {
    if (!money) {
      return;
    }

    const converted = convertMoney(money, currency);

    if (converted === null) {
      costIncomplete = true;

      return;
    }

    amount += converted * times;
    priced = true;
  };

  for (const place of places) {
    const placeData = place.data as PlaceData;

    add(placeData.estDailyCost, placeData.days);
  }

  for (const leg of legs) {
    add((leg.data as LegData).estCost);
  }

  for (const stay of stays) {
    const stayData = stay.data as StayData;

    add(stayData.estNightly, stayData.nights);
  }

  return {
    totalDays,
    allocatedDays,
    unallocatedDays: totalDays === null ? null : totalDays - allocatedDays,
    estCost: priced ? { amount: Math.round(amount), currency } : null,
    costIncomplete,
  };
}

const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * @example
 * formatDateRange('2026-12-12', '2026-12-20') // 'Dec 12 – 20'
 */
export function formatDateRange(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);

  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${monthDay.format(from)} – ${to.getUTCDate()}`;
  }

  return `${monthDay.format(from)} – ${monthDay.format(to)}`;
}
