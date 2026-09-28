import type { GraphObject, GraphSnapshot } from '../graph.ts';
import { evaluateQuery } from '../query.ts';
import type { LegData, Money, PlaceData, StayData, TripData, TripDerived } from './travel.ts';

// Approximate US dollars per unit, fixed for slice 1 (spec section D: "approximate").
export const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.6,
  CHF: 1.12,
  CNY: 0.14,
  HKD: 0.128,
  TWD: 0.031,
  KRW: 0.00073,
  SGD: 0.74,
  THB: 0.028,
  VND: 0.00004,
  IDR: 0.000063,
  MYR: 0.21,
  PHP: 0.017,
  INR: 0.012,
  AED: 0.272,
  TRY: 0.03,
  MXN: 0.055,
  BRL: 0.18,
  ZAR: 0.054,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  ISK: 0.0072,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0028,
};

/** Converts an amount into another currency, or null when either currency is unknown. */
export function convertMoney(money: Money, to: string): number | null {
  const from = USD_PER_UNIT[money.currency];
  const target = USD_PER_UNIT[to];

  if (from === undefined || target === undefined) {
    return null;
  }

  return (money.amount * from) / target;
}

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
