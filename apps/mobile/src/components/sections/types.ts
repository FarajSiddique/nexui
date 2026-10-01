import type { GraphSnapshot, Section } from '@nexui/types';

import type { SectionDataOf } from '@/lib/sections';
import type { WorkspaceAction } from '@/lib/workspace-actions';

/**
 * What every primitive receives (spec section D). Primitives render and report actions; they
 * never call the API.
 */
export interface SectionProps<T extends Section['type']> {
  section: Extract<Section, { type: T }>;
  data: SectionDataOf<T>;
  snapshot: GraphSnapshot;
  onAction: (action: WorkspaceAction) => void;
  /** A button's request is in flight: disable buttons that would race it. */
  busy: boolean;
}
