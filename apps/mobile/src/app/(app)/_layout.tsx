import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

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

// The signed-in shell: the tabs, the + sheet and Account.
export default function AppLayout(): ReactElement {
  return (
    <View style={styles.shell}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={composeOptions} />
        <Stack.Screen name="account" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.paper },
});
