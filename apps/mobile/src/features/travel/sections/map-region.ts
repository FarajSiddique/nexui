/** The region react-native-maps shows. */
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Point {
  lat: number;
  lng: number;
}

/** The smallest span shown, in degrees (about 45 km), so one stop isn't zoomed to a street. */
export const MIN_MAP_DELTA = 0.4;

const PADDING = 1.5;

function extent(values: readonly number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(MIN_MAP_DELTA, value));

/**
 * A region that fits every point with some padding. Longitudes are also tried shifted into
 * 0…360, so a trip across the date line (Fiji → Samoa) is framed the short way round.
 *
 * @example
 * fitRegion([{ lat: 35.68, lng: 139.69 }, { lat: 35.01, lng: 135.77 }])
 */
export function fitRegion(points: readonly Point[]): Region | null {
  if (points.length === 0) {
    return null;
  }

  const lat = extent(points.map((point) => point.lat));
  const direct = extent(points.map((point) => point.lng));
  const shifted = extent(points.map((point) => (point.lng < 0 ? point.lng + 360 : point.lng)));
  const lng = shifted.max - shifted.min < direct.max - direct.min ? shifted : direct;
  const center = (lng.min + lng.max) / 2;

  return {
    latitude: (lat.min + lat.max) / 2,
    longitude: center > 180 ? center - 360 : center,
    latitudeDelta: clamp((lat.max - lat.min) * PADDING, 170),
    longitudeDelta: clamp((lng.max - lng.min) * PADDING, 360),
  };
}
