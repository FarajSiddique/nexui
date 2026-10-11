import {
  interviewTime,
  readField,
  type GraphObject,
  type GraphSnapshot,
  type Section,
} from '@nexui/types';

import { formatTime, isDateOnly } from '#lib';

import { companyName, isUpcoming, linkedTo } from './job-parts.ts';

type TimelineSection = Extract<Section, { type: 'timeline' }>;

/** One row: the day block, what and with whom, and what a tap opens. */
export interface TimelineRow {
  id: string;
  /** The day block: "THU" over "9". */
  weekday: string;
  day: string;
  /** "Phone screen · Corvid". */
  title: string;
  /** "2:00 PM · with Maya Chen"; a date with no time has no time here. */
  detail: string;
  /** The role the interview is for, which a tap opens, or null. */
  opens: string | null;
}

export interface Timeline {
  /** Soonest first. */
  upcoming: TimelineRow[];
  /** Most recent first; the primitive folds them to a count. */
  past: TimelineRow[];
}

// The day block in the given zone (the device's when none), or in UTC for a date alone.
function dayBlock(at: string, timeZone?: string): { weekday: string; day: string } {
  const zone = isDateOnly(at) ? 'UTC' : timeZone;
  const date = new Date(interviewTime(at));

  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone })
      .format(date)
      .toUpperCase(),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: zone }).format(date),
  };
}

const joined = (parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0).join(' · ');

/**
 * The timeline's rows (spec section 3.2): each object by its date field, split into upcoming and
 * past by the device clock, for display only. A row reads the label field, the company of the
 * role the object is `for`, and who it's with. Objects with no readable date are left out.
 */
export function timelineRows(
  section: TimelineSection,
  objects: readonly GraphObject[],
  snapshot: GraphSnapshot,
  now: Date,
  timeZone?: string,
): Timeline {
  const dated = objects.flatMap((object) => {
    const at = readField(object, section.dateField);

    if (typeof at !== 'string' || Number.isNaN(interviewTime(at))) {
      return [];
    }

    const label = readField(object, section.labelField);
    const role = linkedTo(snapshot, object.id, 'for');
    const whom = object.data.with;
    const row: TimelineRow = {
      id: object.id,
      ...dayBlock(at, timeZone),
      title: joined([
        typeof label === 'string' ? label : '',
        role ? (companyName(snapshot, role.id) ?? '') : '',
      ]),
      detail: joined([
        formatTime(at, timeZone),
        typeof whom === 'string' && whom.length > 0 ? `with ${whom}` : '',
      ]),
      opens: role?.id ?? null,
    };

    return [{ row, at, time: interviewTime(at) }];
  });
  const byTime = dated.sort((a, b) => a.time - b.time);

  return {
    upcoming: byTime.filter((entry) => isUpcoming(entry.at, now)).map((entry) => entry.row),
    past: byTime
      .filter((entry) => !isUpcoming(entry.at, now))
      .reverse()
      .map((entry) => entry.row),
  };
}
