import {
  tripParts,
  type GraphObject,
  type GraphSnapshot,
  type PlaceData,
  type StayData,
} from '@nexui/types';

import { capitalize, countryName, formatDays, formatMoney, ordinalWord } from '#lib';

import { legBetween } from './workspace-layout.ts';

/** What a stop's details sheet shows, read from the snapshot. */
export interface StopDetails {
  place: GraphObject;
  data: PlaceData;
  /** Its position on the route, from 1. */
  order: number;
  /** How many stops the route has. */
  count: number;
  /** The next stop and the leg to it; null on the last stop. */
  next: { place: GraphObject; leg: GraphObject | null } | null;
  /** The stays at this stop, in order. */
  stays: GraphObject[];
  /** The workspace's route lets the user change days. */
  canEditDays: boolean;
}

/**
 * One route stop's details, or null when the place isn't on the route: a decision candidate,
 * or a stop that a run, another device or Undo has just removed.
 */
export function stopDetails(snapshot: GraphSnapshot, placeId: string): StopDetails | null {
  const doc = snapshot.workspace?.doc;

  if (!doc) {
    return null;
  }

  const { places, stays } = tripParts(snapshot, doc.anchorId);
  const index = places.findIndex((place) => place.id === placeId);
  const place = places[index];

  if (!place) {
    return null;
  }

  const following = places[index + 1];
  const route = doc.sections.find((section) => section.type === 'route');

  return {
    place,
    data: place.data as PlaceData,
    order: index + 1,
    count: places.length,
    next: following
      ? { place: following, leg: legBetween(snapshot, place.id, following.id) }
      : null,
    stays: stays.filter((stay) => (stay.data as Partial<StayData>).placeId === place.id),
    canEditDays: route?.type === 'route' && route.editable.includes('days'),
  };
}

/** @example stopKind({ placeType: 'city', country: 'DE' }) // 'City in Germany' */
export function stopKind(data: Pick<PlaceData, 'placeType' | 'country'>): string {
  return `${capitalize(data.placeType)} in ${countryName(data.country)}`;
}

/**
 * The line under the sheet's title.
 *
 * @example stopSubtitle(berlin) // 'City in Germany, the first of 4 stops'
 */
export function stopSubtitle(
  details: Pick<StopDetails, 'order' | 'count'> & {
    data: Pick<PlaceData, 'placeType' | 'country'>;
  },
): string {
  const position =
    details.count === 1
      ? 'the only stop'
      : `the ${ordinalWord(details.order)} of ${details.count} stops`;

  return `${stopKind(details.data)}, ${position}`;
}

/**
 * The route row's label.
 *
 * @example stopButtonLabel('Berlin', 1, 3) // 'Berlin, stop 1, 3 days. Show details'
 */
export function stopButtonLabel(name: string, order: number, days: number): string {
  return `${name}, stop ${order}, ${formatDays(days)}. Show details`;
}

/**
 * @example
 * stayLine({ nights: 3, estNightly: { amount: 120, currency: 'USD' } })
 * // '3 nights, ≈ $120 a night'
 */
export function stayLine(data: Pick<StayData, 'nights' | 'estNightly'>): string {
  const nights = `${data.nights} ${data.nights === 1 ? 'night' : 'nights'}`;

  return data.estNightly ? `${nights}, ≈ ${formatMoney(data.estNightly)} a night` : nights;
}
