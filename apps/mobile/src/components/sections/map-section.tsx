import Constants from 'expo-constants';
import { useMemo, type ReactElement } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { fitRegion } from '@/lib/map-region';
import { fonts } from '@/lib/theme';
import { createThemedStyles, useColors, useScheme } from '@/lib/use-theme';

import { MapFallback } from './map-fallback';
import { darkMapStyle } from './map-style';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

// Android draws Google Maps, which needs a key at build time (app.config.ts).
const nativeMapAvailable =
  Platform.OS !== 'android' || Constants.expoConfig?.extra?.mapsOnAndroid === true;

/**
 * A fixed-height postcard of the route: framed to fit its places, numbered pins, the route
 * line in stop order, and no gestures (spec section I).
 */
export function MapSection({ section, data }: SectionProps<'map'>): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const region = useMemo(() => fitRegion(data.pins), [data.pins]);
  const androidStyle = useMemo(
    () => (Platform.OS === 'android' && scheme === 'dark' ? darkMapStyle(colors) : undefined),
    [colors, scheme],
  );

  if (!nativeMapAvailable) {
    return <MapFallback title={section.title} pins={data.pins} />;
  }

  if (!region) {
    return (
      <SectionFrame title={section.title}>
        <Text style={styles.empty}>The map fills in as places are added.</Text>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame title={section.title} padded={false}>
      <MapView
        accessible
        accessibilityLabel={`Map of the route: ${data.pins.map((pin) => pin.label).join(', ')}`}
        style={styles.map}
        region={region}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        userInterfaceStyle={scheme}
        customMapStyle={androidStyle}
      >
        {data.pins.length > 1 ? (
          <Polyline
            coordinates={data.pins.map((pin) => ({ latitude: pin.lat, longitude: pin.lng }))}
            strokeColor={colors.mapRoute}
            strokeWidth={3}
          />
        ) : null}
        {data.pins.map((pin) => (
          <Marker
            key={`${pin.id}-${pin.order}-${scheme}`}
            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            title={pin.label}
            tracksViewChanges={false}
          >
            <View style={styles.pin}>
              <Text style={styles.pinText}>{pin.order}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  map: { width: '100%', height: 164 },
  pin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.mapPinInk,
    backgroundColor: colors.mapPin,
  },
  pinText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.mapPinInk },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
}));
