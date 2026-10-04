import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform } from 'react-native';

function animateWithKeyboard(duration: number): void {
  if (duration > 0) {
    LayoutAnimation.configureNext({
      duration,
      update: { duration, type: LayoutAnimation.Types.keyboard },
    });
  }
}

/**
 * Bottom padding that keeps a view's content above the iOS keyboard, for a view that reaches the
 * bottom of the screen, like the + form sheet. The keyboard covers such a view by its whole
 * visible height, so nothing is measured: Fabric's `measureInWindow` reads the shadow tree, which
 * puts a form sheet at the top of the window wherever iOS draws it, so a measured overlap comes up
 * short by the sheet's offset. Android and web get 0.
 *
 * @example On an 874pt screen with the keyboard's top at 546, the overlap is 328.
 */
export function useKeyboardOverlap(): number {
  const applied = useRef(0);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    // Animates only a real change, so a repeated keyboard frame can't leave an animation
    // configured for some unrelated layout.
    const apply = (next: number, duration: number): void => {
      if (next === applied.current) {
        return;
      }

      applied.current = next;
      animateWithKeyboard(duration);
      setOverlap(next);
    };

    // keyboardWillChangeFrame also fires on show, so there's no keyboardWillShow listener.
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', (event) => {
        const windowHeight = Dimensions.get('window').height;

        apply(Math.max(windowHeight - event.endCoordinates.screenY, 0), event.duration);
      }),
      Keyboard.addListener('keyboardWillHide', (event) => {
        apply(0, event.duration);
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  return overlap;
}
