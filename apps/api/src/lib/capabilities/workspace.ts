import { z } from 'zod';

import { fieldFilterSchema, type DecisionData, type GraphQuery, type Section } from '@nexui/types';

import { placeSection, requireDoc, setSections, type SectionSlot } from './helpers.ts';
import { CapabilityError, defineCapability, type Capability } from './types.ts';

const sectionId = z.string().regex(/^[a-z0-9-]{1,60}$/);

type ObjectsQuery = Extract<GraphQuery, { from: 'objects' }>;

const addSection = defineCapability({
  name: 'workspace.addSection',
  description:
    'Add a list or a comparison of the trip’s places, legs, stays or things to the plan, ' +
    'optionally filtered.',
  input: z.strictObject({
    id: sectionId.describe('A new section id, such as place-costs'),
    type: z.enum(['objectList', 'comparison']),
    title: z.string().min(1).max(60).optional(),
    kind: z.enum(['place', 'leg', 'stay', 'thing']),
    where: z.array(fieldFilterSchema).max(4).optional(),
    fields: z
      .array(
        z.strictObject({
          field: z.string().describe('title, or data.<field> such as data.days'),
          label: z.string().min(1).max(30),
          format: z.enum(['currency', 'days', 'hours', 'text']).optional(),
        }),
      )
      .min(1)
      .max(6)
      .optional()
      .describe('Comparison only: its columns'),
    after: sectionId.optional().describe('The section to put it after; leave out to add it last'),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const doc = requireDoc(ctx);

    if (doc.sections.some((section) => section.id === input.id)) {
      throw new CapabilityError(`There is already a "${input.id}" section.`);
    }

    const base: ObjectsQuery = {
      from: 'objects',
      kind: input.kind,
      related: { type: 'part_of', to: { objectId: ctx.anchorId }, direction: 'out' },
      sort: 'position',
    };
    const query: ObjectsQuery = input.where ? { ...base, where: input.where } : base;
    let section: Section;

    if (input.type === 'comparison') {
      section = {
        id: input.id,
        type: 'comparison',
        query,
        fields: input.fields ?? [{ field: 'title', label: 'Name' }],
      };
    } else {
      section = { id: input.id, type: 'objectList', query, card: 'compact' };
    }

    if (input.title) {
      section.title = input.title;
    }

    const slot: SectionSlot = input.after ? { after: input.after } : 'last';

    return {
      output: {},
      ops: [setSections(doc, placeSection(doc.sections, section, slot))],
      label: `Added the ${input.title ?? input.id} section`,
    };
  },
});

const removeSection = defineCapability({
  name: 'workspace.removeSection',
  description: 'Remove a section from the plan. The objects it showed stay.',
  input: z.strictObject({ id: sectionId }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const doc = requireDoc(ctx);
    const section = doc.sections.find((candidate) => candidate.id === input.id);

    if (!section) {
      throw new CapabilityError(`There is no "${input.id}" section.`);
    }

    if (section.type === 'decision') {
      const decision = ctx.graph.objects.find((object) => object.id === section.decisionId);

      if ((decision?.data as DecisionData | undefined)?.status === 'open') {
        throw new CapabilityError('Settle or dismiss that question instead.');
      }
    }

    return {
      output: {},
      ops: [
        setSections(
          doc,
          doc.sections.filter((candidate) => candidate.id !== input.id),
        ),
      ],
      label: `Removed the ${section.title ?? section.id} section`,
    };
  },
});

const moveSection = defineCapability({
  name: 'workspace.moveSection',
  description: 'Move a section to just after another one, or to the top with after: null.',
  input: z.strictObject({
    id: sectionId,
    after: sectionId.nullable().describe('The section to put it after, or null for the top'),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const doc = requireDoc(ctx);
    const section = doc.sections.find((candidate) => candidate.id === input.id);

    if (!section || input.after === input.id) {
      throw new CapabilityError(`There is no "${input.id}" section to move.`);
    }

    const rest = doc.sections.filter((candidate) => candidate.id !== input.id);
    const slot: SectionSlot = input.after === null ? 'first' : { after: input.after };
    const sections = placeSection(rest, section, slot);

    if (sections.every((candidate, index) => candidate.id === doc.sections[index]?.id)) {
      throw new CapabilityError('That section is already there.');
    }

    return {
      output: {},
      ops: [setSections(doc, sections)],
      label: `Moved the ${section.title ?? section.id} section`,
    };
  },
});

export const WORKSPACE_CAPABILITIES: readonly Capability[] = [
  addSection,
  removeSection,
  moveSection,
];
