import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';

import type { Placement } from './placement';

/** Placeholder rows in the shape of the list while it loads (no spinner). */
export function SkeletonRows({ count = 5 }: { count?: number }): ReactElement {
  const styles = useStyles();

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
  const styles = useStyles();

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
  const styles = useStyles();

  return (
    <View style={styles.box}>
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
}

/**
 * Shown over data still on screen when a refetch failed: "Couldn't refresh {subject}. Showing
 * what was last loaded." With `onRetry` it's a 44-point button that adds "Tap to try again.";
 * without it, plain text, for a screen that refetches on its own. `style` only places it.
 *
 * @example
 * <RefetchNotice subject="your plans" onRetry={() => void intents.refetch()} />
 */
export function RefetchNotice({
  subject,
  onRetry,
  style,
}: {
  subject: string;
  onRetry?: () => void;
  style?: Placement;
}): ReactElement {
  const styles = useStyles();
  const text = `Couldn't refresh ${subject}. Showing what was last loaded.`;

  if (!onRetry) {
    return (
      <View style={style}>
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {text}
        </Text>
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.noticeButton, style]}>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>
        {text} Tap to try again.
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  noticeButton: { minHeight: 44, justifyContent: 'center' },
  notice: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
}));
