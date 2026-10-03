export interface WindowFrame {
  y: number;
  height: number;
}

/**
 * How far the keyboard covers a view, both measured in window coordinates. React Native's
 * KeyboardAvoidingView uses the view's frame within its parent instead, which is wrong inside
 * an iOS form sheet: the sheet doesn't start at the top of the window.
 *
 * @example keyboardOverlap({ y: 70, height: 804 }, 538) // 336
 */
export function keyboardOverlap(frame: WindowFrame, keyboardTop: number | null): number {
  if (keyboardTop === null) {
    return 0;
  }

  return Math.max(frame.y + frame.height - keyboardTop, 0);
}
