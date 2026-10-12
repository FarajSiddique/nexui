import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { intakeRoute, TEMPLATE_INTAKES } from '@nexui/types';

import {
  choosePdf,
  useIntent,
  useReplaceResume,
  useStartPlan,
  useUndo,
  useWorkspaceEdit,
  type PickedPdf,
} from '#data';
import { openableUrl } from '#lib';
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
  const start = useStartPlan();
  const replace = useReplaceResume();
  const [notice, setNotice] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<string | null>(null);
  const hideUndo = useCallback(() => setUndoable(null), []);
  const scroll = useRef<ScrollView>(null);
  const object = intent.data?.objects.find((candidate) => candidate.id === objectId);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [objectId]);

  const busy = edit.isPending || start.isPending || replace.isPending;
  const snapshot = intent.data;
  const intake = snapshot?.intent.template ? TEMPLATE_INTAKES[snapshot.intent.template] : null;
  const reading =
    intake !== null && (replace.isPending || (start.isPending && Boolean(start.variables?.pdf)));

  // A picked PDF goes where the plan's intake takes it: `start` before its first run, `resume`
  // after (job search spec, section 4).
  const sendPdf = (pdf: PickedPdf): void => {
    if (!snapshot) {
      return;
    }

    if (intakeRoute(snapshot.intent) === 'resume') {
      replace.mutate(
        { intentId: intentId, pdf },
        { onSuccess: (result) => setUndoable(result.event.id) },
      );

      return;
    }

    start.mutate({ intentId: intentId, pdf });
  };

  const addFile = async (): Promise<void> => {
    setNotice(null);

    try {
      const choice = await choosePdf();

      if (!choice) {
        return;
      }

      if ('problem' in choice) {
        setNotice(choice.problem);

        return;
      }

      sendPdf(choice.pdf);
    } catch {
      setNotice("Couldn't open your files. Try again.");
    }
  };

  const copy = async (text: string): Promise<void> => {
    try {
      await Clipboard.setStringAsync(text);
      setNotice('Copied.');
    } catch {
      setNotice("Couldn't copy that.");
    }
  };

  // Only an https page or a mailto: message opens (`openableUrl`); anything else, or a link the
  // system can't open, says so.
  const openLink = async (url: string): Promise<void> => {
    const openable = openableUrl(url);

    setNotice(null);

    if (!openable) {
      setNotice("Couldn't open that link.");

      return;
    }

    try {
      await Linking.openURL(openable);
    } catch {
      setNotice("Couldn't open that link.");
    }
  };

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
      case 'upload':
        void addFile();

        return;
      case 'start':
        start.mutate({ intentId: intentId, pdf: null });

        return;
      case 'copy':
        void copy(action.text);

        return;
      case 'link':
        void openLink(action.url);
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
        busy={busy}
      />
    );
  };

  return (
    <View collapsable={false} style={styles.screen}>
      {/* As in the + sheet: with the collapsable root, this empty first child stops
          react-native-screens resizing the ScrollView, which leaves an iOS form sheet blank
          (docs/architecture/mobile.md). */}
      <View collapsable={false} />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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
        {reading ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {intake?.reading}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
        {start.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t start this plan. {start.error.message}
          </Text>
        ) : null}
        {replace.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            Couldn&apos;t add that resume. {replace.error.message}
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
  notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
