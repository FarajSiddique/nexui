import { formatMoney } from '../money.ts';
import type { SearchData } from './schemas.ts';

// "A", "A or B", "A, B or C".
function either(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  const rest = items.slice(0, -1);

  return rest.length > 0 ? `${rest.join(', ')} or ${last}` : last;
}

/**
 * The line under a job search's title (spec section 3.2): its roles, where, and the pay floor.
 * Empty until the build run sets the roles.
 *
 * @example
 * searchMeta({ roles: ['Staff PM'], locations: ['London'], workModes: ['hybrid', 'remote'],
 *   salaryFloor: { amount: 120000, currency: 'GBP' } })
 * // 'Staff PM · London or remote · £120k+'
 */
export function searchMeta(search: Partial<SearchData>): string {
  const roles = search.roles ?? [];

  if (roles.length === 0) {
    return '';
  }

  const places = (search.locations ?? []).slice(0, 2);
  const remoteNamed = places.some((place) => place.toLowerCase().includes('remote'));

  if (search.workModes?.includes('remote') && !remoteNamed) {
    places.push('remote');
  }

  const more = roles.length > 2 ? ` +${roles.length - 2}` : '';
  const parts = [`${roles.slice(0, 2).join(' or ')}${more}`, either(places)];

  if (search.salaryFloor) {
    parts.push(`${formatMoney(search.salaryFloor)}+`);
  }

  return parts.filter((part) => part.length > 0).join(' · ');
}
