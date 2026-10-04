import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

import { parseAppearance, type AppearancePreference } from './appearance';

// SecureStore is the app's only on-device store; the choice is tiny and read synchronously.
const KEY = 'appearance';

/** The saved choice, read synchronously so the first frame already uses it. */
export function loadAppearance(): AppearancePreference {
  try {
    return parseAppearance(SecureStore.getItem(KEY));
  } catch {
    return 'system';
  }
}

/** Saves the choice on this device. A failed save still applies it until the app restarts. */
export function saveAppearance(preference: AppearancePreference): void {
  try {
    SecureStore.setItem(KEY, preference);
  } catch (caught) {
    if (__DEV__) {
      console.warn('Saving the appearance failed', caught);
    }
  }
}

/** Points native UI (keyboard, sheets, alerts) at the same scheme as the app. */
export function applyAppearance(preference: AppearancePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}
