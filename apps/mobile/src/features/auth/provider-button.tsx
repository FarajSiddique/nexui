import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { createThemedStyles, fonts, useColors, useScheme } from '#theme';

type Provider = 'apple' | 'google';

// The brands' official logo files; Metro picks the @2x or @3x file for the screen.
const appleLogoBlack: ImageSourcePropType = require('./assets/apple-logo-black.png');
const appleLogoWhite: ImageSourcePropType = require('./assets/apple-logo-white.png');
const googleLogo: ImageSourcePropType = require('./assets/google-logo.png');

const LABELS: Record<Provider, string> = {
  apple: 'Continue with Apple',
  google: 'Continue with Google',
};

// Apple's rules: the logo file (here its large, 39 × 44 version, sized to sit beside Google's G)
// is as tall as the button, and the title is 43% of the button's height.
const HEIGHT = 52;
const LOGO_SLOT = (HEIGHT * 39) / 44;

/**
 * "Continue with Apple" or "Continue with Google", drawn the same way for both so they match: a
 * pill in the brands' white (light) or black (dark), the official logo on the left, the title
 * centered. While `busy`, it shows a spinner; while `disabled`, it dims but stays visible.
 *
 * @example
 * <ProviderButton provider="apple" busy={pending === 'apple'} disabled={pending !== null} onPress={…} />
 */
export function ProviderButton({
  provider,
  onPress,
  busy = false,
  disabled = false,
}: {
  provider: Provider;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LABELS[provider]}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && !busy && styles.dimmed,
      ]}
    >
      <View style={styles.slot}>
        {provider === 'apple' ? (
          <Image
            source={scheme === 'dark' ? appleLogoWhite : appleLogoBlack}
            style={styles.appleLogo}
          />
        ) : (
          <Image source={googleLogo} style={styles.googleLogo} />
        )}
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.label}>
        {LABELS[provider]}
      </Text>
      <View style={styles.slot}>
        {busy ? <ActivityIndicator color={colors.providerInk} /> : null}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEIGHT,
    paddingHorizontal: 12,
    borderRadius: HEIGHT / 2,
    borderWidth: 1,
    borderColor: colors.providerLine,
    backgroundColor: colors.providerFill,
  },
  pressed: { opacity: 0.8 },
  dimmed: { opacity: 0.5 },
  slot: { width: LOGO_SLOT, alignItems: 'center', justifyContent: 'center' },
  appleLogo: { width: LOGO_SLOT, height: HEIGHT },
  googleLogo: { width: 22, height: 22 },
  label: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: Math.round(HEIGHT * 0.43),
    color: colors.providerInk,
  },
}));
