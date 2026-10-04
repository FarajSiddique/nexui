import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';

/** A section's card. `accent` marks something waiting on the user; `tentative` a proposal. */
export function SectionFrame({
  title,
  children,
  tentative = false,
  accent = false,
  padded = true,
}: {
  title?: string;
  children: ReactNode;
  tentative?: boolean;
  accent?: boolean;
  padded?: boolean;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        tentative && styles.tentative,
        accent && styles.accent,
      ]}
    >
      {title ? (
        <Text accessibilityRole="header" style={[styles.title, !padded && styles.titleInset]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden' },
  padded: { padding: 16, gap: 12 },
  tentative: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line },
  accent: { borderLeftWidth: 4, borderLeftColor: colors.accent },
  title: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  titleInset: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
}));
