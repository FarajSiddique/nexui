import { tool, type ToolSet } from 'ai';

import type { Capability, LookupContext, LookupTool } from '#lib/capabilities';
import type { Stager } from '#lib/staging';

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
 * capabilityForTool('trip_setPlaceDays', capabilities) // 'trip.setPlaceDays'
 */
export function capabilityForTool(
  toolName: string,
  capabilities: readonly Capability[],
): string | null {
  return capabilities.find((capability) => toolNameFor(capability.name) === toolName)?.name ?? null;
}

/** A run's lookups, and the context each call reads, built when it runs. */
export interface ModelLookups {
  tools: readonly LookupTool[];
  context: () => LookupContext;
}

// One lookup as a tool. Past its per-run cap, or when it throws, it answers an error the model
// can read; the log names only the lookup, never what it was asked or what failed.
function lookupTool(lookup: LookupTool, context: () => LookupContext): ToolSet[string] {
  let calls = 0;

  return tool({
    description: lookup.description,
    inputSchema: lookup.input,
    execute: async (input: unknown) => {
      if (calls >= lookup.perRun) {
        const unit = lookup.perRun === 1 ? 'call' : 'calls';

        return {
          error: `This request has used its ${lookup.perRun} ${toolNameFor(lookup.name)} ${unit}.`,
        };
      }

      calls += 1;

      try {
        return await lookup.execute(input, context());
      } catch {
        console.error('[lookups]', `${lookup.name} failed unexpectedly.`);

        return { error: 'That lookup failed.' };
      }
    },
  });
}

/**
 * The model's tools: each capability it may use, staged through `stager`, then the run's
 * lookups. A refused capability call throws, and the AI SDK hands the model the message as a
 * tool error to correct; a lookup answers its errors instead.
 */
export function toModelTools(
  capabilities: readonly Capability[],
  stager: Stager,
  lookups?: ModelLookups,
): ToolSet {
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

  if (lookups) {
    for (const lookup of lookups.tools) {
      tools[toolNameFor(lookup.name)] = lookupTool(lookup, lookups.context);
    }
  }

  return tools;
}
