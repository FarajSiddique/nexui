import type { MapStyleElement } from 'react-native-maps';

import type { Palette } from '#theme';

/** Android's dark map, drawn with the theme's tokens. iOS follows `userInterfaceStyle`. */
export function darkMapStyle(colors: Palette): MapStyleElement[] {
  return [
    { elementType: 'geometry', stylers: [{ color: colors.mapLand }] },
    { elementType: 'labels.text.fill', stylers: [{ color: colors.muted }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: colors.paper }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.mapSea }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.line }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ];
}
