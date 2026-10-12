import type { GraphObject, LegData, PhotoCredit, PlaceData } from '@nexui/types';

import { formatHours, formatMoney } from '#lib';

import { COUNTRY_NAMES } from './country-names.ts';

/** A place's display name: its `data.name`, else its title. */
export function placeName(object: GraphObject): string {
  const name = (object.data as Partial<PlaceData>).name;

  return name ?? object.title ?? 'Stop';
}

/**
 * A country's English name from its ISO code, or the code itself for one the list doesn't
 * know. The list is bundled because Hermes has no Intl.DisplayNames.
 *
 * @example countryName('DE') // 'Germany'
 */
export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

const TRAVEL_MODES: Record<LegData['mode'], string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Drive',
  ferry: 'Ferry',
  other: 'Travel',
};

/** @example travelTo('train', 'Prague') // 'Train to Prague' */
export function travelTo(mode: LegData['mode'], name: string): string {
  return `${TRAVEL_MODES[mode]} to ${name}`;
}

/**
 * A leg's time and cost, either of which may be missing.
 *
 * @example
 * legFigures({ mode: 'train', estHours: 4.25, estCost: { amount: 40, currency: 'USD' } })
 * // '4h 15m, ≈ $40'
 */
export function legFigures(leg: LegData): string {
  const parts: string[] = [];

  if (leg.estHours !== undefined) {
    parts.push(formatHours(leg.estHours));
  }

  if (leg.estCost) {
    parts.push(`≈ ${formatMoney(leg.estCost)}`);
  }

  return parts.join(', ');
}

/**
 * A photo's credit line, as the stop sheet shows it under the photo.
 *
 * @example
 * photoCredit({ author: 'Kasa Fue', license: 'CC BY-SA 4.0' })
 * // 'Photo: Kasa Fue, CC BY-SA 4.0, via Wikimedia Commons'
 */
export function photoCredit(credit: Pick<PhotoCredit, 'author' | 'license'>): string {
  const who = [credit.author, credit.license].filter(Boolean).join(', ');

  return `Photo: ${who}, via Wikimedia Commons`;
}
