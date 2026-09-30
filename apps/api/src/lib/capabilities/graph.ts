import { z } from 'zod';

import type { ChangesetOp, GraphObject } from '@nexui/types';

import { insertObject, link, nameOf, nextPosition, requirePlace, unlinkOps } from './helpers.ts';
import { checkNewRef, resolveIdFields, resolveRef } from './refs.ts';
import {
  CapabilityError,
  defineCapability,
  type Capability,
  type CapabilityContext,
} from './types.ts';

/** A ref (`trip`, `o3`, `kyoto`) or the id of an object in this intent. */
export const refInput = z.string().min(1).max(40);

const CREATABLE = ['place', 'leg', 'stay', 'thing'] as const;

const isCreatable = (kind: string): boolean => (CREATABLE as readonly string[]).includes(kind);
const isEditable = (kind: string): boolean => kind === 'trip' || isCreatable(kind);

const LINK_TYPES = z.enum(['part_of', 'option_of', 'leg_from', 'leg_to']);

const DATA_HELP =
  'Fields by kind. place: name, country (ISO 3166-1 alpha-2 such as JP), placeType ' +
  '(city|region|town|area|site), lat, lng, days (whole days, 0 or more), estDailyCost? ' +
  '{amount, currency}, why? (one short sentence). leg: mode (flight|train|bus|car|ferry|other), ' +
  'estHours?, estCost? {amount, currency}. stay: name, placeId (a place ref), nights, ' +
  'estNightly? {amount, currency}, url?. ' +
  'thing: fields [{label, value}].';

const objectCreate = defineCapability({
  name: 'object.create',
  description:
    'Add a place, leg, stay or thing to the trip, with a new ref to use in later calls. ' +
    'Places join the end of the route. A leg needs from and to places.',
  input: z.strictObject({
    ref: z.string().describe('A new short ref, such as kyoto or tokyo-kyoto'),
    kind: z.enum(CREATABLE),
    title: z.string().min(1).max(200).optional(),
    data: z.record(z.string(), z.unknown()).describe(DATA_HELP),
    from: refInput.optional().describe('Legs only: the place it leaves from'),
    to: refInput.optional().describe('Legs only: the place it arrives at'),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    checkNewRef(ctx.refs, input.ref);

    const id = ctx.newId();
    const data = resolveIdFields(ctx.refs, ctx.graph, input.data);
    const legLinks: ChangesetOp[] = [];
    let title = input.title ?? (typeof data.name === 'string' ? data.name : null);

    if (input.kind === 'leg') {
      if (!input.from || !input.to) {
        throw new CapabilityError('A leg needs a from place and a to place.');
      }

      const from = requirePlace(ctx, input.from);
      const to = requirePlace(ctx, input.to);

      title = input.title ?? `${nameOf(from)} → ${nameOf(to)}`;
      legLinks.push(link(ctx, id, 'leg_from', from.id), link(ctx, id, 'leg_to', to.id));
    } else if (input.from || input.to) {
      throw new CapabilityError('Only legs have from and to.');
    }

    const position = input.kind === 'place' ? nextPosition(ctx) : null;

    return {
      output: { ref: input.ref },
      ops: [
        insertObject(ctx, { id, kind: input.kind, title, data, position }),
        link(ctx, id, 'part_of', ctx.anchorId),
        ...legLinks,
      ],
      label: `Added ${title ?? input.kind}`,
      refs: { [input.ref]: id },
    };
  },
});

const objectUpdate = defineCapability({
  name: 'object.update',
  description:
    'Change fields of the trip or of one of its places, legs, stays or things. Send only the ' +
    'data fields to change; the rest keep their values.',
  input: z.strictObject({
    ref: refInput,
    title: z.string().min(1).max(200).optional(),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'The fields to change. Trip: destinations, startDate and endDate (together), ' +
          'totalDays, travelers, budget, pace, currency. Others: see object_create.',
      ),
  }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const object = resolveRef(ctx.refs, ctx.graph, input.ref);

    if (!isEditable(object.kind)) {
      throw new CapabilityError(`${nameOf(object)} can't be edited this way.`);
    }

    if (input.title === undefined && input.data === undefined) {
      throw new CapabilityError('Nothing to change.');
    }

    const patch: { title?: string; data?: Record<string, unknown> } = {};

    if (input.data) {
      const changes = resolveIdFields(ctx.refs, ctx.graph, input.data);

      // `derived` belongs to derive.trip.
      delete changes.derived;
      patch.data = { ...object.data, ...changes };

      if (typeof changes.name === 'string' && object.title === object.data.name) {
        patch.title = changes.name;
      }
    }

    if (input.title) {
      patch.title = input.title;
    }

    return {
      output: { ref: input.ref },
      ops: [{ op: 'update_object', id: object.id, patch, origin: 'direct' }],
      label: `Updated ${patch.title ?? nameOf(object)}`,
    };
  },
});

// Removing a place also removes the legs to and from it and the stays in it.
function dependents(ctx: CapabilityContext, object: GraphObject): GraphObject[] {
  if (object.kind !== 'place') {
    return [];
  }

  const legIds = new Set(
    ctx.graph.relationships
      .filter(
        (edge) =>
          (edge.type === 'leg_from' || edge.type === 'leg_to') && edge.targetId === object.id,
      )
      .map((edge) => edge.sourceId),
  );

  return ctx.graph.objects.filter(
    (candidate) =>
      legIds.has(candidate.id) ||
      (candidate.kind === 'stay' && candidate.data.placeId === object.id),
  );
}

const objectDelete = defineCapability({
  name: 'object.delete',
  description:
    'Remove a place, leg, stay or thing from the trip. Removing a place also removes its legs ' +
    'and stays.',
  input: z.strictObject({ ref: refInput }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const object = resolveRef(ctx.refs, ctx.graph, input.ref);

    if (object.id === ctx.anchorId) {
      throw new CapabilityError("The trip itself can't be removed.");
    }

    if (!isCreatable(object.kind)) {
      throw new CapabilityError(`${nameOf(object)} can't be removed this way.`);
    }

    const removed = [object, ...dependents(ctx, object)];

    return {
      output: {},
      ops: [
        ...removed.map((gone): ChangesetOp => ({
          op: 'delete_object',
          id: gone.id,
          origin: 'direct',
        })),
        ...unlinkOps(
          ctx,
          removed.map((gone) => gone.id),
        ),
      ],
      label: `Removed ${nameOf(object)}`,
    };
  },
});

const relationshipCreate = defineCapability({
  name: 'relationship.create',
  description:
    'Link two objects. part_of: a place, leg, stay or thing belongs to the trip. option_of: an ' +
    'option belongs to a decision. leg_from and leg_to: a leg leaves from or arrives at a place.',
  input: z.strictObject({ from: refInput, type: LINK_TYPES, to: refInput }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const source = resolveRef(ctx.refs, ctx.graph, input.from);
    const target = resolveRef(ctx.refs, ctx.graph, input.to);

    if (source.id === target.id) {
      throw new CapabilityError('Something cannot link to itself.');
    }

    return {
      output: {},
      ops: [link(ctx, source.id, input.type, target.id)],
      label: `Linked ${nameOf(source)} to ${nameOf(target)}`,
    };
  },
});

const relationshipDelete = defineCapability({
  name: 'relationship.delete',
  description: 'Remove one link between two objects.',
  input: z.strictObject({ from: refInput, type: LINK_TYPES, to: refInput }),
  policy: 'internal',
  exposeToModel: true,
  callableByUser: false,
  execute(input, ctx) {
    const source = resolveRef(ctx.refs, ctx.graph, input.from);
    const target = resolveRef(ctx.refs, ctx.graph, input.to);
    const edge = ctx.graph.relationships.find(
      (candidate) =>
        candidate.sourceId === source.id &&
        candidate.targetId === target.id &&
        candidate.type === input.type,
    );

    if (!edge) {
      throw new CapabilityError(`${nameOf(source)} isn't linked to ${nameOf(target)} that way.`);
    }

    return {
      output: {},
      ops: [{ op: 'delete_relationship', id: edge.id, origin: 'direct' }],
      label: `Unlinked ${nameOf(source)} from ${nameOf(target)}`,
    };
  },
});

export const GRAPH_CAPABILITIES: readonly Capability[] = [
  objectCreate,
  objectUpdate,
  objectDelete,
  relationshipCreate,
  relationshipDelete,
];
