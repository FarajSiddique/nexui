import type { GraphObject, GraphSnapshot } from './graph.ts';
import type { FieldFilter, GraphQuery } from './workspace.ts';

/** Reads a query field path: a column (`title`, `status` …) or `data.<key>`. */
export function readField(object: GraphObject, field: string): unknown {
  if (field.startsWith('data.')) {
    return object.data[field.slice(5)];
  }

  switch (field) {
    case 'title':
      return object.title;
    case 'status':
      return object.status;
    case 'position':
      return object.position;
    case 'createdAt':
      return object.createdAt;
    case 'updatedAt':
      return object.updatedAt;
    default:
      return undefined;
  }
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  return null;
}

function matches(object: GraphObject, filter: FieldFilter): boolean {
  const value = readField(object, filter.field);

  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'neq':
      return value !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.some((item) => item === value);
    default: {
      const order = compare(value, filter.value);

      if (order === null) {
        return false;
      }

      switch (filter.op) {
        case 'gt':
          return order > 0;
        case 'gte':
          return order >= 0;
        case 'lt':
          return order < 0;
        case 'lte':
          return order <= 0;
      }
    }
  }
}

type Related = NonNullable<Extract<GraphQuery, { from: 'objects' }>['related']>;

function isRelated(snapshot: GraphSnapshot, object: GraphObject, related: Related): boolean {
  const target =
    related.to === 'intent'
      ? { type: 'intent', id: snapshot.intent.id }
      : { type: 'object', id: related.to.objectId };

  return snapshot.relationships.some((edge) => {
    if (edge.type !== related.type) {
      return false;
    }

    if (related.direction === 'out') {
      return (
        edge.sourceType === 'object' &&
        edge.sourceId === object.id &&
        edge.targetType === target.type &&
        edge.targetId === target.id
      );
    }

    return (
      edge.targetType === 'object' &&
      edge.targetId === object.id &&
      edge.sourceType === target.type &&
      edge.sourceId === target.id
    );
  });
}

// Nulls sort last in both directions.
function byField(field: string, dir: 'asc' | 'desc') {
  return (a: GraphObject, b: GraphObject): number => {
    const left = readField(a, field);
    const right = readField(b, field);

    if (left == null || right == null) {
      return left == null ? (right == null ? 0 : 1) : -1;
    }

    const order = compare(left, right) ?? 0;

    return dir === 'asc' ? order : -order;
  };
}

function byPosition(a: GraphObject, b: GraphObject): number {
  return byField('position', 'asc')(a, b) || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Runs a workspace section's query against a snapshot. The API and the mobile renderer both
 * use it, so a section shows the same objects on both sides.
 *
 * @example
 * evaluateQuery(snapshot, { from: 'objects', kind: 'place', sort: 'position' })
 */
export function evaluateQuery(snapshot: GraphSnapshot, query: GraphQuery): GraphObject[] {
  if (query.from === 'object') {
    return snapshot.objects.filter((object) => object.id === query.id);
  }

  const kinds = query.kind === undefined ? null : ([] as string[]).concat(query.kind);
  let rows = snapshot.objects.filter((object) => !kinds || kinds.includes(object.kind));

  if (query.related) {
    const related = query.related;

    rows = rows.filter((object) => isRelated(snapshot, object, related));
  }

  for (const filter of query.where ?? []) {
    rows = rows.filter((object) => matches(object, filter));
  }

  if (query.sort === 'position') {
    rows = [...rows].sort(byPosition);
  } else if (query.sort) {
    rows = [...rows].sort(byField(query.sort.field, query.sort.dir));
  }

  return query.limit === undefined ? rows : rows.slice(0, query.limit);
}
