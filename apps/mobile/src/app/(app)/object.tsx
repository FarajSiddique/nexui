import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { useIntent, useUndo, useWorkspaceEdit } from '#data';
import { fonts, createThemedStyles } from '#theme';
import { Button, ListEmpty, ListError, SkeletonRows } from '#ui';
import { DetailView } from '#features/registry';
import { UndoToast, type WorkspaceAction } from '#features/workspace';

// Closes the sheet onto its plan. A sheet opened from a link or a reload on web has no history
// to go back to, so it opens the plan instead.
function close(intentId: string): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace({ pathname: '/intent/[id]', params: { id: intentId } });
  }
}

/**
 * One object's details (job search spec, section 6): a stop, a role, a draft or the search, the
 * body `DETAIL_REGISTRY` picks by kind. It reads the plan from the workspace's cache. Bodies
 * report actions: edits go through the same capability, optimistic ops and Undo as the
 * workspace; `open` swaps the body in place (Next stop, a role's draft); an ask closes the sheet
 * onto + with the prompt filled in.
 */
export default function ObjectScreen(): ReactElement {
  const styles = useStyles();
  const { intentId, objectId } = useLocalSearchParams<{ intentId: string; objectId: string }>();
  const intent = useIntent(intentId);
  const edit = useWorkspaceEdit(intentId);
  const undo = useUndo();
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const scroll = useRef<ScrollView>(null);
  const object = intent.data?.objects.find((candidate) => candidate.id === objectId);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [objectId]);

  const handleAction = (action: WorkspaceAction): void => {
    switch (action.type) {
      case 'open':
        router.setParams({ objectId: action.objectId });

        return;
      case 'ask':
        router.dismiss();
        router.push({ pathname: '/compose', params: { intentId, prompt: action.prompt } });

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
      return <ListError message={intent.error.message} onRetry={() => void intent.refetch()} />;
    }

    if (!object) {
      return (
        <View style={styles.gone}>
          <ListEmpty text="This is no longer in your plan." />
          <Button label="Done" onPress={() => close(intentId)} />
        </View>
      );
    }

    return (
      <DetailView
        object={object}
        snapshot={intent.data}
        onAction={handleAction}
        onDone={() => close(intentId)}
        busy={edit.isPending}
      />
    );
  };

  return (
    <View collapsable={false} style={styles.screen}>
      {/* As in the + sheet: with the collapsable root, this empty first child stops
          react-native-screens resizing the ScrollView, which leaves an iOS form sheet blank
          (docs/architecture/mobile.md). */}
      <View collapsable={false} />
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
  // The place body's photo bleeds through this padding.
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 },
  gone: { gap: 12 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
