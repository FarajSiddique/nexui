import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/lib/theme';

/** Placeholder rows in the shape of the list while it loads (no spinner). */
export function SkeletonRows({ count = 5 }: { count?: number }): ReactElement {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={styles.skeleton}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonCheck} />
          <View style={styles.skeletonLines}>
            <View style={[styles.skeletonLine, { width: `${70 - (index % 3) * 12}%` }]} />
            <View style={[styles.skeletonLine, styles.skeletonMeta]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** What failed, and a way to try again. */
export function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onRetry}
      style={({ pressed }) => [styles.box, pressed && styles.pressed]}
    >
      <Text accessibilityLiveRegion="polite" style={styles.error}>
        {message} Tap to try again.
      </Text>
    </Pressable>
  );
}

/** An empty list's invitation. */
export function ListEmpty({ text }: { text: string }): ReactElement {
  return (
    <View style={styles.box}>
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { marginTop: 8 },
  skeletonRow: { flexDirection: 'row', gap: 14, paddingVertical: 14 },
  skeletonCheck: { width: 24, height: 24, borderRadius: 8, backgroundColor: colors.line },
  skeletonLines: { flex: 1, gap: 8, paddingTop: 2 },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: colors.line },
  skeletonMeta: { width: '35%', height: 10 },
  box: {
    marginTop: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
  },
  pressed: { opacity: 0.7 },
  error: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.danger },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
});
