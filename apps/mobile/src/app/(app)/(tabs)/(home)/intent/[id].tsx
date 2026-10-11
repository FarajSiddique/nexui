import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { anchorMeta } from '@nexui/types';

import {
  ApiError,
  mediaPlaceIds,
  queryKeys,
  useIntent,
  useIntents,
  usePlacePhotos,
  useUndo,
  useWorkspaceEdit,
  useIntentLive,
} from '#data';
import { fonts, createThemedStyles } from '#theme';
import { ListEmpty, ListError, RefetchNotice, SkeletonRows, Pill } from '#ui';
import {
  UndoToast,
  focusIntent,
  useRevealOpenBand,
  type WorkspaceAction,
  layoutWorkspace,
} from '#features/workspace';
import { SectionView, hasDetail } from '#features/registry';

function goBack(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

/**
 * One intent's workspace: the goal, its meta line, then the doc's sections drawn by their
 * primitives, with unresolved pinned sections in the Open band. Primitives report actions;
 * this screen turns them into capability calls (shown at once, undoable) or opens + for asks.
 * The + sheet's See the choice scrolls the Open band into view once the workspace is focused
 * again and laid out, never while the sheet still covers it.
 */
export default function WorkspaceScreen(): ReactElement {
  const styles = useStyles();
  const client = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const drafting =
    useIntents().data?.find((item) => item.id === id)?.summary.badge?.tone === 'running';
  const intent = useIntent(id, { poll: drafting });
  const edit = useWorkspaceEdit(id);
  const undo = useUndo();
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const wasDrafting = useRef(drafting);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (wasDrafting.current && !drafting) {
      void client.invalidateQueries({ queryKey: queryKeys.intent(id) });
      void client.invalidateQueries({ queryKey: queryKeys.changes });
    }

    wasDrafting.current = drafting;
  }, [drafting, client, id]);

  useIntentLive(id);
  useFocusEffect(
    useCallback(() => {
      focusIntent(id);

      return () => focusIntent(null);
    }, [id]),
  );

  const snapshot = intent.data;
  const blocks = useMemo(
    () => (snapshot?.workspace ? layoutWorkspace(snapshot.workspace.doc, snapshot) : []),
    [snapshot],
  );
  const placeIds = useMemo(() => (snapshot ? mediaPlaceIds(snapshot) : []), [snapshot]);

  // Looks the plan's places up as soon as it's open, so stops show their photos and a stop's
  // sheet opens with its details.
  const photos = usePlacePhotos(id, placeIds);

  const hasOpenBand = blocks.some((block) => block.kind === 'open');
  const band = useRevealOpenBand(scroll, {
    intentId: id,
    hasOpenBand,
    settled: intent.isSuccess && !intent.isFetching,
  });

  const handleAction = (action: WorkspaceAction): void => {
    switch (action.type) {
      case 'open':
        router.push({ pathname: '/object', params: { intentId: id, objectId: action.objectId } });

        return;
      case 'ask':
        router.push({
          pathname: '/compose',
          params: action.prompt ? { intentId: id, prompt: action.prompt } : { intentId: id },
        });

        return;
      case 'capability':
        edit.mutate(
          { request: action.request, optimistic: action.optimistic },
          { onSuccess: (result) => setUndoable(result.event.id) },
        );

        return;
      case 'link':
        void Linking.openURL(action.url).catch(() => undefined);
    }
  };

  const renderBody = (): ReactElement => {
    if (intent.isPending) {
      return <SkeletonRows count={4} />;
    }

    if (intent.isLoadingError) {
      return intent.error instanceof ApiError && intent.error.status === 404 ? (
        <ListEmpty text="This plan no longer exists." />
      ) : (
        <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />
      );
    }

    const data = intent.data;
    const meta = anchorMeta(data);

    return (
      <View style={styles.page} onLayout={band.onPageLayout}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {data.intent.goal}
          </Text>
          {meta && hasDetail(meta.kind) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${meta.text}. Show details`}
              onPress={() => handleAction({ type: 'open', objectId: meta.objectId })}
              style={({ pressed }) => [styles.metaButton, pressed && styles.pressed]}
            >
              <Text style={styles.meta}>{meta.text} ›</Text>
            </Pressable>
          ) : null}
          {meta && !hasDetail(meta.kind) ? <Text style={styles.meta}>{meta.text}</Text> : null}
          {drafting ? <Pill text="Drafting" tone="running" /> : null}
        </View>
        {intent.isRefetchError ? (
          <RefetchNotice subject="this plan" onRetry={() => void intent.refetch()} />
        ) : null}
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
        {data.workspace ? null : (
          <ListEmpty text={data.intent.summary.line || "Nexui can't plan this yet."} />
        )}
        {blocks.map((block) =>
          block.kind === 'open' ? (
            <View key="open" style={styles.open} onLayout={band.onBandLayout}>
              {block.entries.map((entry) => (
                <SectionView
                  key={entry.section.id}
                  entry={entry}
                  snapshot={data}
                  onAction={handleAction}
                  busy={edit.isPending}
                  photos={photos}
                />
              ))}
            </View>
          ) : (
            <SectionView
              key={block.entry.section.id}
              entry={block.entry}
              snapshot={data}
              onAction={handleAction}
              busy={edit.isPending}
              photos={photos}
            />
          ),
        )}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Back to plans"
          hitSlop={8}
          onPress={goBack}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Plans</Text>
        </Pressable>
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
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 },
  back: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  backText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.muted },
  page: { gap: 12 },
  header: { gap: 6, marginBottom: 4 },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  meta: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  metaButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  open: { gap: 12 },
}));
