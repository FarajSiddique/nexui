import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { fonts } from '@/theme/theme';
import { createThemedStyles, useColors } from '@/theme/use-theme';

/** A 44-point button: primary (accent), secondary (soft) or text (underlined). */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const inactive = disabled || busy;

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
        inactive && styles.dimmed,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.accentInk : colors.ink}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && styles.primaryLabel,
            variant === 'text' && styles.textLabel,
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
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.5 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  primaryLabel: { color: colors.accentInk },
  textLabel: { textDecorationLine: 'underline' },
}));
