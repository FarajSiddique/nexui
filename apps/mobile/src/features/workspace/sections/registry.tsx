import type { ComponentType, ReactElement } from 'react';

import type { GraphSnapshot, Section } from '@nexui/types';

import type { PhotoState } from '#data';

import type { WorkspaceAction } from '../workspace-actions';
import type { SectionDataOf, SectionEntry } from '../workspace-layout';
import { AllocationSection } from './allocation-section';
import { ComparisonSection } from './comparison-section';
import { DecisionSection } from './decision-section';
import { InsightSection } from './insight-section';
import { MapSection } from './map-section';
import { MetricSection } from './metric-section';
import { ObjectListSection } from './object-list-section';
import { RouteSection } from './route-section';
import type { SectionProps } from './types';

/** Every section type's primitive. A type without one fails typecheck (spec section D). */
export const SECTION_REGISTRY: { [T in Section['type']]: ComponentType<SectionProps<T>> } = {
  map: MapSection,
  route: RouteSection,
  metric: MetricSection,
  allocation: AllocationSection,
  objectList: ObjectListSection,
  comparison: ComparisonSection,
  decision: DecisionSection,
  insight: InsightSection,
};

/** One section, drawn by its registered primitive. */
export function SectionView({
  entry,
  snapshot,
  onAction,
  busy,
  photos,
}: {
  entry: SectionEntry;
  snapshot: GraphSnapshot;
  onAction: (action: WorkspaceAction) => void;
  busy: boolean;
  photos: Readonly<Record<string, PhotoState>>;
}): ReactElement {
  // `layoutWorkspace` builds each entry's data from its own section, so they share a type;
  // TypeScript can't follow that through the lookup.
  const Primitive = SECTION_REGISTRY[entry.section.type] as ComponentType<
    SectionProps<Section['type']>
  >;

  return (
    <Primitive
      section={entry.section}
      data={entry.data as SectionDataOf<Section['type']>}
      snapshot={snapshot}
      onAction={onAction}
      busy={busy}
      photos={photos}
    />
  );
}
