import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

/** A job search sheet's top line: what it is, and Done, which stays in view (spec section 6). */
export function SheetHeader({
  kicker,
  onDone,
}: {
  kicker: string;
  onDone: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <Text numberOfLines={1} style={styles.kicker}>
        {kicker}
      </Text>
      <Button label="Done" onPress={onDone} />
    </View>
  );
}

/** One titled part of a sheet. */
export function SheetSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kicker: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  section: { gap: 8, paddingTop: 22 },
  title: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.ink },
}));
