import { Stack, useSegments } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT } from '@/components/tab-bar-items';
import { UndoToast } from '@/components/undo-toast';
import { colors } from '@/lib/theme';

// The + sheet rises over everything, tab bar included. iOS gets a form sheet sized to its
// content; Android and web get a modal, which keeps the keyboard behavior predictable.
const composeOptions =
  Platform.OS === 'ios'
    ? ({
        presentation: 'formSheet',
        sheetAllowedDetents: 'fitToContents',
        sheetGrabberVisible: true,
        sheetCornerRadius: 26,
        contentStyle: { backgroundColor: colors.card },
      } as const)
    : ({ presentation: 'modal', contentStyle: { backgroundColor: colors.card } } as const);

// The signed-in shell: the tabs, the + sheet and Account, with the Undo card floating
// above the tab bar on every screen.
export default function AppLayout(): ReactElement {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const overTabs = (segments as readonly string[]).includes('(tabs)');
  const bottom = insets.bottom + (overTabs ? TAB_BAR_HEIGHT + 10 : 16);

  return (
    <View style={styles.shell}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={composeOptions} />
        <Stack.Screen name="account" />
      </Stack>
      <View style={[styles.toastHost, { bottom }]}>
        <View style={styles.toastWidth}>
          <UndoToast />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.paper },
  toastHost: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  toastWidth: { width: '100%', maxWidth: 456 },
});
