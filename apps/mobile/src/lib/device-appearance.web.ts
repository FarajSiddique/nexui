import { parseAppearance, type AppearancePreference } from './appearance';

// The web preview keeps the choice in localStorage; SecureStore is native only.
const KEY = 'nexui.appearance';

/** The saved choice, read synchronously so the first frame already uses it. */
export function loadAppearance(): AppearancePreference {
  try {
    return parseAppearance(window.localStorage.getItem(KEY));
  } catch {
    return 'system';
  }
}

/** Saves the choice in this browser. A failed save still applies it until the page reloads. */
export function saveAppearance(preference: AppearancePreference): void {
  try {
    window.localStorage.setItem(KEY, preference);
  } catch (caught) {
    if (__DEV__) {
      console.warn('Saving the appearance failed', caught);
    }
  }
}

// React Native Web has no Appearance override; `useScheme()` reads the choice instead.
export function applyAppearance(_preference: AppearancePreference): void {}
