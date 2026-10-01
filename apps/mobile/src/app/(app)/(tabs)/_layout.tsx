import { Tabs } from 'expo-router/js-tabs';
import type { ReactElement } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusTabButton, TAB_BAR_HEIGHT, TabIcon } from '@/components/tab-bar-items';
import { fonts } from '@/lib/theme';
import { useColors } from '@/lib/use-theme';

// Home · (+) · Changes. The order and the + button never move.
export default function TabsLayout(): ReactElement {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.paper },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarShowLabel: true,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11, marginTop: 2 },
        tabBarItemStyle: { paddingTop: 2 },
        tabBarStyle: {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          backgroundColor: colors.card,
          borderTopWidth: 0,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          elevation: 0,
          shadowOpacity: 0,
        },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen name="plus" options={{ title: 'New', tabBarButton: () => <PlusTabButton /> }} />
      <Tabs.Screen
        name="changes"
        options={{
          title: 'Changes',
          tabBarIcon: ({ color }) => <TabIcon name="changes" color={color} />,
        }}
      />
    </Tabs>
  );
}
