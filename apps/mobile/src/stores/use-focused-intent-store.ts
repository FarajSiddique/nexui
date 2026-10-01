import { create } from 'zustand';

interface FocusedIntentState {
  intentId: string | null;
}

/** The workspace on screen, if any, so + acts on it instead of starting a plan. */
export const useFocusedIntentStore = create<FocusedIntentState>(() => ({ intentId: null }));

export function focusIntent(intentId: string | null): void {
  useFocusedIntentStore.setState({ intentId });
}
