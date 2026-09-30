import type { GraphSnapshot, TripData } from '@nexui/types';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { Pill } from '@/components/pill';
import { SectionView } from '@/components/sections/registry';
import { UndoToast } from '@/components/undo-toast';
import { ApiError } from '@/lib/api-request';
import { tripMeta } from '@/lib/format';
import { useIntent, useIntents, useUndo, useWorkspaceEdit } from '@/lib/queries';
import { layoutWorkspace } from '@/lib/sections';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';
import { useIntentLive } from '@/lib/use-intent-live';
import { capabilityFor, optimisticOps, type WorkspaceAction } from '@/lib/workspace-actions';
import { focusIntent } from '@/stores/use-focused-intent-store';

function anchorMeta(snapshot: GraphSnapshot): string {
  const anchorId = snapshot.workspace?.doc.anchorId;
  const anchor = snapshot.objects.find((object) => object.id === anchorId);

  return anchor?.kind === 'trip' ? tripMeta(anchor.data as Partial<TripData>) : '';
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
 */
export default function WorkspaceScreen(): ReactElement {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const intent = useIntent(id);
  const drafting =
    useIntents().data?.find((item) => item.id === id)?.summary.badge?.tone === 'running';
  const edit = useWorkspaceEdit(id);
  const undo = useUndo();
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);

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

    if (intent.isError) {
      return intent.error instanceof ApiError && intent.error.status === 404 ? (
        <ListEmpty text="This plan no longer exists." />
      ) : (
        <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />
      );
    }

    const data = intent.data;
    const meta = anchorMeta(data);

    return (
      <View style={styles.page}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {data.intent.goal}
          </Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {drafting ? <Pill text="Drafting" tone="running" /> : null}
        </View>
        {edit.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t save that. {edit.error.message}
          </Text>
        ) : null}
        {data.workspace ? null : (
          <ListEmpty text={data.intent.summary.line || 'Nexui can plan trips so far.'} />
        )}
        {blocks.map((block) =>
          block.kind === 'open' ? (
            <View key="open" style={styles.open} accessibilityLabel="Needs your attention">
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
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
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
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  open: { gap: 12 },
}));
