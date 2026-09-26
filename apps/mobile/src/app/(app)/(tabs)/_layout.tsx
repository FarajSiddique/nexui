import { Tabs } from 'expo-router/js-tabs';
import type { ReactElement } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusTabButton, TAB_BAR_HEIGHT, TabIcon } from '@/components/tab-bar-items';
import { colors, fonts } from '@/lib/theme';

// Home · Tasks · (+) · Calendar · Notes. The order and the + button never move.
export default function TabsLayout(): ReactElement {
  const insets = useSafeAreaInsets();

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
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="home" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="tasks" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="plus" options={{ title: 'New', tabBarButton: () => <PlusTabButton /> }} />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="calendar" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notes',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="notes" focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
