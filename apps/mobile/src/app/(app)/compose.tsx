import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

// Placeholder until the + sheet's composer arrives (intent graph plan 3).
export default function ComposeSheet(): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.sheet}>
      <Text accessibilityRole="header" style={styles.title}>
        What are you trying to do?
      </Text>
      <Text style={styles.body}>Starting a plan from here arrives in the next build.</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  sheet: { padding: 24, gap: 8, backgroundColor: colors.card },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
}));
