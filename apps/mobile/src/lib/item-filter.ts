import type { SavedItem } from '@nexui/types';

// The text a tab's ⌕ filter looks through: title, note body, event location and attendees.
function searchableText(item: SavedItem): string {
  switch (item.kind) {
    case 'task':
      return item.title;
    case 'event':
      return [item.title, item.location ?? '', ...item.attendees].join(' ');
    case 'note':
      return [item.title, item.body ?? ''].join(' ');
  }
}

/**
 * Keeps the loaded items that contain the filter text, ignoring case. A blank filter keeps
 * everything.
 *
 * @example
 * filterItems(notes, 'cabin') // notes whose title or body mentions "cabin"
 */
export function filterItems<T extends SavedItem>(items: readonly T[], filter: string): T[] {
  const needle = filter.trim().toLowerCase();

  if (!needle) {
    return [...items];
  }

  return items.filter((item) => searchableText(item).toLowerCase().includes(needle));
}
