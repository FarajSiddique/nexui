import { useRef, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/**
 * A row that swipes left to show a Delete button, the way iOS Mail does; tapping it calls
 * `onDelete`, and tapping the row while it's open closes it. The button is hidden from screen
 * readers, so the row's own content should offer a Delete accessibility action instead.
 *
 * @example
 * <SwipeToDelete enabled={!drafting} onDelete={() => remove.mutate(item.id)} onOpen={closeOthers}>
 *   <IntentCard item={item} onPress={open} onDelete={() => remove.mutate(item.id)} />
 * </SwipeToDelete>
 */
export function SwipeToDelete({
  enabled,
  onDelete,
  onOpen,
  children,
}: {
  enabled: boolean;
  onDelete: () => void;
  /** Called as the row opens, so a list can close the row that was open before. */
  onOpen?: (row: SwipeableMethods) => void;
  children: ReactNode;
}): ReactElement {
  const styles = useStyles();
  const row = useRef<SwipeableMethods>(null);

  return (
    <ReanimatedSwipeable
      ref={row}
      enabled={enabled}
      friction={2}
      overshootRight={false}
      onSwipeableWillOpen={() => {
        if (row.current) {
          onOpen?.(row.current);
        }
      }}
      renderRightActions={() => (
        <View aria-hidden style={styles.actions}>
          <Pressable
            focusable={false}
            onPress={onDelete}
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
          >
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  actions: { width: 100, paddingLeft: 12 },
  delete: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.danger,
  },
  pressed: { opacity: 0.8 },
  deleteText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.card },
}));
