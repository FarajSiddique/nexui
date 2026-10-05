import { DECISION_CAPABILITIES } from './decisions.ts';
import { graphCapabilities } from './graph.ts';
import { TRAVEL_CAPABILITIES } from './travel.ts';
import { workspaceCapabilities } from './workspace.ts';
import type { Capability, CapabilityScope } from './types.ts';

/** A trip's kinds, for the generic capabilities, and the examples their descriptions use. */
export const TRAVEL_SCOPE: CapabilityScope = {
  anchorKind: 'trip',
  kinds: ['trip', 'place', 'leg', 'stay', 'decision', 'option', 'insight', 'thing'],
  examples: {
    objectRef: 'kyoto or tokyo-kyoto',
    decisionRef: 'rural-stop',
    metric: '{"hoursFromKyoto": 1}',
    sectionId: 'place-costs',
    field: 'data.days',
  },
};

/**
 * Every capability in slice 1 (spec section E). `derive.trip` is not listed: it runs inside
 * every changeset as the travel template's hook, and nothing calls it by name.
 */
export const CAPABILITIES: readonly Capability[] = [
  ...graphCapabilities(TRAVEL_SCOPE),
  ...TRAVEL_CAPABILITIES,
  ...DECISION_CAPABILITIES,
  ...workspaceCapabilities(TRAVEL_SCOPE),
];

export function findCapability(name: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.name === name);
}
