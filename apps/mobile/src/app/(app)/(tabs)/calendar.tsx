import type { ReactElement } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionBanner } from '@/components/connection-banner';
import { ListEmpty } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { colors } from '@/lib/theme';

// Placeholder until the week strip and agenda arrive (anchored-shell.md, slice C).
export default function CalendarScreen(): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <TabHeader title="Calendar" />
        <ConnectionBanner />
        <ListEmpty text="Your week will show here soon. Events you add with + are saved in the meantime." />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
});
