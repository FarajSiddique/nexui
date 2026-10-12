import { formatDateRange } from './figures.ts';
import type { TripData } from './schemas.ts';

/**
 * The line under a trip's title.
 *
 * @example
 * tripMeta({ startDate: '2026-12-12', endDate: '2026-12-24', travelers: 2, pace: 'balanced' })
 * // 'Dec 12 – 24, 2 travelers, balanced pace'
 */
export function tripMeta(trip: Partial<TripData>): string {
  const parts: string[] = [];

  if (trip.startDate && trip.endDate) {
    parts.push(formatDateRange(trip.startDate, trip.endDate));
  } else if (trip.totalDays) {
    parts.push(`${trip.totalDays} ${trip.totalDays === 1 ? 'day' : 'days'}`);
  }

  if (trip.travelers) {
    parts.push(`${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'}`);
  }

  if (trip.pace) {
    parts.push(`${trip.pace} pace`);
  }

  return parts.join(', ');
}
