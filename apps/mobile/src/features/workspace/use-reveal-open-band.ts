import { useIsFocused } from 'expo-router';
import { useEffect, useState, type RefObject } from 'react';
import type { LayoutChangeEvent, LayoutRectangle, ScrollView } from 'react-native';

import { revealOpenBand, useRevealStore } from './use-reveal-store';

/**
 * A view's top edge once it is laid out, else null. On Expo web the screen under the + sheet is
 * display:none and reports a 0-height layout at y 0; that is "not measured", not a position.
 */
function measuredY(layout: LayoutRectangle): number | null {
  return layout.height > 0 ? layout.y : null;
}

export interface OpenBandLayout {
  /** For the page view inside the ScrollView. */
  onPageLayout: (event: LayoutChangeEvent) => void;
  /** For the Open band's own view. */
  onBandLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Answers the + sheet's See the choice (`revealOpenBand(intentId)`): once this workspace is
 * focused again and its Open band is laid out, scrolls the band into view and clears the flag,
 * never while the sheet still covers the screen. When the loaded plan has nothing open (it was
 * settled meanwhile), it just clears the flag. `settled` means the intent loaded and isn't
 * refetching. The screen owns the ScrollView's ref.
 *
 * @example
 * const scroll = useRef<ScrollView>(null);
 * const band = useRevealOpenBand(scroll, { intentId: id, hasOpenBand, settled });
 * <ScrollView ref={scroll}>
 *   <View onLayout={band.onPageLayout}>… <View onLayout={band.onBandLayout} /></View>
 * </ScrollView>
 */
export function useRevealOpenBand(
  scrollRef: RefObject<ScrollView | null>,
  { intentId, hasOpenBand, settled }: { intentId: string; hasOpenBand: boolean; settled: boolean },
): OpenBandLayout {
  const isFocused = useIsFocused();
  const [pageY, setPageY] = useState<number | null>(null);
  const [openY, setOpenY] = useState<number | null>(null);
  const reveal = useRevealStore((state) => state.intentId === intentId);
  const bandTop = hasOpenBand && pageY !== null && openY !== null ? pageY + openY : null;

  // A band that unmounts leaves no position behind for the next one to be mistaken for.
  if (!hasOpenBand && openY !== null) {
    setOpenY(null);
  }

  useEffect(() => {
    if (!reveal || !isFocused) {
      return;
    }

    if (bandTop !== null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, bandTop - 8), animated: true });
      revealOpenBand(null);
    } else if (!hasOpenBand && settled) {
      revealOpenBand(null);
    }
  }, [reveal, isFocused, bandTop, hasOpenBand, settled, scrollRef]);

  return {
    onPageLayout: (event) => setPageY(measuredY(event.nativeEvent.layout)),
    onBandLayout: (event) => setOpenY(measuredY(event.nativeEvent.layout)),
  };
}
