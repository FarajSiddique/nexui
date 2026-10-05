import { z } from 'zod';

import type { GraphSnapshot } from '../graph.ts';
import type { DerivedKey } from '../workspace.ts';
import type { Money } from './money.ts';
import type { KindName } from './registry.ts';
import { tripFigures } from './travel/figures.ts';

/** Kinds that anchor a workspace: a template's root object, such as the trip. */
export const ANCHOR_KINDS = ['trip'] as const satisfies readonly KindName[];

export const anchorKindSchema = z.enum(ANCHOR_KINDS);

export type AnchorKind = z.infer<typeof anchorKindSchema>;

/** One figure a metric or allocation shows: a count, an amount, or nothing yet. */
export type FigureValue = number | Money | null;

/** An anchor's figures by name: what a derived key names after its dot. */
export type Figures = Readonly<Record<string, FigureValue>>;

/**
 * Each anchor kind's figures, recomputed from the graph with no model involved. The app reads
 * them this way rather than from `data.derived`, so an optimistic edit moves them at once; the
 * template's derivation writes the same numbers on the server.
 */
export const KIND_FIGURES: Record<
  AnchorKind,
  (snapshot: GraphSnapshot, anchorId: string) => Figures
> = {
  trip: (snapshot, anchorId) => {
    const { totalDays, allocatedDays, unallocatedDays, estCost } = tripFigures(snapshot, anchorId);

    return { totalDays, allocatedDays, unallocatedDays, estCost };
  },
};

/** The workspace anchor's kind and figures. A plan without an anchor has neither. */
export interface AnchorFigures {
  kind: AnchorKind | null;
  values: Figures;
}

/**
 * The anchor's kind and its figures, recomputed from the snapshot.
 *
 * @example
 * anchorFigures(snapshot) // { kind: 'trip', values: { totalDays: 8, … } }
 */
export function anchorFigures(snapshot: GraphSnapshot): AnchorFigures {
  const anchorId = snapshot.workspace?.doc.anchorId;
  const anchor = snapshot.objects.find((object) => object.id === anchorId);
  const kind = anchorKindSchema.safeParse(anchor?.kind);

  if (!anchor || !kind.success) {
    return { kind: null, values: {} };
  }

  return { kind: kind.data, values: KIND_FIGURES[kind.data](snapshot, anchor.id) };
}

/**
 * The figure a derived key names, or null when the key is for another anchor kind or names no
 * figure.
 *
 * @example
 * figureValue(anchorFigures(snapshot), 'trip.totalDays') // 8, on an eight-day trip
 */
export function figureValue(figures: AnchorFigures, key: DerivedKey): FigureValue {
  const [kind, name] = key.split('.');

  if (kind !== figures.kind || name === undefined || !Object.hasOwn(figures.values, name)) {
    return null;
  }

  return figures.values[name] ?? null;
}
