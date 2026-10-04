import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

import { useColors } from '#theme';

// Home and the workspaces pushed over it, under the tab bar (spec section B).
export default function HomeStackLayout(): ReactElement {
  const colors = useColors();

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
    />
  );
}
