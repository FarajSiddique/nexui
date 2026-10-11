import { z } from 'zod';

import { searchCriteriaSchema, type OptionData } from '@nexui/types';

import type { DecisionOptions } from '#lib/capabilities';

// A job search option's own field, after the shared ones.
const OPTION_FIELDS = {
  criteria: searchCriteriaSchema
    .optional()
    .describe('The criteria picking this option sets, such as {"workModes": ["remote"]}'),
};

const optionFields = z.object(OPTION_FIELDS);

/**
 * A job search's decision options (readiness doc, section 3.11): an option may carry the criteria
 * picking it sets, so "Remote or hybrid?" changes the search when the user answers.
 */
export const JOB_DECISIONS: DecisionOptions = {
  fields: OPTION_FIELDS,
  proposeHelp:
    'An option can carry the criteria picking it sets (roles, locations, workModes or ' +
    'salaryFloor).',
  resolveHelp: 'Choosing an option with criteria sets them on the search.',
  propose(option) {
    const { criteria } = optionFields.parse(option);
    const data: Partial<OptionData> = {};

    if (criteria) {
      data.criteria = criteria;
    }

    return { data, ops: [], refs: {} };
  },
  choose(ctx, option) {
    const { criteria } = option.data as OptionData;
    const search = ctx.graph.objects.find((object) => object.id === ctx.anchorId);

    if (!criteria || !search) {
      return [];
    }

    return [
      {
        op: 'update_object',
        id: search.id,
        patch: { data: { ...search.data, ...criteria } },
        origin: 'direct',
      },
    ];
  },
  settle: () => [],
};
