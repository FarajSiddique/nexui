import type { ChangeItem } from '@nexui/types';

import { dayLabel } from './format.ts';

export type ChangeFilter = 'all' | 'you' | 'nexui' | 'auto';

export type RowActor = 'user' | 'ai' | 'derived';

export interface ChangeRow {
  key: string;
  eventId: string;
  intentId: string | null;
  actor: RowActor;
  who: string;
  /** The sentence after `who`, such as "set Tokyo to". */
  text: string;
  diff: { before: string; after: string; unit: string } | null;
  intentGoal: string | null;
  createdAt: string;
  undone: boolean;
  /**
   * The event to revert: the change itself (Undo), or the latest Undo or Redo in its chain.
   * Null for derived rows, which undo with the edit that caused them, and for the create event.
   */
  revert: { label: 'Undo' | 'Redo'; eventId: string } | null;
}

type Row = Record<string, unknown>;
type StoredOp = NonNullable<ChangeItem['ops']>[number];
type Sentence = Pick<ChangeRow, 'text' | 'diff'>;

const WHO: Record<RowActor, string> = { user: 'You', ai: 'Nexui', derived: 'Auto-calculated' };

const FIGURES = [
  ['unallocatedDays', 'unallocated days'],
  ['totalDays', 'total days'],
] as const;

function asRow(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

const dataOf = (row: Row | null): Row => asRow(row?.data);

function kindOf(op: StoredOp): string | null {
  const kind = (op.after ?? op.before)?.kind;

  return typeof kind === 'string' ? kind : null;
}

function nameOf(op: StoredOp): string {
  const row = op.after ?? op.before;
  const name = dataOf(row).name;

  if (typeof name === 'string' && name.length > 0) {
    return name;
  }

  return typeof row?.title === 'string' && row.title.length > 0 ? row.title : 'an item';
}

const quote = (text: unknown): string => `“${String(text)}”`;

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const shown = (value: unknown): string =>
  value === null || value === undefined ? '—' : String(value);

function onlyMoved(op: StoredOp): boolean {
  return (
    op.before?.position !== op.after?.position &&
    JSON.stringify(dataOf(op.before)) === JSON.stringify(dataOf(op.after))
  );
}

function describeObjects(ops: StoredOp[]): Sentence | null {
  const inserts = ops.filter((op) => op.op === 'insert_object');
  const updates = ops.filter((op) => op.op === 'update_object');
  const deletes = ops.filter((op) => op.op === 'delete_object');
  const decision = inserts.find((op) => kindOf(op) === 'decision');

  if (decision) {
    const options = inserts.filter((op) => kindOf(op) === 'option').length;

    return {
      text: `proposed ${count(options, 'option', 'options')} for ${quote(dataOf(decision.after).question)}`,
      diff: null,
    };
  }

  const settled = updates.find(
    (op) =>
      kindOf(op) === 'decision' &&
      dataOf(op.before).status === 'open' &&
      dataOf(op.after).status !== 'open',
  );

  if (settled) {
    const verb = dataOf(settled.after).status === 'resolved' ? 'settled' : 'dismissed';

    return { text: `${verb} ${quote(dataOf(settled.after).question)}`, diff: null };
  }

  const dayEdits = updates.filter(
    (op) => kindOf(op) === 'place' && dataOf(op.before).days !== dataOf(op.after).days,
  );

  if (dayEdits.length === 1 && updates.length === 1 && inserts.length + deletes.length === 0) {
    const [edit] = dayEdits as [StoredOp];
    const after = dataOf(edit.after).days;

    return {
      text: `set ${nameOf(edit)} to`,
      diff: {
        before: shown(dataOf(edit.before).days),
        after: shown(after),
        unit: after === 1 ? 'day' : 'days',
      },
    };
  }

  if (updates.length > 0 && inserts.length + deletes.length === 0 && updates.every(onlyMoved)) {
    return { text: 'reordered the route', diff: null };
  }

  const places = inserts.filter((op) => kindOf(op) === 'place');
  const [first] = places.length > 0 ? places : inserts;

  if (first) {
    const total = places.length > 0 ? places.length : inserts.length;
    const many = places.length > 0 ? 'places' : 'items';

    return { text: total === 1 ? `added ${nameOf(first)}` : `added ${total} ${many}`, diff: null };
  }

  if (deletes.length > 0) {
    const [removed] = deletes as [StoredOp];

    return {
      text: deletes.length === 1 ? `removed ${nameOf(removed)}` : `removed ${deletes.length} items`,
      diff: null,
    };
  }

  if (updates.length === 1) {
    const [update] = updates as [StoredOp];

    return {
      text: kindOf(update) === 'trip' ? 'updated the trip' : `changed ${nameOf(update)}`,
      diff: null,
    };
  }

  return null;
}

// The main row's sentence, from the event's direct ops.
function describeDirect(item: ChangeItem): Sentence {
  if (item.actor === 'system') {
    return { text: `started ${quote(item.intentGoal ?? 'a plan')}`, diff: null };
  }

  const ops = (item.ops ?? []).filter((op) => op.origin === 'direct');
  const objects = describeObjects(ops.filter((op) => op.table === 'objects'));

  if (objects) {
    return objects;
  }

  if (ops.some((op) => op.table === 'workspaces')) {
    return { text: 'rearranged the plan', diff: null };
  }

  return { text: ops.length === 0 ? 'made a change' : `made ${ops.length} changes`, diff: null };
}

// The trip figures the event recalculated. The trip's op may be `direct` when the same step
// also edited the trip (ops are merged per row), so any op on the trip counts.
function describeDerived(item: ChangeItem): Sentence[] {
  const tripOp = (item.ops ?? []).find((op) => op.table === 'objects' && kindOf(op) === 'trip');
  const before = asRow(dataOf(tripOp?.before ?? null).derived);
  const after = asRow(dataOf(tripOp?.after ?? null).derived);

  if (!tripOp?.before || Object.keys(before).length === 0) {
    return [];
  }

  return FIGURES.flatMap(([key, label]) =>
    before[key] === after[key]
      ? []
      : [{ text: label, diff: { before: shown(before[key]), after: shown(after[key]), unit: '' } }],
  );
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
 * The Changes feed's rows, newest first: one per changeset plus one per recalculated trip
 * figure. Undo and Redo events show only as the state of the row they reverted.
 */
export function buildChangeRows(items: readonly ChangeItem[]): ChangeRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return items
    .filter((item) => item.type === 'changeset' && item.revertsEventId === null)
    .flatMap((item) => {
      const { undone, target } = revertState(item, byId);
      const actor = actorOf(item);
      const main: ChangeRow = {
        key: item.id,
        eventId: item.id,
        intentId: item.intentId,
        actor,
        who: WHO[actor],
        ...describeDirect(item),
        intentGoal: item.intentGoal,
        createdAt: item.createdAt,
        undone,
        revert:
          item.actor === 'system' ? null : { label: undone ? 'Redo' : 'Undo', eventId: target },
      };
      const derived = item.actor === 'system' ? [] : describeDerived(item);

      return [
        main,
        ...derived.map((sentence, index): ChangeRow => ({
          ...main,
          ...sentence,
          key: `${item.id}:${index}`,
          actor: 'derived',
          who: WHO.derived,
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
