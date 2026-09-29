import type { ReactElement } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListEmpty } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { createThemedStyles } from '@/lib/use-theme';

// Placeholder until the Changes feed arrives (intent graph plan 3).
export default function ChangesScreen(): ReactElement {
  const styles = useStyles();

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <TabHeader title="Changes" />
        <ListEmpty text="Every change you or Nexui make will show here, with Undo." />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
}));
