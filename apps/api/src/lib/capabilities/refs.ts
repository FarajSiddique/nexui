import { idSchema, type GraphObject, type GraphSnapshot } from '@nexui/types';

import { CapabilityError } from './types.ts';

/**
 * The names models use instead of ids. `trip` is the workspace anchor; `o1`, `o2` … are the
 * objects that existed when the run started, oldest first; an object the model creates gets the
 * ref it chose. Stable names keep prompts short and let a recorded run replay against new ids.
 */
export interface RefTable {
  byRef: Map<string, string>;
  byId: Map<string, string>;
}

/** A ref the model may pick for a new object, such as `kyoto` or `tokyo-kyoto`. */
export const NEW_REF_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const RESERVED_REF = /^(trip|intent|o\d+)$/;

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

/** Oldest first; ties break on kind, then title, then id. */
export function compareObjects(a: GraphObject, b: GraphObject): number {
  return (
    compareText(a.createdAt, b.createdAt) ||
    compareText(a.kind, b.kind) ||
    compareText(a.title ?? '', b.title ?? '') ||
    compareText(a.id, b.id)
  );
}

function addRef(table: RefTable, ref: string, id: string): void {
  table.byRef.set(ref, id);

  if (!table.byId.has(id)) {
    table.byId.set(id, ref);
  }
}

/** The refs for a snapshot: `trip` for the anchor, then `o1` … for everything else. */
export function buildRefTable(snapshot: GraphSnapshot, anchorId: string): RefTable {
  const table: RefTable = { byRef: new Map(), byId: new Map() };
  const others = snapshot.objects.filter((object) => object.id !== anchorId).sort(compareObjects);

  addRef(table, 'trip', anchorId);
  others.forEach((object, index) => addRef(table, `o${index + 1}`, object.id));

  return table;
}

/**
 * The live object a ref names. Also accepts the id of an object in `graph`, which is how an
 * insight's action input (`{ placeId: <uuid> }`) works; ids from anywhere else never resolve.
 */
export function resolveRef(table: RefTable, graph: GraphSnapshot, ref: string): GraphObject {
  const id = table.byRef.get(ref) ?? (idSchema.safeParse(ref).success ? ref : undefined);
  const object = id ? graph.objects.find((candidate) => candidate.id === id) : undefined;

  if (!object) {
    throw new CapabilityError(`Nothing is called "${ref.slice(0, 40)}".`);
  }

  return object;
}

/** Checks a ref the model picked for a new object: well formed, not reserved, not in use. */
export function checkNewRef(table: RefTable, ref: string): void {
  if (!NEW_REF_PATTERN.test(ref) || RESERVED_REF.test(ref)) {
    throw new CapabilityError(
      `"${ref.slice(0, 40)}" can't be used as a ref. Use lowercase letters, digits, - or _.`,
    );
  }

  if (table.byRef.has(ref)) {
    throw new CapabilityError(`The ref "${ref}" is already used.`);
  }
}

export function claimRefs(table: RefTable, refs: Record<string, string>): void {
  for (const [ref, id] of Object.entries(refs)) {
    addRef(table, ref, id);
  }
}

/** The ref shown for an object, or its id when it has none (an object derived mid-run). */
export function refOf(table: RefTable, id: string): string {
  return table.byId.get(id) ?? id;
}

/**
 * A copy of `data` with each string in a field ending in `Id` (a stay's `placeId`) replaced by
 * the id its ref names.
 */
export function resolveIdFields(
  table: RefTable,
  graph: GraphSnapshot,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...data };

  for (const [key, value] of Object.entries(data)) {
    if (key.endsWith('Id') && typeof value === 'string') {
      resolved[key] = resolveRef(table, graph, value).id;
    }
  }

  return resolved;
}
