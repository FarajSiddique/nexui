import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/**
 * A row that swipes left to show a Delete button, the way iOS Mail does; tapping it calls
 * `onDelete`, and tapping the row while it's open closes it; turning `enabled` off closes it too.
 * The button is hidden from screen readers, so the row's own content should offer a Delete
 * accessibility action instead.
 *
 * @example
 * <SwipeToDelete enabled={!drafting} onDelete={remove} onOpen={closeOthers}>
 *   <IntentCard item={item} onPress={open} onDelete={remove} />
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
  const content = useRef<View>(null);
  const dragged = useRef(false);
  const open = useRef(false);
  const pressedOpen = useRef(false);

  // A row turned off while open (its plan started Drafting) closes rather than staying stuck.
  useEffect(() => {
    if (!enabled) {
      row.current?.close();
    }
  }, [enabled]);

  // On web a Pressable's onPress comes from the browser's click, which a mouse swipe ends with
  // too, and the swipeable's guard for an open row (`pointerEvents: 'box-only'`) doesn't apply.
  // So a click on the row's content after a drag is stopped, and one on an open row closes it
  // instead of opening the plan. Whether the row was open is read at pointerdown, since the
  // swipeable's own tap starts closing it before the click arrives. On native the swipe gesture
  // and that guard handle both.
  useEffect(() => {
    const node = content.current as unknown as HTMLElement | null;

    if (Platform.OS !== 'web' || !node) {
      return;
    }

    const reset = (): void => {
      dragged.current = false;
      pressedOpen.current = open.current;
    };
    const swallow = (event: MouseEvent): void => {
      if (!dragged.current && !pressedOpen.current) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();

      if (!dragged.current) {
        row.current?.close();
      }
    };

    node.addEventListener('pointerdown', reset, true);
    node.addEventListener('click', swallow, true);

    return () => {
      node.removeEventListener('pointerdown', reset, true);
      node.removeEventListener('click', swallow, true);
    };
  }, []);

  const markDragged = (): void => {
    dragged.current = true;
  };

  return (
    <ReanimatedSwipeable
      ref={row}
      enabled={enabled}
      friction={2}
      overshootRight={false}
      onSwipeableOpenStartDrag={markDragged}
      onSwipeableCloseStartDrag={markDragged}
      onSwipeableWillOpen={() => {
        open.current = true;

        if (row.current) {
          onOpen?.(row.current);
        }
      }}
      onSwipeableWillClose={() => {
        open.current = false;
      }}
      renderRightActions={() => (
        <View aria-hidden style={styles.actions}>
          <Pressable
            tabIndex={-1}
            onPress={onDelete}
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
          >
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
      <View ref={content}>{children}</View>
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
