import type { GraphObject, GraphSnapshot } from '@nexui/types';

/** The company a role is `at`, if the plan has it. */
export function companyOf(graph: GraphSnapshot, roleId: string): GraphObject | undefined {
  const edge = graph.relationships.find(
    (candidate) => candidate.type === 'at' && candidate.sourceId === roleId,
  );

  return edge
    ? graph.objects.find((object) => object.id === edge.targetId && object.kind === 'company')
    : undefined;
}

/** A role's company name for a sentence, or its title when it has no company. */
export function companyName(graph: GraphSnapshot, role: GraphObject): string {
  const name = companyOf(graph, role.id)?.data.name;

  return typeof name === 'string' ? name : String(role.data.title ?? 'the company');
}

/**
 * `value` without the keys whose value is undefined. JSON drops them on the way to the database,
 * and deep equality counts them, so derived data never carries one.
 */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
