import type { ReactElement } from 'react';

import type { SectionProps } from '#features/workspace';

import { MapFallback } from './map-fallback';

// react-native-maps has no web build; the web preview shows the route as a list.
export function MapSection({ section, data }: SectionProps<'map'>): ReactElement {
  return <MapFallback title={section.title} pins={data.pins} />;
}
