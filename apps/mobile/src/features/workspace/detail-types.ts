import type { GraphObject, GraphSnapshot } from '@nexui/types';

import type { WorkspaceAction } from './workspace-actions';

/**
 * What every details body receives (job search spec, section 6): the object, the plan it's in,
 * and where to report actions. Like a primitive, a body never calls the API: the object screen
 * sends what it reports, and `open` swaps the sheet to another object in place.
 */
export interface DetailProps {
  object: GraphObject;
  snapshot: GraphSnapshot;
  onAction: (action: WorkspaceAction) => void;
  /** Closes the sheet. Every body keeps Done in view. */
  onDone: () => void;
  /** An edit or upload is in flight: disable buttons that would race it. */
  busy: boolean;
}
