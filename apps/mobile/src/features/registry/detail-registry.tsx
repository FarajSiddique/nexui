import type { ComponentType, ReactElement } from 'react';
import { View } from 'react-native';

import { isKindName, type KindName } from '@nexui/types';

import { createThemedStyles } from '#theme';
import { Button, ListEmpty } from '#ui';
import { DraftBody, RoleBody, SearchBody } from '#features/jobs';
import { PlaceBody } from '#features/travel';
import type { DetailProps } from '#features/workspace';

/**
 * Each kind's details body (job search spec, section 6), as `SECTION_REGISTRY` picks primitives.
 * A kind without one doesn't open. A new template adds its bodies here, one line each.
 */
export const DETAIL_REGISTRY: { [K in KindName]?: ComponentType<DetailProps> } = {
  place: PlaceBody,
  opportunity: RoleBody,
  document: DraftBody,
  search: SearchBody,
};

/** True when a kind has a details body, so a row or the meta line may open it. */
export function hasDetail(kind: string): boolean {
  return isKindName(kind) && DETAIL_REGISTRY[kind] !== undefined;
}

/** One object's details, drawn by its kind's body, or a note that there's nothing more. */
export function DetailView(props: DetailProps): ReactElement {
  const styles = useStyles();
  const Body = isKindName(props.object.kind) ? DETAIL_REGISTRY[props.object.kind] : undefined;

  if (!Body) {
    return (
      <View style={styles.none}>
        <ListEmpty text="There's nothing more to show for this." />
        <Button label="Done" onPress={props.onDone} />
      </View>
    );
  }

  return <Body {...props} />;
}

const useStyles = createThemedStyles(() => ({
  none: { gap: 12 },
}));
