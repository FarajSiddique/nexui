import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { mediaPlaceIds, usePlaceAbout, usePlacePhotos } from '#data';
import { createThemedStyles } from '#theme';
import { Button, ListEmpty } from '#ui';
import type { DetailProps } from '#features/workspace';

import { PlaceSheet } from './place-sheet';
import { stopDetails } from './stop-details';
import { placeName } from './travel-format';
import { daysAction } from './trip-actions';
import { rememberDays, useEditMemoryStore } from './use-edit-memory-store';

/**
 * A route stop in the object sheet (spec section 5): its photo and Wikipedia introduction from
 * the plan's media query, and its days through the route's own capability, remembered for "was
 * 4". Next stop swaps the sheet to the next stop; Find a stay asks Nexui.
 */
export function PlaceBody({ object, snapshot, onAction, onDone }: DetailProps): ReactElement {
  const styles = useStyles();
  const intentId = snapshot.intent.id;
  const placeIds = useMemo(() => mediaPlaceIds(snapshot), [snapshot]);
  const about = usePlaceAbout(intentId, placeIds, object.id);
  const photo = usePlacePhotos(intentId, placeIds)[object.id] ?? null;
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const details = stopDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gone}>
        <ListEmpty text="This stop is no longer on your route." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const setDays = (days: number): void => {
    const action = daysAction(details.place, days);

    if (!action) {
      return;
    }

    rememberDays(details.place.id, details.data.days, days);
    onAction(action);
  };

  return (
    <PlaceSheet
      details={details}
      about={about}
      photo={photo}
      was={wasDays[details.place.id]}
      onDone={onDone}
      onDays={setDays}
      onNext={(placeId) => onAction({ type: 'open', objectId: placeId })}
      onFindStay={() =>
        onAction({ type: 'ask', prompt: `Find a stay in ${placeName(details.place)}` })
      }
      onOpenLink={(url) => onAction({ type: 'link', url })}
    />
  );
}

const useStyles = createThemedStyles(() => ({
  gone: { gap: 12 },
}));
