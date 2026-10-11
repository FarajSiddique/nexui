import type { GraphObject, GraphSnapshot } from '../graph.ts';
import { anchorKindSchema, type AnchorKind } from './figures.ts';
import { searchMeta } from './jobs/meta.ts';
import type { SearchData } from './jobs/schemas.ts';
import { tripMeta } from './travel/meta.ts';
import type { TripData } from './travel/schemas.ts';

/** Each anchor kind's line under the plan's title (readiness doc, section 3.5). */
export const KIND_META: Record<AnchorKind, (anchor: GraphObject) => string> = {
  trip: (anchor) => tripMeta(anchor.data as Partial<TripData>),
  search: (anchor) => searchMeta(anchor.data as Partial<SearchData>),
};

/** A plan's meta line and the anchor it describes, which the line opens when it has a sheet. */
export interface AnchorMeta {
  objectId: string;
  kind: AnchorKind;
  text: string;
}

/**
 * The plan's meta line, or null for a plan with no anchor or nothing to say yet.
 *
 * @example
 * anchorMeta(snapshot) // { objectId: '…', kind: 'search', text: 'Staff PM · London or remote' }
 */
export function anchorMeta(snapshot: GraphSnapshot): AnchorMeta | null {
  const anchorId = snapshot.workspace?.doc.anchorId;
  const anchor = snapshot.objects.find((object) => object.id === anchorId);
  const kind = anchorKindSchema.safeParse(anchor?.kind);

  if (!anchor || !kind.success) {
    return null;
  }

  const text = KIND_META[kind.data](anchor);

  return text ? { objectId: anchor.id, kind: kind.data, text } : null;
}
