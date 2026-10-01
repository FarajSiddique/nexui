import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, View, type ColorValue } from 'react-native';

import { createThemedStyles } from '@/lib/use-theme';
import { useFocusedIntentStore } from '@/stores/use-focused-intent-store';

/** The tab bar's height above the bottom safe area. */
export const TAB_BAR_HEIGHT = 64;

export type TabIconName = 'home' | 'changes';

// Line icons drawn with views (the app ships no icon font), on a 22-point grid.
function Glyph({ name, color }: { name: TabIconName; color: ColorValue }): ReactElement {
  const styles = useStyles();
  const stroke = { borderColor: color };
  const fill = { backgroundColor: color };

  switch (name) {
    case 'home':
      return (
        <View style={styles.glyph}>
          <View style={[styles.roof, stroke]} />
          <View style={[styles.house, stroke]}>
            <View style={[styles.door, fill]} />
          </View>
        </View>
      );
    case 'changes':
      return (
        <View style={styles.glyph}>
          <View style={[styles.clock, stroke]}>
            <View style={[styles.clockHour, fill]} />
            <View style={[styles.clockMinute, fill]} />
          </View>
        </View>
      );
  }
}

/** A tab's icon; the active tab is shown by its tint and bold label. */
export function TabIcon({ name, color }: { name: TabIconName; color: ColorValue }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.iconSlot}>
      <Glyph name={name} color={color} />
    </View>
  );
}

/**
 * The + in the middle of the tab bar. Inside a workspace it opens the + sheet on that plan;
 * anywhere else it starts a new plan.
 */
export function PlusTabButton(): ReactElement {
  const styles = useStyles();
  const intentId = useFocusedIntentStore((state) => state.intentId);

  return (
    <View style={styles.plusSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={intentId ? 'Ask about this plan' : 'Start a plan'}
        onPress={() =>
          router.push(intentId ? { pathname: '/compose', params: { intentId } } : '/compose')
        }
        style={({ pressed }) => [styles.plus, pressed && styles.plusPressed]}
      >
        <View style={styles.plusBarWide} />
        <View style={styles.plusBarTall} />
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  iconSlot: { width: 46, height: 30, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  roof: {
    position: 'absolute',
    top: 3,
    width: 12,
    height: 12,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
  house: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 10,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  door: { width: 4, height: 5, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  clock: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHour: { position: 'absolute', top: 3, width: 2, height: 6, borderRadius: 1 },
  clockMinute: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 5,
    height: 2,
    borderRadius: 1,
  },
  plusSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plus: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusPressed: { opacity: 0.8 },
  plusBarWide: {
    position: 'absolute',
    width: 18,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.accentInk,
  },
  plusBarTall: {
    position: 'absolute',
    width: 2.5,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.accentInk,
  },
}));
