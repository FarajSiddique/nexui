import type { ComponentType, ReactElement } from 'react';

import type { GraphSnapshot, Section } from '@nexui/types';

import type { PhotoState } from '#data';
import { TimelineSection } from '#features/jobs';
import { AllocationSection, MapSection, RouteSection } from '#features/travel';
import {
  ComparisonSection,
  DecisionSection,
  InsightSection,
  MetricSection,
  ObjectListSection,
  PendingSection,
  type SectionDataOf,
  type SectionEntry,
  type SectionProps,
  type WorkspaceAction,
} from '#features/workspace';

/**
 * Every section type's primitive: the generic ones from `features/workspace`, each template's
 * from its folder. A type without one fails typecheck (spec section D). A new template adds its
 * primitives here, one line each.
 */
export const SECTION_REGISTRY: { [T in Section['type']]: ComponentType<SectionProps<T>> } = {
  map: MapSection,
  route: RouteSection,
  metric: MetricSection,
  allocation: AllocationSection,
  objectList: ObjectListSection,
  comparison: ComparisonSection,
  decision: DecisionSection,
  insight: InsightSection,
  pipeline: PendingSection,
  timeline: TimelineSection,
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
