import { create } from 'zustand';

import type { AppearancePreference } from '@/lib/appearance';
import { applyAppearance, loadAppearance, saveAppearance } from '@/lib/device-appearance';

interface AppearanceState {
  preference: AppearancePreference;
}

// Runs on import, which `use-theme.ts` triggers before the first frame, so native UI starts in
// the saved scheme.
const saved = loadAppearance();

applyAppearance(saved);

/** The Appearance choice from Account, saved on this device. `useScheme()` reads it. */
export const useAppearanceStore = create<AppearanceState>(() => ({ preference: saved }));

// Applies before the store update, so the re-render already sees the native scheme.
export function setAppearance(preference: AppearancePreference): void {
  saveAppearance(preference);
  applyAppearance(preference);
  useAppearanceStore.setState({ preference });
}
