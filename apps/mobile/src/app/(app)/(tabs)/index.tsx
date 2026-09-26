import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionBanner } from '@/components/connection-banner';
import { ListEmpty } from '@/components/list-states';
import { HeaderButton, TabHeader } from '@/components/tab-header';
import { colors, fonts } from '@/lib/theme';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

// Placeholder until the Home zones arrive (anchored-shell.md, slice D). The gear opens Account.
export default function HomeScreen(): ReactElement {
  const today = new Date().toLocaleDateString('en-GB', DATE_FORMAT);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <Text style={styles.date}>{today}</Text>
        <TabHeader
          title="Home"
          tools={
            <HeaderButton label="Account" onPress={() => router.push('/account')}>
              <GearGlyph />
            </HeaderButton>
          }
        />
        <ConnectionBanner />
        <ListEmpty text="Your day will show here soon. Tap + to add a task, event or note." />
      </ScrollView>
    </SafeAreaView>
  );
}

// A gear drawn with views: a ring over four crossed bars.
function GearGlyph(): ReactElement {
  return (
    <View style={styles.gear}>
      {[0, 45, 90, 135].map((angle) => (
        <View key={angle} style={[styles.tooth, { transform: [{ rotate: `${angle}deg` }] }]} />
      ))}
      <View style={styles.ring} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
  date: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  gear: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  tooth: {
    position: 'absolute',
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.ink,
  },
  ring: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: colors.ink,
    backgroundColor: colors.card,
  },
});
