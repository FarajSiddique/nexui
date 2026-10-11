import {
  formatMoney,
  isKindName,
  KIND_CARDS,
  readField,
  type FieldFormat,
  type GraphObject,
  type LegData,
  type Money,
  type PhotoCredit,
  type PlaceData,
} from '@nexui/types';

import { COUNTRY_NAMES } from './country-names.ts';

// Shared with the meta line in `@nexui/types`; cards and metrics read it from here.
export { formatMoney };

/** @example formatDays(1) // '1 day' */
export function formatDays(days: number): string {
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

/** @example formatHours(2.5) // '2h 30m' */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (whole === 0) {
    return `${rest}m`;
  }

  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

/** @example formatRelative(fiveMinutesAgo, now) // '5 min ago' */
export function formatRelative(iso: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(iso);

  if (elapsed < 60_000) {
    return 'just now';
  }

  if (elapsed < 3_600_000) {
    return `${Math.floor(elapsed / 60_000)} min ago`;
  }

  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)} h ago`;
  }

  return shortDate.format(new Date(iso));
}

const localDay = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** The heading a Changes group sits under: "Today", "Yesterday" or "Sunday, Sep 27". */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (localDay(date) === localDay(now)) {
    return 'Today';
  }

  if (localDay(date) === localDay(yesterday)) {
    return 'Yesterday';
  }

  return longDate.format(date);
}

/** @example humanizeKey('hoursFromKyoto') // 'Hours from kyoto' */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    'amount' in value &&
    'currency' in value &&
    typeof value.amount === 'number' &&
    typeof value.currency === 'string'
  );
}

// Intl puts a narrow no-break space before AM and PM; cards use a plain one.
const NARROW_SPACE = /\u202f/g;

/** True for a date with no time, such as an interview "next Tuesday": `2026-10-21`. */
export function isDateOnly(at: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(at);
}

// A date-or-time as an instant and the zone to read it in: a date alone is noon UTC that day
// (as `interviewTime` counts it), read in UTC so it never moves a day.
function instant(at: string, timeZone?: string): { date: Date; timeZone?: string } | null {
  if (isDateOnly(at)) {
    return { date: new Date(`${at}T12:00:00Z`), timeZone: 'UTC' };
  }

  const time = Date.parse(at);

  return Number.isNaN(time) ? null : { date: new Date(time), timeZone };
}

function formatted(
  at: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const read = instant(at, timeZone);

  if (!read) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: read.timeZone })
    .format(read.date)
    .replace(NARROW_SPACE, ' ');
}

/**
 * A date and time for a card or a sheet, in the device's time zone unless one is given. A date
 * with no time shows the date alone. Anything unparsable shows as it is.
 *
 * @example
 * formatDateTime('2026-10-09T13:00:00Z', 'Europe/London') // 'Fri, Oct 9, 2:00 PM'
 * formatDateTime('2026-10-21') // 'Wed, Oct 21'
 */
export function formatDateTime(at: string, timeZone?: string): string {
  const day = { weekday: 'short', month: 'short', day: 'numeric' } as const;

  if (isDateOnly(at)) {
    return formatted(at, timeZone, day) ?? at;
  }

  return formatted(at, timeZone, { ...day, hour: 'numeric', minute: '2-digit' }) ?? at;
}

/** @example formatTime('2026-10-09T13:00:00Z', 'Europe/London') // '2:00 PM'; '' for a date */
export function formatTime(at: string, timeZone?: string): string {
  if (isDateOnly(at)) {
    return '';
  }

  return formatted(at, timeZone, { hour: 'numeric', minute: '2-digit' }) ?? '';
}

/** @example formatDate('2026-09-26T09:00:00Z') // 'Sep 26' */
export function formatDate(at: string, timeZone?: string): string {
  return formatted(at, timeZone, { month: 'short', day: 'numeric' }) ?? at;
}

/** One field's value as text, for cards and comparisons. Missing values read "—". */
export function formatField(value: unknown, format: FieldFormat = 'text'): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (isMoney(value)) {
    return format === 'estimate' ? `≈ ${formatMoney(value)}` : formatMoney(value);
  }

  if (typeof value === 'number') {
    if (format === 'days') {
      return formatDays(value);
    }

    if (format === 'hours') {
      return formatHours(value);
    }

    return value.toLocaleString('en-US');
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatField(item)).join(', ');
  }

  if (typeof value === 'string') {
    return format === 'dateTime' ? formatDateTime(value) : value;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return '—';
}

/** A place's display name: its `data.name`, else its title. */
export function placeName(object: GraphObject): string {
  const name = (object.data as Partial<PlaceData>).name;

  return name ?? object.title ?? 'Stop';
}

/** An object's card text from `KIND_CARDS`; unknown kinds read like `thing`. */
export function cardText(object: GraphObject): { title: string; subtitle: string } {
  const spec = isKindName(object.kind) ? KIND_CARDS[object.kind] : KIND_CARDS.thing;
  const title = readField(object, spec.title);
  const subtitle = spec.subtitle
    .flatMap(({ field, format }) => {
      const value = readField(object, field);

      return value === undefined || value === null || value === ''
        ? []
        : [formatField(value, format)];
    })
    .join(' · ');

  return {
    title: typeof title === 'string' && title.length > 0 ? title : (object.title ?? object.kind),
    subtitle,
  };
}

/** @example capitalize('city') // 'City' */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ORDINAL_WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

/**
 * @example
 * ordinalWord(2) // 'second'
 * ordinalWord(12) // '12th'
 */
export function ordinalWord(n: number): string {
  const word = ORDINAL_WORDS[n - 1];

  if (word) {
    return word;
  }

  const lastTwo = n % 100;

  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${n}th`;
  }

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

  return `${n}${suffixes[n % 10] ?? 'th'}`;
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
