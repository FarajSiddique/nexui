import { z } from 'zod';

import type { ChangesetOp, GraphObject, KindName } from '@nexui/types';

import { KIND_BEHAVIOUR, type KindBehaviour, type KindLink } from '#lib/kinds';

import {
  creatableKinds,
  insertObject,
  link,
  listOf,
  nameOf,
  nextPosition,
  requireKind,
  unlinkOps,
} from './helpers.ts';
import { checkNewRef, resolveIdFields, resolveRef } from './refs.ts';
import {
  CapabilityError,
  defineCapability,
  shapedInput,
  type Capability,
  type CapabilityScope,
} from './types.ts';

/** A ref (`trip`, `o3`, `kyoto`) or the id of an object in this intent. */
export const refInput = z.string().min(1).max(40);

// Links every template has: belonging to the anchor, and a decision's options.
const SHARED_LINK_TYPES = ['part_of', 'option_of'];

/** `object.create`'s input. A kind's link inputs, such as a leg's `from` and `to`, go by name. */
interface CreateInput {
  ref: string;
  kind: KindName;
  title?: string | undefined;
  data: Record<string, unknown>;
  [linkInput: string]: unknown;
}

const capitalized = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const pluralsOf = (kinds: readonly KindName[], conjunction: 'and' | 'or'): string =>
  listOf(
    kinds.map((kind) => KIND_BEHAVIOUR[kind].plural),
    conjunction,
  );

// One sort of sentence from each kind that has it, in kind order.
function notesOf(
  kinds: readonly KindName[],
  note: (behaviour: KindBehaviour) => string | undefined,
): string[] {
  return kinds.flatMap((kind) => note(KIND_BEHAVIOUR[kind]) ?? []);
}

// Every link input the kinds take, once, in kind order: a leg's `from` and `to`.
function linkInputs(kinds: readonly KindName[]): KindLink[] {
  const byInput = new Map<string, KindLink>();

  for (const kind of kinds) {
    for (const kindLink of KIND_BEHAVIOUR[kind].links) {
      if (!byInput.has(kindLink.input)) {
        byInput.set(kindLink.input, kindLink);
      }
    }
  }

  return [...byInput.values()];
}

// "Only legs have from and to.": the kinds that take the link inputs a call misused.
function strayLinksMessage(kinds: readonly KindName[], stray: readonly KindLink[]): string {
  const misused = new Set(stray.map((kindLink) => kindLink.input));
  const owners = kinds.filter((kind) =>
    KIND_BEHAVIOUR[kind].links.some((kindLink) => misused.has(kindLink.input)),
  );
  const inputs = linkInputs(owners).map((kindLink) => kindLink.input);

  return `Only ${pluralsOf(owners, 'and')} have ${listOf(inputs, 'and')}.`;
}

// A new object's title when the call gives none: from the objects its links name (a leg's
// "Tokyo → Kyoto"), else its data's name.
function defaultTitle(
  behaviour: KindBehaviour,
  linked: readonly GraphObject[],
  data: Record<string, unknown>,
): string | null {
  if (behaviour.title && linked.length > 0) {
    return behaviour.title(linked);
  }

  return typeof data.name === 'string' ? data.name : null;
}

function objectCreate(scope: CapabilityScope): Capability {
  const kinds = creatableKinds(scope);
  const inputs = linkInputs(kinds);
  const dataHelp = kinds.map((kind) => `${kind}: ${KIND_BEHAVIOUR[kind].modelHelp ?? ''}`);
  const shape: Record<string, z.ZodType> = {
    ref: z.string().describe(`A new short ref, such as ${scope.examples.objectRef}`),
    kind: z.enum(kinds as [KindName, ...KindName[]]),
    title: z.string().min(1).max(200).optional(),
    data: z.record(z.string(), z.unknown()).describe(`Fields by kind. ${dataHelp.join(' ')}`),
  };

  for (const kindLink of inputs) {
    shape[kindLink.input] = refInput.optional().describe(kindLink.help);
  }

  return defineCapability<CreateInput>({
    name: 'object.create',
    description: [
      `Add a ${listOf(kinds, 'or')} to the ${scope.anchorKind}, with a new ref to use in later ` +
        'calls.',
      ...notesOf(kinds, (behaviour) => behaviour.createNote),
    ].join(' '),
    input: shapedInput<CreateInput>(z.strictObject(shape)),
    policy: 'internal',
    exposeToModel: true,
    callableByUser: false,
    execute(input, ctx) {
      checkNewRef(ctx.refs, input.ref);

      const behaviour = KIND_BEHAVIOUR[input.kind];
      const id = ctx.newId();
      const data = resolveIdFields(ctx.refs, ctx.graph, input.data);
      const own = new Set(behaviour.links.map((kindLink) => kindLink.input));
      const stray = inputs.filter(
        (kindLink) => input[kindLink.input] !== undefined && !own.has(kindLink.input),
      );

      if (stray.length > 0) {
        throw new CapabilityError(strayLinksMessage(kinds, stray));
      }

      if (behaviour.links.some((kindLink) => typeof input[kindLink.input] !== 'string')) {
        const needs = behaviour.links.map((kindLink) => `a ${kindLink.input} ${kindLink.to}`);

        throw new CapabilityError(`A ${input.kind} needs ${listOf(needs, 'and')}.`);
      }

      const linked = behaviour.links.map((kindLink) => ({
        kindLink,
        target: requireKind(ctx, String(input[kindLink.input]), kindLink.to),
      }));
      const linkOps = linked.map(({ kindLink, target }) => link(ctx, id, kindLink.type, target.id));
      const title =
        input.title ??
        defaultTitle(
          behaviour,
          linked.map(({ target }) => target),
          data,
        );
      const position = behaviour.positioned ? nextPosition(ctx, input.kind) : null;

      return {
        output: { ref: input.ref },
        ops: [
          insertObject(ctx, { id, kind: input.kind, title, data, position }),
          link(ctx, id, 'part_of', ctx.anchorId),
          ...linkOps,
        ],
        label: `Added ${title ?? input.kind}`,
        refs: { [input.ref]: id },
      };
    },
  });
}

function objectUpdate(scope: CapabilityScope): Capability {
  const editable: readonly string[] = scope.kinds.filter((kind) => KIND_BEHAVIOUR[kind].editable);
  const parts = scope.kinds.filter(
    (kind) => kind !== scope.anchorKind && KIND_BEHAVIOUR[kind].editable,
  );
  const anchorHelp = KIND_BEHAVIOUR[scope.anchorKind].modelHelp ?? '';

  return defineCapability({
    name: 'object.update',
    description:
      `Change fields of the ${scope.anchorKind} or of one of its ${pluralsOf(parts, 'or')}. ` +
      'Send only the data fields to change; the rest keep their values.',
    input: z.strictObject({
      ref: refInput,
      title: z.string().min(1).max(200).optional(),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          `The fields to change. ${capitalized(scope.anchorKind)}: ${anchorHelp} Others: see ` +
            'object_create.',
        ),
    }),
    policy: 'internal',
    exposeToModel: true,
    callableByUser: false,
    execute(input, ctx) {
      const object = resolveRef(ctx.refs, ctx.graph, input.ref);

      if (!editable.includes(object.kind)) {
        throw new CapabilityError(`${nameOf(object)} can't be edited this way.`);
      }

      if (input.title === undefined && input.data === undefined) {
        throw new CapabilityError('Nothing to change.');
      }

      const patch: { title?: string; data?: Record<string, unknown> } = {};

      if (input.data) {
        const changes = resolveIdFields(ctx.refs, ctx.graph, input.data);

        // `derived` belongs to the template's derivation.
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
}

function objectDelete(scope: CapabilityScope): Capability {
  const kinds = creatableKinds(scope);

  return defineCapability({
    name: 'object.delete',
    description: [
      `Remove a ${listOf(kinds, 'or')} from the ${scope.anchorKind}.`,
      ...notesOf(kinds, (behaviour) => behaviour.deleteNote),
    ].join(' '),
    input: z.strictObject({ ref: refInput }),
    policy: 'internal',
    exposeToModel: true,
    callableByUser: false,
    execute(input, ctx) {
      const object = resolveRef(ctx.refs, ctx.graph, input.ref);

      if (object.id === ctx.anchorId) {
        throw new CapabilityError(`The ${scope.anchorKind} itself can't be removed.`);
      }

      const kind = kinds.find((candidate) => candidate === object.kind);

      if (!kind) {
        throw new CapabilityError(`${nameOf(object)} can't be removed this way.`);
      }

      const removed = [object, ...(KIND_BEHAVIOUR[kind].dependents?.(ctx.graph, object) ?? [])];

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
}

// The link types models may make or remove: the shared ones, then the kinds' own.
function linkTypes(scope: CapabilityScope): [string, ...string[]] {
  const own = linkInputs(creatableKinds(scope)).map((kindLink) => kindLink.type);

  return [...new Set([...SHARED_LINK_TYPES, ...own])] as [string, ...string[]];
}

function relationshipCreate(scope: CapabilityScope, types: [string, ...string[]]): Capability {
  const kinds = creatableKinds(scope);

  return defineCapability({
    name: 'relationship.create',
    description: [
      `Link two objects. part_of: a ${listOf(kinds, 'or')} belongs to the ${scope.anchorKind}.`,
      'option_of: an option belongs to a decision.',
      ...notesOf(kinds, (behaviour) => behaviour.linkNote),
    ].join(' '),
    input: z.strictObject({ from: refInput, type: z.enum(types), to: refInput }),
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
}

function relationshipDelete(types: [string, ...string[]]): Capability {
  return defineCapability({
    name: 'relationship.delete',
    description: 'Remove one link between two objects.',
    input: z.strictObject({ from: refInput, type: z.enum(types), to: refInput }),
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
}

/**
 * The generic graph capabilities for a template's kinds (readiness doc, section 3.2). What they
 * may create, change, link and remove, and what models read about each kind, come from
 * `KIND_BEHAVIOUR`, so a new kind needs no code here.
 */
export function graphCapabilities(scope: CapabilityScope): Capability[] {
  const types = linkTypes(scope);

  return [
    objectCreate(scope),
    objectUpdate(scope),
    objectDelete(scope),
    relationshipCreate(scope, types),
    relationshipDelete(types),
  ];
}
