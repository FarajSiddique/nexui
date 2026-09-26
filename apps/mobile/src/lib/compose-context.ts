import type { IntentAction, IntentDecision, ItemKind } from '@nexui/types';

import { displayShortDay } from './intent-display.ts';

/** The tabs the + sheet can open from. */
export type ShellTab = 'home' | 'tasks' | 'calendar' | 'notes';

const TAB_ROUTES: Record<string, ShellTab> = {
  index: 'home',
  tasks: 'tasks',
  calendar: 'calendar',
  notes: 'notes',
};

/** The kind each tab defaults to; Home has none. */
export const TAB_KINDS: Partial<Record<ShellTab, ItemKind>> = {
  tasks: 'task',
  calendar: 'event',
  notes: 'note',
};

/** The part of a React Navigation state the + sheet reads. */
export interface NavigationStateLike {
  index?: number;
  routes: readonly { name: string; state?: NavigationStateLike }[];
}

function isShellTab(value: string | undefined): value is ShellTab {
  return value === 'home' || value === 'tasks' || value === 'calendar' || value === 'notes';
}

/**
 * The tab under the + sheet, read from the `(app)` stack's state: the focused route of
 * its `(tabs)` group. Falls back to the `from` param, then Home.
 *
 * @example
 * currentTab({ routes: [{ name: '(tabs)', state: { index: 1, routes: [...] } }] }) // 'tasks'
 */
export function currentTab(
  state: NavigationStateLike | undefined,
  from?: string | string[],
): ShellTab {
  const tabs = state?.routes.find((route) => route.name === '(tabs)')?.state;
  const focused = tabs?.routes[tabs.index ?? 0]?.name;
  const fromTab = Array.isArray(from) ? from[0] : from;

  if (focused && TAB_ROUTES[focused]) {
    return TAB_ROUTES[focused];
  }

  return isShellTab(fromTab) ? fromTab : 'home';
}

/**
 * The line at the top of the + sheet that says what the defaults are.
 *
 * @example
 * composeContextLine('calendar', '2026-09-26')
 * // 'From Calendar. Events with no date go on Sat 26 Sep.'
 */
export function composeContextLine(tab: ShellTab, selectedDay: string): string {
  switch (tab) {
    case 'home':
      return 'Type anything. Nexui works out what it is.';
    case 'tasks':
      return 'From Tasks. Anything unclear becomes a task.';
    case 'notes':
      return 'From Notes. Anything unclear becomes a note.';
    case 'calendar':
      return `From Calendar. Events with no date go on ${displayShortDay(selectedDay)}.`;
  }
}

const INTENTS = { task: 'CREATE_TASK', event: 'CREATE_EVENT', note: 'CREATE_NOTE' } as const;

// The date a blank draft starts with: the selected day from Calendar, today for events
// elsewhere, and no date for tasks outside Calendar.
function defaultDate(kind: ItemKind, tab: ShellTab, selectedDay: string): string | null {
  if (kind === 'note') {
    return null;
  }

  if (tab === 'calendar' || kind === 'event') {
    return selectedDay;
  }

  return null;
}

/**
 * An empty draft of one kind for the "Blank" chips, built like the change flow's
 * "create instead" draft. The user chose the kind, so it counts as certain.
 *
 * @example
 * blankDraft('event', 'home', '2026-09-26').action
 * // { kind: 'CREATE_EVENT', title: '', start: { date: '2026-09-26', time: null }, ... }
 */
export function blankDraft(kind: ItemKind, tab: ShellTab, selectedDay: string): IntentDecision {
  const date = defaultDate(kind, tab, selectedDay);
  const when = date ? { date, time: null } : null;
  let action: IntentAction;

  switch (kind) {
    case 'task':
      action = { kind: 'CREATE_TASK', title: '', due: when, priority: 'normal' };
      break;
    case 'event':
      action = {
        kind: 'CREATE_EVENT',
        title: '',
        start: when,
        durationMin: 60,
        attendees: [],
        location: null,
      };
      break;
    case 'note':
      action = { kind: 'CREATE_NOTE', title: '', body: null };
      break;
  }

  return { intent: INTENTS[kind], confidence: 1, entities: { title: '' }, action };
}
