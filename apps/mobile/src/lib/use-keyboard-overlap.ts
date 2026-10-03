import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Keyboard, LayoutAnimation, Platform, View } from 'react-native';

import { keyboardOverlap } from './keyboard-overlap';

// A short ease for the correction measured after the keyboard has settled.
const KEYBOARD_SETTLE_MS = 120;

interface KeyboardOverlap {
  onLayout: () => void;
  overlap: number;
}

function animateWithKeyboard(duration: number): void {
  if (duration > 0) {
    LayoutAnimation.configureNext({
      duration,
      update: { duration, type: LayoutAnimation.Types.keyboard },
    });
  }
}

/**
 * Bottom padding that keeps a view's content above the iOS keyboard. Pass the view's ref, attach
 * `onLayout` to it and pad it by `overlap`. The view is measured in the window, so this works inside
 * a form sheet, which iOS moves and grows while the keyboard is up. Android and web get 0.
 */
export function useKeyboardOverlap(
  ref: RefObject<ComponentRef<typeof View> | null>,
): KeyboardOverlap {
  const keyboardTop = useRef<number | null>(null);
  const applied = useRef(0);
  const [overlap, setOverlap] = useState(0);

  // Animates only a real change, so a no-op measurement can't leave an animation configured
  // for some unrelated layout.
  const apply = useCallback((next: number, duration: number) => {
    if (next === applied.current) {
      return;
    }

    applied.current = next;
    animateWithKeyboard(duration);
    setOverlap(next);
  }, []);

  const measure = useCallback(
    (duration: number) => {
      ref.current?.measureInWindow((_x, y, _width, height) => {
        apply(keyboardOverlap({ y, height }, keyboardTop.current), duration);
      });
    },
    [ref, apply],
  );

  const onLayout = useCallback(() => {
    measure(0);
  }, [measure]);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    // keyboardWillChangeFrame also fires on show, so there's no keyboardWillShow listener.
    // keyboardDidShow measures again once iOS has finished moving and growing the sheet.
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', (event) => {
        keyboardTop.current = event.endCoordinates.screenY;
        measure(event.duration);
      }),
      Keyboard.addListener('keyboardDidShow', () => {
        measure(KEYBOARD_SETTLE_MS);
      }),
      Keyboard.addListener('keyboardWillHide', (event) => {
        keyboardTop.current = null;
        apply(0, event.duration);
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [measure, apply]);

  return { onLayout, overlap };
}
