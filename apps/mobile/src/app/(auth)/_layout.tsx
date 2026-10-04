import { Stack } from 'expo-router';

import { useColors } from '#theme';

// Always open the group on sign-in so verify has a screen to go back to.
export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const colors = useColors();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="verify" />
    </Stack>
  );
}
