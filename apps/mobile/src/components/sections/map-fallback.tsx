import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AiText } from '@/components/ai-text';
import type { MapPin } from '@/lib/sections';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

import { SectionFrame } from './section-frame';

/** The route as an ordered list, where no native map is available (web, Android without a key). */
export function MapFallback({ title, pins }: { title?: string; pins: MapPin[] }): ReactElement {
  const styles = useStyles();

  return (
    <SectionFrame title={title}>
      <View style={styles.sea} accessibilityLabel="Route stops in order">
        {pins.length === 0 ? (
          <Text style={styles.empty}>The map fills in as places are added.</Text>
        ) : (
          pins.map((pin) => (
            <View key={pin.id} style={styles.row}>
              <View style={styles.pin}>
                <Text style={styles.pinText}>{pin.order}</Text>
              </View>
              <AiText text={pin.label} highlight={pin.ai} tag={false} style={styles.label} />
            </View>
          ))
        )}
      </View>
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  sea: { gap: 6, padding: 10, borderRadius: 14, backgroundColor: colors.mapSea },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.mapLand,
  },
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mapPin,
  },
  pinText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.mapPinInk },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
}));
