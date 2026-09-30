import { DECISION_CAPABILITIES } from './decisions.ts';
import { GRAPH_CAPABILITIES } from './graph.ts';
import { TRAVEL_CAPABILITIES } from './travel.ts';
import { WORKSPACE_CAPABILITIES } from './workspace.ts';
import type { Capability } from './types.ts';

/**
 * Every capability in slice 1 (spec section E). `derive.trip` is not listed: it runs inside
 * every changeset as the travel template's hook, and nothing calls it by name.
 */
export const CAPABILITIES: readonly Capability[] = [
  ...GRAPH_CAPABILITIES,
  ...TRAVEL_CAPABILITIES,
  ...DECISION_CAPABILITIES,
  ...WORKSPACE_CAPABILITIES,
];

export function findCapability(name: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}
