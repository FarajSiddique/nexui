import {
  formatDateRange,
  isKindName,
  KIND_CARDS,
  readField,
  type FieldFormat,
  type GraphObject,
  type LegData,
  type Money,
  type PlaceData,
  type TripData,
} from '@nexui/types';

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

const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  const cached = currencyFormats.get(key);

  if (cached) {
    return cached;
  }

  const created = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

  currencyFormats.set(key, created);

  return created;
}

/**
 * A short amount for a metric or a cell. Callers add "≈" where the figure is an estimate.
 *
 * @example
 * formatMoney({ amount: 3140, currency: 'USD' }) // '$3.1k'
 */
export function formatMoney(money: Money): string {
  const { amount, currency } = money;

  if (amount >= 1_000_000) {
    return `${currencyFormat(currency, 1).format(amount / 1_000_000)}m`;
  }

  if (amount >= 1_000) {
    return `${currencyFormat(currency, 1).format(amount / 1_000)}k`;
  }

  return currencyFormat(currency, 0).format(amount);
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

/**
 * The line under a workspace's title.
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
    parts.push(formatDays(trip.totalDays));
  }

  if (trip.travelers) {
    parts.push(`${trip.travelers} ${trip.travelers === 1 ? 'traveler' : 'travelers'}`);
  }

  if (trip.pace) {
    parts.push(`${trip.pace} pace`);
  }

  return parts.join(', ');
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

/** One field's value as text, for cards and comparisons. Missing values read "—". */
export function formatField(value: unknown, format: FieldFormat = 'text'): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (isMoney(value)) {
    return formatMoney(value);
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
    return value;
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

let regionNames: Intl.DisplayNames | null | undefined;

// Built once; null where the JS engine has no Intl.DisplayNames.
function regionNameFormat(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }

  return regionNames;
}

/**
 * A country's English name from its ISO code, or the code itself where the runtime has no
 * name for it.
 *
 * @example countryName('DE') // 'Germany'
 */
export function countryName(code: string): string {
  try {
    return regionNameFormat()?.of(code) ?? code;
  } catch {
    return code;
  }
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
