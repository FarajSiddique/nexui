import { tool, type ToolSet } from 'ai';

import type { Stager, Capability } from '#lib/capabilities';

/**
 * Model APIs allow only letters, digits, `_` and `-` in tool names.
 *
 * @example
 * toolNameFor('trip.setPlaceDays') // 'trip_setPlaceDays'
 */
export function toolNameFor(capability: string): string {
  return capability.replaceAll('.', '_');
}

/**
 * The capability a model tool name stands for, or null for a name no capability has.
 *
 * @example
 * capabilityForTool('trip_setPlaceDays', CAPABILITIES) // 'trip.setPlaceDays'
 */
export function capabilityForTool(
  toolName: string,
  capabilities: readonly Capability[],
): string | null {
  return capabilities.find((capability) => toolNameFor(capability.name) === toolName)?.name ?? null;
}

/**
 * The model's tools: each capability it may use, staged through `stager`. A refused call throws,
 * and the AI SDK hands the model the message as a tool error to correct.
 */
export function toModelTools(capabilities: readonly Capability[], stager: Stager): ToolSet {
  const tools: ToolSet = {};

  for (const capability of capabilities) {
    if (!capability.exposeToModel) {
      continue;
    }

    tools[toolNameFor(capability.name)] = tool({
      description: capability.description,
      inputSchema: capability.input,
      execute: async (input: unknown) => stager.call(capability.name, input),
    });
  }

  return tools;
}
