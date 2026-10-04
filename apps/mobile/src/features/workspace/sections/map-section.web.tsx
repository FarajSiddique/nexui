import type { ReactElement } from 'react';

import { MapFallback } from './map-fallback';
import type { SectionProps } from './types';

// react-native-maps has no web build; the web preview shows the route as a list.
export function MapSection({ section, data }: SectionProps<'map'>): ReactElement {
  return <MapFallback title={section.title} pins={data.pins} />;
}
