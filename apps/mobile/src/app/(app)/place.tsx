import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import type { IntentMedia } from '@nexui/types';

import { mediaPlaceIds, useIntent, usePlaceMedia, useUndo, useWorkspaceEdit } from '#data';
import { placeName } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { Button, ListEmpty, ListError, SkeletonRows } from '#ui';
import { PlaceSheet, type AboutState } from '#features/place';
import {
  UndoToast,
  capabilityFor,
  daysAction,
  optimisticOps,
  rememberDays,
  stopDetails,
  useEditMemoryStore,
} from '#features/workspace';

// What About shows for one place: its introduction, a placeholder while the lookup runs or the
// answer loads, or nothing (no article, a failed lookup, or the request failed).
function aboutState(media: IntentMedia | undefined, placeId: string, loading: boolean): AboutState {
  const entry = media?.places[placeId];

  if (entry?.status === 'ready') {
    return entry.about;
  }

  if (entry?.status === 'pending' || loading) {
    return 'pending';
  }

  return null;
}

/**
 * A route stop's details, opened from its row on the workspace (spec section 5). It reads the
 * plan from the workspace's cache and the place's Wikipedia details from the media query. Day
 * changes go through the same capability, optimistic op and Undo as the route; Next stop
 * swaps in the next stop's details.
 */
export default function PlaceScreen(): ReactElement {
  const styles = useStyles();
  const { intentId, placeId } = useLocalSearchParams<{ intentId: string; placeId: string }>();
  const intent = useIntent(intentId);
  const snapshot = intent.data;
  const placeIds = useMemo(() => (snapshot ? mediaPlaceIds(snapshot) : []), [snapshot]);
  const media = usePlaceMedia(intentId, placeIds);
  const edit = useWorkspaceEdit(intentId);
  const undo = useUndo();
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const scroll = useRef<ScrollView>(null);
  const details = snapshot ? stopDetails(snapshot, placeId) : null;

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [placeId]);

  const setDays = (days: number): void => {
    const action = details ? daysAction(details.place, days) : null;

    if (!details || !snapshot || !action) {
      return;
    }

    const request = capabilityFor(action, snapshot);

    if (!request) {
      return;
    }

    rememberDays(details.place.id, details.data.days, days);
    edit.mutate(
      { request, optimistic: optimisticOps(action, snapshot) },
      { onSuccess: (result) => setUndoable(result.event.id) },
    );
  };

  const findStay = (): void => {
    if (!details) {
      return;
    }

    router.dismiss();
    router.push({
      pathname: '/compose',
      params: { intentId, prompt: `Find a stay in ${placeName(details.place)}` },
    });
  };

  const renderBody = (): ReactElement => {
    if (intent.isPending) {
      return <SkeletonRows count={4} />;
    }

    if (intent.isLoadingError) {
      return <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />;
    }

    if (!details) {
      return (
        <View style={styles.gone}>
          <ListEmpty text="This stop is no longer on your route." />
          <Button label="Done" onPress={() => router.back()} />
        </View>
      );
    }

    return (
      <PlaceSheet
        details={details}
        about={aboutState(media.data, details.place.id, media.isPending || media.isPlaceholderData)}
        was={wasDays[details.place.id]}
        onDone={() => router.back()}
        onDays={setDays}
        onNext={(next) => router.setParams({ placeId: next })}
        onFindStay={findStay}
        onReadMore={(url) => void Linking.openURL(url).catch(() => undefined)}
      />
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}>
        {edit.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t save that. {edit.error.message}
          </Text>
        ) : null}
        {undo.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t undo that. {undo.error.message}
          </Text>
        ) : null}
        {renderBody()}
      </ScrollView>
      {undoable ? (
        <UndoToast
          key={undoable}
          onDismiss={hideUndo}
          onUndo={() => {
            undo.mutate(undoable);
            setUndoable(null);
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.card },
  scroll: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 },
  gone: { gap: 12 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
