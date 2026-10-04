import { create } from 'zustand';

interface RevealState {
  /** The plan whose Open band should scroll into view when its workspace shows next. */
  intentId: string | null;
}

/** Set by the + sheet's "See the choice"; the workspace scrolls to its Open band and clears it. */
export const useRevealStore = create<RevealState>(() => ({ intentId: null }));

export function revealOpenBand(intentId: string | null): void {
  useRevealStore.setState({ intentId });
}
