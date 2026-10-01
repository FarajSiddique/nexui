import { create } from 'zustand';

interface EditMemoryState {
  /** Each stop's days before this session's first edit to it. */
  wasDays: Record<string, number>;
}

/** Remembers what a stop had before the user changed it, for the route's "was 4". */
export const useEditMemoryStore = create<EditMemoryState>(() => ({ wasDays: {} }));

/** Records an edit. Stepping back to the original value forgets it. */
export function rememberDays(placeId: string, before: number, after: number): void {
  useEditMemoryStore.setState((state) => {
    const original = state.wasDays[placeId] ?? before;
    const wasDays = { ...state.wasDays };

    if (original === after) {
      delete wasDays[placeId];
    } else {
      wasDays[placeId] = original;
    }

    return { wasDays };
  });
}
