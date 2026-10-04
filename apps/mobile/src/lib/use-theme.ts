import { StyleSheet, useColorScheme } from 'react-native';

import { useAppearanceStore } from '@/stores/use-appearance-store';

import { resolveScheme } from './appearance';
import { palettes, type Palette, type Scheme } from './theme';

/** The scheme to draw with: Light or Dark from Account, or the phone's under Match my phone. */
export function useScheme(): Scheme {
  const system = useColorScheme();
  const preference = useAppearanceStore((state) => state.preference);

  return resolveScheme(preference, system);
}

/** The token set for the current scheme, for colors passed as props. */
export function useColors(): Palette {
  return palettes[useScheme()];
}

/**
 * Builds a hook that returns styles for the current scheme, created once per scheme.
 *
 * @example
 * const useStyles = createThemedStyles((colors) => ({ screen: { backgroundColor: colors.paper } }));
 * function Screen() {
 *   const styles = useStyles();
 * }
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
): () => T {
  const cache: Partial<Record<Scheme, T>> = {};

  return function useThemedStyles(): T {
    const scheme = useScheme();
    const cached = cache[scheme];

    if (cached) {
      return cached;
    }

    const created = StyleSheet.create(factory(palettes[scheme]));

    cache[scheme] = created;

    return created;
  };
}
