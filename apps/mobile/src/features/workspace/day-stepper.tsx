import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDays } from '#lib';
import { fonts, createThemedStyles } from '#theme';

import { MAX_PLACE_DAYS } from './workspace-actions';

/** What the stepper sits on: a card (soft buttons) or a soft panel (card buttons). */
type Surface = 'card' | 'soft';

/** A 36-point square button with one glyph; its hit area reaches 44 points. */
export function SmallButton({
  glyph,
  label,
  disabled,
  onPress,
  surface = 'card',
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  surface?: Surface;
}): ReactElement {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        surface === 'soft' && styles.smallOnSoft,
        pressed && styles.pressed,
        disabled && styles.dimmed,
      ]}
    >
      <Text style={styles.smallGlyph}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * − days +, adjustable for screen readers, with "was 4" once this session has changed it. The
 * route and the stop sheet share it.
 */
export function DayStepper({
  name,
  days,
  was,
  onDays,
  surface = 'card',
}: {
  name: string;
  days: number;
  was: number | undefined;
  onDays: (days: number) => void;
  surface?: Surface;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Days in ${name}`}
      accessibilityValue={{ text: formatDays(days) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onDays(event.nativeEvent.actionName === 'increment' ? days + 1 : days - 1)
      }
      style={styles.stepper}
    >
      <SmallButton
        glyph="−"
        label={`One day less in ${name}`}
        disabled={days <= 0}
        onPress={() => onDays(days - 1)}
        surface={surface}
      />
      <View style={styles.dayValue}>
        <Text style={styles.days}>{formatDays(days)}</Text>
        {was !== undefined && was !== days ? <Text style={styles.was}>was {was}</Text> : null}
      </View>
      <SmallButton
        glyph="+"
        label={`One more day in ${name}`}
        disabled={days >= MAX_PLACE_DAYS}
        onPress={() => onDays(days + 1)}
        surface={surface}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayValue: { minWidth: 56, alignItems: 'center' },
  days: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  was: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.faint,
    textDecorationLine: 'line-through',
  },
  small: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  smallOnSoft: { backgroundColor: colors.card },
  smallGlyph: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.4 },
}));
