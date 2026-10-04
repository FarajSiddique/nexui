import type { Scheme } from './theme';

/** The Appearance choice in Account: match the phone (`system`), or always light or dark. */
export type AppearancePreference = 'system' | Scheme;

/**
 * Reads a saved choice; anything missing or unknown means match the phone.
 *
 * @example parseAppearance('dark') // 'dark'
 * @example parseAppearance(null) // 'system'
 */
export function parseAppearance(saved: string | null | undefined): AppearancePreference {
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/**
 * The scheme to draw with. Matching the phone counts anything but dark as light.
 *
 * @example resolveScheme('system', 'dark') // 'dark'
 * @example resolveScheme('light', 'dark') // 'light'
 */
export function resolveScheme(
  preference: AppearancePreference,
  system: string | null | undefined,
): Scheme {
  if (preference !== 'system') {
    return preference;
  }

  return system === 'dark' ? 'dark' : 'light';
}
