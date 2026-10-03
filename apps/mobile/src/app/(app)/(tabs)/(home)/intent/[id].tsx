import type { GraphSnapshot, TripData } from '@nexui/types';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutRectangle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { Pill } from '@/components/pill';
import { SectionView } from '@/components/sections/registry';
import { UndoToast } from '@/components/undo-toast';
import { ApiError } from '@/lib/api-request';
import { tripMeta } from '@/lib/format';
import { queryKeys, useIntent, useIntents, useUndo, useWorkspaceEdit } from '@/lib/queries';
import { layoutWorkspace } from '@/lib/sections';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';
import { useIntentLive } from '@/lib/use-intent-live';
import { capabilityFor, optimisticOps, type WorkspaceAction } from '@/lib/workspace-actions';
import { focusIntent } from '@/stores/use-focused-intent-store';
import { revealOpenBand, useRevealStore } from '@/stores/use-reveal-store';

function anchorMeta(snapshot: GraphSnapshot): string {
  const anchorId = snapshot.workspace?.doc.anchorId;
  const anchor = snapshot.objects.find((object) => object.id === anchorId);

  return anchor?.kind === 'trip' ? tripMeta(anchor.data as Partial<TripData>) : '';
}

/**
 * A view's top edge once it is laid out, else null. On Expo web the screen under the + sheet is
 * display:none and reports a 0-height layout at y 0; that is "not measured", not a position.
 */
function measuredY(layout: LayoutRectangle): number | null {
  return layout.height > 0 ? layout.y : null;
}

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
  const isFocused = useIsFocused();
  const [pageY, setPageY] = useState<number | null>(null);
  const [openY, setOpenY] = useState<number | null>(null);
  const reveal = useRevealStore((state) => state.intentId === id);

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
  const hasOpenBand = blocks.some((block) => block.kind === 'open');
  const bandTop = hasOpenBand && pageY !== null && openY !== null ? pageY + openY : null;

  // A band that unmounts leaves no position behind for the next one to be mistaken for.
  if (!hasOpenBand && openY !== null) {
    setOpenY(null);
  }

  // "See the choice" in the + sheet: once this screen is focused again, bring the Open band into
  // view when it's laid out, or give up when the loaded plan has nothing open (it was settled
  // meanwhile).
  useEffect(() => {
    if (!reveal || !isFocused) {
      return;
    }

    if (bandTop !== null) {
      scroll.current?.scrollTo({ y: Math.max(0, bandTop - 8), animated: true });
      revealOpenBand(null);
    } else if (!hasOpenBand && intent.isSuccess && !intent.isFetching) {
      revealOpenBand(null);
    }
  }, [reveal, isFocused, bandTop, hasOpenBand, intent.isSuccess, intent.isFetching]);

  const handleAction = (action: WorkspaceAction): void => {
    if (action.type === 'ask') {
      router.push({
        pathname: '/compose',
        params: action.prompt ? { intentId: id, prompt: action.prompt } : { intentId: id },
      });

      return;
    }

    if (!snapshot) {
      return;
    }

    const request = capabilityFor(action, snapshot);

    if (!request) {
      return;
    }

    edit.mutate(
      { request, optimistic: optimisticOps(action, snapshot) },
      { onSuccess: (result) => setUndoable(result.event.id) },
    );
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
      <View style={styles.page} onLayout={(event) => setPageY(measuredY(event.nativeEvent.layout))}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {data.intent.goal}
          </Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {drafting ? <Pill text="Drafting" tone="running" /> : null}
        </View>
        {intent.isRefetchError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void intent.refetch()}
            style={styles.notice}
          >
            <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
              {"Couldn't refresh this plan. Showing what was last loaded. Tap to try again."}
            </Text>
          </Pressable>
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
          <ListEmpty text={data.intent.summary.line || 'Nexui can plan trips so far.'} />
        )}
        {blocks.map((block) =>
          block.kind === 'open' ? (
            <View
              key="open"
              style={styles.open}
              onLayout={(event) => setOpenY(measuredY(event.nativeEvent.layout))}
            >
              {block.entries.map((entry) => (
                <SectionView
                  key={entry.section.id}
                  entry={entry}
                  snapshot={data}
                  onAction={handleAction}
                  busy={edit.isPending}
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
  notice: { minHeight: 44, justifyContent: 'center' },
  noticeText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  open: { gap: 12 },
}));
