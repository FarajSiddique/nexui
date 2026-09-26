import { create } from 'zustand';

interface RecentInputsState {
  inputs: string[];
}

export const MAX_RECENT_INPUTS = 5;

// What the user last submitted in the + sheet, most recent first. Device memory only:
// losing it on restart is fine.
export const useRecentInputs = create<RecentInputsState>(() => ({ inputs: [] }));

/**
 * Records one submitted input. It is trimmed, a repeat moves to the top instead of
 * appearing twice, blank text is ignored, and only the five most recent are kept.
 *
 * @example
 * addRecentInput('call mom');
 * addRecentInput('  lunch fri ');
 * useRecentInputs.getState().inputs // ['lunch fri', 'call mom']
 */
export function addRecentInput(text: string): void {
  const input = text.trim();

  if (!input) {
    return;
  }

  useRecentInputs.setState(({ inputs }) => ({
    inputs: [input, ...inputs.filter((recent) => recent !== input)].slice(0, MAX_RECENT_INPUTS),
  }));
}
