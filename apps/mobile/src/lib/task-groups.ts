import type { SavedTask } from '@nexui/types';

import { displayShortDay, displayTime, displayWeekday } from './intent-display.ts';

export type TaskGroupKey = 'today' | 'upcoming' | 'none';

/** One section of the Tasks tab. */
export interface TaskGroup {
  key: TaskGroupKey;
  title: string;
  data: SavedTask[];
}

const GROUP_TITLES: Record<TaskGroupKey, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  none: 'No date',
};

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

function groupOf(task: SavedTask, today: string): TaskGroupKey {
  if (!task.due) {
    return 'none';
  }

  return task.due.date <= today ? 'today' : 'upcoming';
}

// Due date, then timed before untimed on the same day, then newest first.
function compareTasks(a: SavedTask, b: SavedTask): number {
  const byDate = (a.due?.date ?? '').localeCompare(b.due?.date ?? '');

  if (byDate !== 0) {
    return byDate;
  }

  const aTime = a.due?.time ?? null;
  const bTime = b.due?.time ?? null;

  if (aTime !== bTime) {
    if (aTime === null) {
      return 1;
    }

    if (bTime === null) {
      return -1;
    }

    return aTime.localeCompare(bTime);
  }

  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Splits open tasks into Today (due today or overdue), Upcoming and No date, each sorted
 * by due date and time. Empty groups are left out. `today` is the device's YYYY-MM-DD.
 *
 * @example
 * groupTasks(tasks, '2026-09-26')
 * // [{ key: 'today', title: 'Today', data: [...] }, { key: 'none', title: 'No date', ... }]
 */
export function groupTasks(tasks: readonly SavedTask[], today: string): TaskGroup[] {
  const keys: TaskGroupKey[] = ['today', 'upcoming', 'none'];

  return keys
    .map((key) => ({
      key,
      title: GROUP_TITLES[key],
      data: tasks.filter((task) => groupOf(task, today) === key).sort(compareTasks),
    }))
    .filter((group) => group.data.length > 0);
}

/**
 * The metadata line under a task. Overdue tasks name the weekday they fell due (or the
 * date, once that is more than six days ago).
 *
 * @example
 * taskDueLabel(dueFri25Sep, '2026-09-26') // 'Overdue since Fri'
 * taskDueLabel(dueToday3pm, '2026-09-26') // 'Due today, 3:00 PM'
 * taskDueLabel(dueSat3Oct, '2026-09-26') // 'Due Sat 3 Oct'
 */
export function taskDueLabel(task: SavedTask, today: string): string {
  if (!task.due) {
    return 'No date';
  }

  const { date, time } = task.due;
  const daysAway = dayNumber(date) - dayNumber(today);

  if (daysAway < 0) {
    return `Overdue since ${daysAway >= -6 ? displayWeekday(date) : displayShortDay(date)}`;
  }

  let day = `Due ${displayShortDay(date)}`;

  if (daysAway === 0) {
    day = 'Due today';
  } else if (daysAway === 1) {
    day = 'Due tomorrow';
  }

  return time ? `${day}, ${displayTime(time) ?? time}` : day;
}
