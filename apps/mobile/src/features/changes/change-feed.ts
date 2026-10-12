import { changesetPayloadSchema, type ChangeItem, type ChangesetPayload } from '@nexui/types';

import { capitalize, dayLabel } from '#lib';

export type ChangeFilter = 'all' | 'you' | 'nexui' | 'auto';

export type RowActor = 'user' | 'ai' | 'derived';

export interface ChangeRow {
  key: string;
  eventId: string;
  intentId: string | null;
  actor: RowActor;
  who: string;
  /** What happened, as a sentence: the change's label, or the name of a figure it moved. */
  text: string;
  diff: { before: string; after: string } | null;
  intentGoal: string | null;
  createdAt: string;
  undone: boolean;
  /**
   * The event to revert: the change itself (Undo), or the latest Undo or Redo in its chain.
   * Null for derived rows, which undo with the edit that caused them, and for the create event.
   */
  revert: { label: 'Undo' | 'Redo'; eventId: string } | null;
}

const WHO: Record<RowActor, string> = { user: 'You', ai: 'Nexui', derived: 'Auto-calculated' };

// An event's label and figures. One the app can't read counts as neither.
function payloadOf(item: ChangeItem): ChangesetPayload {
  const parsed = changesetPayloadSchema.safeParse(item.payload);

  return parsed.success ? parsed.data : {};
}

// The main row's sentence: the plan's start, the stored label, or how much changed.
function sentence(item: ChangeItem, payload: ChangesetPayload): string {
  if (item.actor === 'system') {
    return `Started “${item.intentGoal ?? 'a plan'}”`;
  }

  if (payload.label) {
    return payload.label;
  }

  const direct = (item.ops ?? []).filter((op) => op.origin === 'direct').length;

  return direct > 1 ? `Made ${direct} changes` : 'Made a change';
}

// Follows Undo → Redo → Undo … An odd number of reverts means the change is undone now, and
// the last event in the chain is the one to revert next.
function revertState(
  item: ChangeItem,
  byId: Map<string, ChangeItem>,
): { undone: boolean; target: string } {
  let target = item.id;
  let reverts = 0;
  let next = item.revertedByEventId;

  while (next && reverts < 100) {
    reverts += 1;
    target = next;
    next = byId.get(next)?.revertedByEventId ?? null;
  }

  return { undone: reverts % 2 === 1, target };
}

function actorOf(item: ChangeItem): RowActor {
  if (item.actor === 'ai') {
    return 'ai';
  }

  return item.actor === 'derived' ? 'derived' : 'user';
}

/**
 * The Changes feed's rows, newest first: one per changeset, reading its stored label, plus one
 * per figure its derivation moved. Undo and Redo events show only as the state of the row they
 * reverted. No row reads an object's kind (readiness doc, section 3.4).
 */
export function buildChangeRows(items: readonly ChangeItem[]): ChangeRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return items
    .filter((item) => item.type === 'changeset' && item.revertsEventId === null)
    .flatMap((item) => {
      const { undone, target } = revertState(item, byId);
      const actor = actorOf(item);
      const payload = payloadOf(item);
      const main: ChangeRow = {
        key: item.id,
        eventId: item.id,
        intentId: item.intentId,
        actor,
        who: WHO[actor],
        text: sentence(item, payload),
        diff: null,
        intentGoal: item.intentGoal,
        createdAt: item.createdAt,
        undone,
        revert:
          item.actor === 'system' ? null : { label: undone ? 'Redo' : 'Undo', eventId: target },
      };
      const figures = item.actor === 'system' ? [] : (payload.figures ?? []);

      return [
        main,
        ...figures.map((figure, index): ChangeRow => ({
          ...main,
          key: `${item.id}:${index}`,
          actor: 'derived',
          who: WHO.derived,
          text: capitalize(figure.label),
          diff: { before: figure.before ?? '—', after: figure.after ?? '—' },
          revert: null,
        })),
      ];
    });
}

const FILTER_ACTOR: Record<Exclude<ChangeFilter, 'all'>, RowActor> = {
  you: 'user',
  nexui: 'ai',
  auto: 'derived',
};

export function filterRows(rows: readonly ChangeRow[], filter: ChangeFilter): ChangeRow[] {
  if (filter === 'all') {
    return [...rows];
  }

  return rows.filter((row) => row.actor === FILTER_ACTOR[filter]);
}

/** Consecutive rows under "Today", "Yesterday" or a date. */
export function groupByDay(
  rows: readonly ChangeRow[],
  now: Date,
): { label: string; rows: ChangeRow[] }[] {
  const groups: { label: string; rows: ChangeRow[] }[] = [];

  for (const row of rows) {
    const label = dayLabel(row.createdAt, now);
    const last = groups.at(-1);

    if (last?.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }

  return groups;
}
