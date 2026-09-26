import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  isChangeAction,
  isChangeIntent,
  type ChangeAction,
  type IntentAction,
  type IntentDecision,
  type ItemKind,
} from '@nexui/types';
import { useRef, useState, type ReactElement } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChangeSheet } from '@/components/change-sheet';
import { DraftSheet } from '@/components/draft-sheet';
import { IntentPreview } from '@/components/intent-previews';
import { MagicBar } from '@/components/magic-bar';
import { ApiError, recordIntentEvent } from '@/lib/api';
import { undoMessage } from '@/lib/commit-label';
import {
  blankDraft,
  composeContextLine,
  currentTab,
  TAB_KINDS,
  type NavigationStateLike,
} from '@/lib/compose-context';
import { localToday } from '@/lib/form-values';
import { previewEmphasis } from '@/lib/intent-confidence';
import { submitStep } from '@/lib/submit-decision';
import { colors, fonts } from '@/lib/theme';
import { useIntentPrediction } from '@/lib/use-intent-prediction';
import { ITEMS_KEY, itemsKey } from '@/lib/use-timeline';
import { addRecentInput, useRecentInputs } from '@/stores/use-recent-inputs';
import { showUndo } from '@/stores/use-undo-store';

type Sheet =
  | { type: 'draft'; decision: IntentDecision; text: string }
  | { type: 'change'; decision: IntentDecision; action: ChangeAction; text: string };

interface Commit {
  decision: IntentDecision;
  action: IntentAction;
  text: string;
}

const BLANK_KINDS: readonly { kind: ItemKind; label: string }[] = [
  { kind: 'task', label: 'Task' },
  { kind: 'event', label: 'Event' },
  { kind: 'note', label: 'Note' },
];

// iOS shows the sheet as a form sheet sized to its content; elsewhere it is a full modal,
// so the chip row is pushed to the bottom, just above the keyboard.
const fitsContent = Platform.OS === 'ios';

// Closing keeps nothing: the bar, draft and any open form live only in this screen.
function closeSheet(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

/**
 * The + sheet: the Magic Bar and its draft. A clear draft saves at once with Undo; an
 * unclear one opens the form. With the bar empty it offers recent inputs and blank drafts.
 * Params: `text` prefills the bar, `from` names the tab it opened from.
 */
export default function ComposeScreen(): ReactElement {
  const params = useLocalSearchParams<{ text?: string; from?: string }>();
  const navigation = useNavigation();
  const [tab] = useState(() =>
    currentTab(navigation.getState() as NavigationStateLike | undefined, params.from),
  );
  const selectedDay = localToday();
  const { text, setText, decision, isPredicting, error, resolveNow } = useIntentPrediction(
    typeof params.text === 'string' ? params.text : '',
  );
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const recentInputs = useRecentInputs((state) => state.inputs);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const submitting = useRef(false);
  const commit = useMutation({
    mutationFn: ({ decision: logged, action, text: typed }: Commit) =>
      recordIntentEvent({
        text: typed,
        decision: logged,
        outcome: 'confirmed',
        action,
        via: 'instant',
      }),
    onSuccess: ({ eventId, item }, { action }) => {
      void queryClient.invalidateQueries({ queryKey: item ? itemsKey(item.kind) : ITEMS_KEY });
      showUndo(eventId, undoMessage(action));
      closeSheet();
    },
  });
  const requestError = commit.error instanceof ApiError ? commit.error.message : null;
  const commitError = commit.error
    ? (requestError ?? 'Could not save. Check your connection.')
    : null;

  function changeText(value: string) {
    // Only clear a failed commit's error; clearing `isPending` here would re-enable the
    // buttons and let a second Enter or tap fire while the first commit is in flight.
    if (commit.isError) {
      commit.reset();
    }

    setText(value);
  }

  function commitNow(action: IntentAction) {
    if (!decision || commit.isPending) {
      return;
    }

    addRecentInput(text);
    commit.mutate({ decision, action, text: text.trim() });
  }

  function review(forDecision: IntentDecision, action?: IntentAction) {
    Keyboard.dismiss();
    addRecentInput(text);

    if (isChangeIntent(forDecision.intent)) {
      const change = action ?? forDecision.action;

      if (change && isChangeAction(change)) {
        setSheet({ type: 'change', decision: forDecision, action: change, text: text.trim() });
      }

      return;
    }

    setSheet({ type: 'draft', decision: forDecision, text: text.trim() });
  }

  // A change that matched nothing becomes a new task draft, prefilled with the phrase.
  function createInstead(phrase: string) {
    if (!decision) {
      return;
    }

    const title = phrase.charAt(0).toUpperCase() + phrase.slice(1);

    Keyboard.dismiss();
    setSheet({
      type: 'draft',
      decision: {
        intent: 'CREATE_TASK',
        confidence: decision.confidence,
        entities: { title },
        action: { kind: 'CREATE_TASK', title, due: null, priority: 'normal' },
      },
      text: text.trim(),
    });
  }

  // A "Blank" chip opens the form with an empty draft of that kind, dated by the tab.
  function openBlank(kind: ItemKind) {
    Keyboard.dismiss();
    setSheet({ type: 'draft', decision: blankDraft(kind, tab, selectedDay), text: '' });
  }

  async function submitFromBar() {
    if (commit.isPending || submitting.current) {
      return;
    }

    submitting.current = true;

    const typed = text.trim();

    addRecentInput(typed);

    try {
      const ready = await resolveNow();
      const step = submitStep(ready);

      if (!ready?.action || step === 'ignore') {
        return;
      }

      if (step === 'commit') {
        commit.mutate({ decision: ready, action: ready.action, text: typed });

        return;
      }

      review(ready);
    } finally {
      submitting.current = false;
    }
  }

  // Only mark up the input when there is a draft on screen to explain.
  const shown = decision && previewEmphasis(decision) !== 'none' ? decision : null;
  const empty = text.trim() === '';
  const tabKind = TAB_KINDS[tab];

  return (
    <View
      style={[
        styles.sheet,
        !fitsContent && styles.fill,
        { paddingTop: fitsContent ? 20 : insets.top + 12 },
        { paddingBottom: fitsContent ? 16 : Math.max(insets.bottom, 12) },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.context}>{composeContextLine(tab, selectedDay)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
          onPress={closeSheet}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView
        style={fitsContent ? undefined : styles.fill}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <MagicBar
          autoFocus
          value={text}
          onChangeText={changeText}
          onSubmit={() => void submitFromBar()}
          highlights={shown?.highlights}
        />

        {isPredicting ? (
          <Text accessibilityLiveRegion="polite" style={styles.feedback}>
            Reading your plan…
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <IntentPreview
          decision={decision}
          busy={commit.isPending}
          error={commitError}
          onCommit={commitNow}
          onReview={(action) => {
            if (decision) {
              review(decision, action);
            }
          }}
          onCreateInstead={createInstead}
        />

        {empty && recentInputs.length > 0 ? (
          <View style={styles.recent}>
            <Text accessibilityRole="header" style={styles.recentHeading}>
              Recent
            </Text>
            {recentInputs.map((input) => (
              <Pressable
                key={input}
                accessibilityRole="button"
                accessibilityHint="Puts this back in the bar"
                onPress={() => changeText(input)}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={styles.recentText}>
                  {input}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {empty ? (
        <View style={styles.chips}>
          <Text style={styles.chipLead}>Blank</Text>
          {BLANK_KINDS.map(({ kind, label }) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={`New blank ${kind}`}
              onPress={() => openBlank(kind)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              {tabKind === kind ? <Text style={styles.chipPlus}>+</Text> : null}
              <Text style={styles.chipText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {sheet?.type === 'draft' ? (
        <DraftSheet
          decision={sheet.decision}
          text={sheet.text}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            closeSheet();
          }}
        />
      ) : null}
      {sheet?.type === 'change' ? (
        <ChangeSheet
          decision={sheet.decision}
          action={sheet.action}
          text={sheet.text}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            closeSheet();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.card, paddingHorizontal: 20 },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  context: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  cancel: { minHeight: 32, justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  pressed: { opacity: 0.7 },
  body: { paddingBottom: 12 },
  feedback: { fontFamily: fonts.body, color: colors.muted, fontSize: 14, marginTop: 14 },
  error: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  recent: { marginTop: 18 },
  recentHeading: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.faint,
    marginBottom: 4,
  },
  recentRow: { minHeight: 44, justifyContent: 'center' },
  recentText: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  chipLead: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.faint, marginRight: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.soft,
  },
  chipPlus: { fontFamily: fonts.heading, fontSize: 16, color: colors.ink },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
});
