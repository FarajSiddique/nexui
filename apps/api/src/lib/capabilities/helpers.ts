import {
  KIND_REGISTRY,
  tripParts,
  type ChangesetOp,
  type GraphObject,
  type KindName,
  type Section,
  type WorkspaceDoc,
} from '@nexui/types';

import { resolveRef } from './refs.ts';
import { CapabilityError, type CapabilityContext } from './types.ts';

/** An object's name for labels and messages. */
export function nameOf(object: GraphObject): string {
  return object.title ?? object.kind;
}

/**
 * @example
 * dayCount(1) // '1 day'
 */
export function dayCount(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export interface NewObject {
  id: string;
  kind: KindName;
  title: string | null;
  data: Record<string, unknown>;
  position: number | null;
}

/** An `insert_object` op with the call's provenance and the kind's current version. */
export function insertObject(ctx: CapabilityContext, object: NewObject): ChangesetOp {
  return {
    op: 'insert_object',
    id: object.id,
    kind: object.kind,
    kindVersion: KIND_REGISTRY[object.kind].version,
    title: object.title,
    status: null,
    data: object.data,
    source: ctx.source,
    position: object.position,
    origin: 'direct',
  };
}

/** A new object-to-object link, such as a place `part_of` the trip. */
export function link(
  ctx: CapabilityContext,
  sourceId: string,
  type: string,
  targetId: string,
): ChangesetOp {
  return {
    op: 'insert_relationship',
    id: ctx.newId(),
    sourceType: 'object',
    sourceId,
    targetType: 'object',
    targetId,
    type,
    metadata: null,
    origin: 'direct',
  };
}

/** Deletes every live link that touches one of `ids`, each once. */
export function unlinkOps(ctx: CapabilityContext, ids: readonly string[]): ChangesetOp[] {
  const touched = new Set(ids);

  return ctx.graph.relationships
    .filter((edge) => touched.has(edge.sourceId) || touched.has(edge.targetId))
    .map((edge): ChangesetOp => ({ op: 'delete_relationship', id: edge.id, origin: 'direct' }));
}

/** The trip's places in route order. */
export function tripPlaces(ctx: CapabilityContext): GraphObject[] {
  return tripParts(ctx.graph, ctx.anchorId).places;
}

/** The route position after the last place. */
export function nextPosition(ctx: CapabilityContext): number {
  return (tripPlaces(ctx).at(-1)?.position ?? 0) + 1;
}

export function requirePlace(ctx: CapabilityContext, ref: string): GraphObject {
  const object = resolveRef(ctx.refs, ctx.graph, ref);

  if (object.kind !== 'place') {
    throw new CapabilityError(`${nameOf(object)} is not a place.`);
  }

  return object;
}

export function requireDoc(ctx: CapabilityContext): WorkspaceDoc {
  const doc = ctx.graph.workspace?.doc;

  if (!doc) {
    throw new CapabilityError('This plan has no workspace.');
  }

  return doc;
}

/** Where a section goes: first, last, or after the section with that id. */
export type SectionSlot = 'first' | 'last' | { after: string };

const MAX_SECTIONS = 30;

export function placeSection(
  sections: readonly Section[],
  section: Section,
  slot: SectionSlot,
): Section[] {
  if (sections.length >= MAX_SECTIONS) {
    throw new CapabilityError('The plan has no room for another section.');
  }

  if (slot === 'first') {
    return [section, ...sections];
  }

  if (slot === 'last') {
    return [...sections, section];
  }

  const index = sections.findIndex((candidate) => candidate.id === slot.after);

  if (index === -1) {
    throw new CapabilityError(`There is no "${slot.after}" section.`);
  }

  return [...sections.slice(0, index + 1), section, ...sections.slice(index + 1)];
}

export function setSections(doc: WorkspaceDoc, sections: Section[]): ChangesetOp {
  return { op: 'set_workspace', doc: { ...doc, sections }, origin: 'direct' };
}
