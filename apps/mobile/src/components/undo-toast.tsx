import { useEffect, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/**
 * "Saved" with Undo, for five seconds after an edit. Pass a stable `onDismiss` and key the
 * toast by the event, so each edit restarts the timer.
 */
export function UndoToast({
  onUndo,
  onDismiss,
  message = 'Saved',
}: {
  onUndo: () => void;
  onDismiss: () => void;
  message?: string;
}): ReactElement {
  const styles = useStyles();

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5_000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <View accessibilityLiveRegion="polite" style={styles.toast}>
      <Text style={styles.text}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo that change"
        onPress={onUndo}
        style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
      >
        <Text style={styles.undoText}>Undo</Text>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    borderRadius: 14,
    backgroundColor: colors.userMark,
  },
  text: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.card },
  undo: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  undoText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.card,
    textDecorationLine: 'underline',
  },
  pressed: { opacity: 0.7 },
}));
