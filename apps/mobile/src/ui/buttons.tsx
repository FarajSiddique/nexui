import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { fonts } from '@/theme/theme';
import { createThemedStyles, useColors } from '@/theme/use-theme';

import type { Placement } from './placement';

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'ink';

/**
 * A button at least 44 points tall: primary (accent), secondary (soft), text (underlined), or
 * ink (a 52-point ink pill for a form's or screen's main action). The variant owns the look;
 * `style` only places the button, such as its margins or `alignSelf`.
 *
 * @example
 * <Button variant="ink" label="Verify" busy={verifying} onPress={verify} style={styles.submit} />
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: Placement;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const inactive = disabled || busy;
  const spinnerColors: Record<ButtonVariant, string> = {
    primary: colors.accentInk,
    secondary: colors.ink,
    text: colors.ink,
    ink: colors.card,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        // A disabled ink button stays readable: it's the empty sign-in form's first sight.
        inactive && (variant === 'ink' ? styles.inkDimmed : styles.dimmed),
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={spinnerColors[variant]} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && styles.primaryLabel,
            variant === 'text' && styles.textLabel,
            variant === 'ink' && styles.inkLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  base: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.soft },
  text: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  ink: { backgroundColor: colors.ink, minHeight: 52, borderRadius: 999 },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.5 },
  inkDimmed: { opacity: 0.6 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  primaryLabel: { color: colors.accentInk },
  textLabel: { textDecorationLine: 'underline' },
  inkLabel: { fontSize: 16, color: colors.card },
}));
