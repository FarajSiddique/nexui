import { router, usePathname } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import type { ShellTab } from '@/lib/compose-context';
import { colors } from '@/lib/theme';

/** The tab bar's height above the bottom safe area. */
export const TAB_BAR_HEIGHT = 64;

export type TabIconName = 'home' | 'tasks' | 'calendar' | 'notes';

const PATH_TABS: Record<string, ShellTab> = {
  '/': 'home',
  '/tasks': 'tasks',
  '/calendar': 'calendar',
  '/notes': 'notes',
};

// Line icons drawn with views (the app ships no icon font), on a 22-point grid.
function Glyph({ name, color }: { name: TabIconName; color: ColorValue }): ReactElement {
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
    case 'tasks':
      return (
        <View style={styles.glyph}>
          <View style={[styles.box, stroke]}>
            <View style={[styles.tick, stroke]} />
          </View>
        </View>
      );
    case 'calendar':
      return (
        <View style={styles.glyph}>
          <View style={[styles.calendar, stroke]}>
            <View style={[styles.calendarBar, fill]} />
          </View>
        </View>
      );
    case 'notes':
      return (
        <View style={styles.glyph}>
          <View style={[styles.page, stroke]}>
            <View style={[styles.pageLine, fill]} />
            <View style={[styles.pageLine, styles.pageLineShort, fill]} />
          </View>
        </View>
      );
  }
}

/** A tab's icon; the active tab sits on a 46×30 yellow pill. */
export function TabIcon({
  name,
  focused,
  color,
}: {
  name: TabIconName;
  focused: boolean;
  color: ColorValue;
}): ReactElement {
  return (
    <View style={[styles.pill, focused && styles.pillActive]}>
      <Glyph name={name} color={color} />
    </View>
  );
}

/**
 * The + in the middle of the tab bar. It opens the compose sheet over the current tab and
 * never switches tabs.
 */
export function PlusTabButton(): ReactElement {
  const pathname = usePathname();

  return (
    <View style={styles.plusSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New task, event or note"
        onPress={() =>
          router.push({ pathname: '/compose', params: { from: PATH_TABS[pathname] ?? 'home' } })
        }
        style={({ pressed }) => [styles.plus, pressed && styles.plusPressed]}
      >
        <View style={styles.plusBarWide} />
        <View style={styles.plusBarTall} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: 46,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.accent },
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
  box: {
    width: 17,
    height: 17,
    borderWidth: 2,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: 5,
    height: 9,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    marginTop: -2,
    transform: [{ rotate: '45deg' }],
  },
  calendar: { width: 17, height: 16, borderWidth: 2, borderRadius: 4, overflow: 'hidden' },
  calendarBar: { height: 3 },
  page: {
    width: 15,
    height: 18,
    borderWidth: 2,
    borderRadius: 3,
    paddingHorizontal: 2,
    paddingTop: 5,
    gap: 3,
  },
  pageLine: { height: 2, borderRadius: 1 },
  pageLineShort: { width: 4 },
  plusSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plus: {
    width: 56,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusPressed: { opacity: 0.8 },
  plusBarWide: {
    position: 'absolute',
    width: 18,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.card,
  },
  plusBarTall: {
    position: 'absolute',
    width: 2.5,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.card,
  },
});
