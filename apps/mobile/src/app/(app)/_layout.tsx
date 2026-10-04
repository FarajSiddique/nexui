import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform, View } from 'react-native';

import { createThemedStyles, useColors } from '#theme';

// The signed-in shell: the tabs, the + sheet and Account.
export default function AppLayout(): ReactElement {
  const styles = useStyles();
  const colors = useColors();

  // The + sheet rises over everything, tab bar included. iOS gets a tall form sheet (the run
  // streams into it); Android and web get a modal, which keeps the keyboard behavior predictable.
  const composeOptions =
    Platform.OS === 'ios'
      ? ({
          presentation: 'formSheet',
          sheetAllowedDetents: [0.92] as number[],
          sheetGrabberVisible: true,
          sheetCornerRadius: 26,
          contentStyle: { backgroundColor: colors.card },
        } as const)
      : ({ presentation: 'modal', contentStyle: { backgroundColor: colors.card } } as const);

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

const useStyles = createThemedStyles((colors) => ({
  shell: { flex: 1, backgroundColor: colors.paper },
}));
