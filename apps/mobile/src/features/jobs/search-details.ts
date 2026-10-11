import {
  PASS_REASONS,
  WORK_MODES,
  type DocumentData,
  type GraphObject,
  type GraphSnapshot,
  type Money,
  type ResumeProfile,
  type SearchData,
  type WorkMode,
} from '@nexui/types';

import { formatDate, formatMoney } from '#lib';
import type { CapabilityAction } from '#features/workspace';

/** The criteria lists the sheet edits: most entries, longest entry, fewest entries (`searchDataSchema`). */
export const LISTS = {
  roles: { max: 5, length: 80, min: 1 },
  locations: { max: 5, length: 80, min: 0 },
  industries: { max: 5, length: 60, min: 0 },
  excludeCompanies: { max: 20, length: 100, min: 0 },
} as const;

export type ListField = keyof typeof LISTS;

/** What the search sheet shows (job search spec, section 6). */
export interface SearchDetails {
  search: GraphObject;
  data: SearchData;
  workModes: { value: WorkMode; label: string; on: boolean }[];
  /** "£120k", or null with no floor. */
  salaryFloor: string | null;
  /** The never-show list; the resume's current employer is marked and stays. */
  neverShow: { name: string; employer: boolean }[];
  /** "Too junior · Northbeam", newest first, keyed by when each was given. */
  passes: { at: string; text: string }[];
  /** When the resume was read, and what Nexui took from it. */
  resume: { read: string; profile: string } | null;
}

// "Senior PM at Brightbank · 8 years · payments, risk, lending".
function profileLine(profile: ResumeProfile | undefined): string {
  if (!profile) {
    return '';
  }

  const now =
    profile.currentTitle && profile.currentEmployer
      ? `${profile.currentTitle} at ${profile.currentEmployer}`
      : (profile.currentTitle ?? profile.currentEmployer ?? profile.headline ?? '');
  const years =
    profile.years === undefined ? '' : `${profile.years} ${profile.years === 1 ? 'year' : 'years'}`;

  return [now, years, profile.skills.slice(0, 3).join(', ')]
    .filter((part) => part.length > 0)
    .join(' · ');
}

/** The search's sheet, or null when `searchId` isn't a search. */
export function searchDetails(
  snapshot: GraphSnapshot,
  searchId: string,
  timeZone?: string,
): SearchDetails | null {
  const search = snapshot.objects.find(
    (object) => object.id === searchId && object.kind === 'search',
  );

  if (!search) {
    return null;
  }

  const data = search.data as SearchData;
  const resume = snapshot.objects.find(
    (object) => object.kind === 'document' && (object.data as DocumentData).docType === 'resume',
  );
  const profile = (resume?.data as DocumentData | undefined)?.profile;
  const employer = profile?.currentEmployer?.toLowerCase();

  return {
    search,
    data,
    workModes: WORK_MODES.map((mode) => ({
      value: mode.value,
      label: mode.label,
      on: data.workModes.includes(mode.value),
    })),
    salaryFloor: data.salaryFloor ? formatMoney(data.salaryFloor) : null,
    neverShow: data.excludeCompanies.map((name) => ({
      name,
      employer: employer !== undefined && name.toLowerCase() === employer,
    })),
    passes: [...data.passReasons].reverse().map((pass) => ({
      at: pass.at,
      text: `${PASS_REASONS.find((reason) => reason.value === pass.reason)?.label ?? pass.reason} · ${pass.company}`,
    })),
    resume: resume
      ? { read: formatDate(resume.updatedAt, timeZone), profile: profileLine(profile) }
      : null,
  };
}

// One criteria change through `object.update` (Decision 2), shown at once.
function edit(search: GraphObject, field: string, value: string[] | Money): CapabilityAction {
  return {
    type: 'capability',
    request: { name: 'object.update', input: { ref: search.id, data: { [field]: value } } },
    optimistic: [
      {
        op: 'update_object',
        id: search.id,
        patch: { data: { ...search.data, [field]: value } },
        origin: 'direct',
      },
    ],
  };
}

/** Adds a trimmed entry to a list; null for one that's empty, too long, repeated, or a full list. */
export function addTo(
  search: GraphObject,
  field: ListField,
  value: string,
): CapabilityAction | null {
  const list = (search.data as SearchData)[field];
  const entry = value.trim();
  const limit = LISTS[field];
  const repeated = list.some((item) => item.toLowerCase() === entry.toLowerCase());

  if (entry.length === 0 || entry.length > limit.length || list.length >= limit.max || repeated) {
    return null;
  }

  return edit(search, field, [...list, entry]);
}

/** Removes an entry; null when it isn't there or the list would drop below its minimum. */
export function removeFrom(
  search: GraphObject,
  field: ListField,
  value: string,
): CapabilityAction | null {
  const list = (search.data as SearchData)[field];
  const next = list.filter((item) => item !== value);

  if (next.length === list.length || next.length < LISTS[field].min) {
    return null;
  }

  return edit(search, field, next);
}

/** Turns a work mode on or off, kept in the sheet's order; null when it would leave none. */
export function toggleWorkMode(search: GraphObject, mode: WorkMode): CapabilityAction | null {
  const modes = (search.data as SearchData).workModes;
  const on = modes.includes(mode);
  const next = WORK_MODES.map((entry) => entry.value).filter((value) =>
    value === mode ? !on : modes.includes(value),
  );

  return next.length === 0 ? null : edit(search, 'workModes', next);
}

/**
 * A new pay floor in the floor's own currency, from what was typed ("£130,000", "135k"). Null
 * with no floor to change (adding one is an ask, since the app can't know its currency), or for
 * text that isn't a new, positive amount.
 */
export function salaryFloorAction(search: GraphObject, typed: string): CapabilityAction | null {
  const floor = (search.data as SearchData).salaryFloor;
  const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(typed.toLowerCase().replace(/[^0-9.k]/g, ''));

  if (!floor || !match) {
    return null;
  }

  const amount = Math.round(Number(match[1]) * (match[2] === 'k' ? 1000 : 1));

  if (amount <= 0 || amount === floor.amount) {
    return null;
  }

  return edit(search, 'salaryFloor', { amount, currency: floor.currency });
}

/** Forgets one pass reason (`jobs.forgetPass`, Decision 3), shown at once. */
export function forgetPassAction(search: GraphObject, at: string): CapabilityAction {
  const data = search.data as SearchData;

  return {
    type: 'capability',
    request: { name: 'jobs.forgetPass', input: { at } },
    optimistic: [
      {
        op: 'update_object',
        id: search.id,
        patch: {
          data: { ...data, passReasons: data.passReasons.filter((pass) => pass.at !== at) },
        },
        origin: 'direct',
      },
    ],
  };
}
