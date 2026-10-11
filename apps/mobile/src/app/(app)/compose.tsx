import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import {
  isRunActive,
  useAsk,
  useCancelRun,
  useCreateIntent,
  useIntent,
  useRun,
  useIntentLive,
} from '#data';
import { fonts, createThemedStyles, useColors } from '#theme';
import { Button } from '#ui';
import {
  RunCard,
  SavedGoalReply,
  afterAsk,
  nextGoalPlaceholder,
  useKeyboardOverlap,
} from '#features/compose';
import { revealOpenBand } from '#features/workspace';

interface Sent {
  text: string;
  /** The run working on it, or null for a goal Nexui saved because it can't plan it yet. */
  runId: string | null;
}

/**
 * The + sheet. Opened on a workspace it asks about that plan; opened anywhere else it starts a
 * new plan, then keeps acting on it. The run streams in as a card, and closing the sheet
 * doesn't stop it. After an ask about the plan underneath, it offers See the choice (when Nexui
 * proposed one) or Back to plan.
 */
export default function ComposeSheet(): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ intentId?: string; prompt?: string }>();
  const [target, setTarget] = useState<string | null>(params.intentId ?? null);
  const [text, setText] = useState(params.prompt ?? '');
  const [sent, setSent] = useState<Sent | null>(null);
  const [goalPlaceholder] = useState(nextGoalPlaceholder);
  const context = useIntent(target);
  const run = useRun(sent?.runId ?? null);
  const create = useCreateIntent();
  const ask = useAsk();
  const cancel = useCancelRun();
  const keyboardOverlap = useKeyboardOverlap();

  // A plan open underneath keeps its own Realtime channel, so the sheet only listens for a plan
  // it started.
  useIntentLive(params.intentId ? null : target);

  const working = isRunActive(run.data) || create.isPending || ask.isPending;
  const canSend = text.trim().length >= (target ? 2 : 3) && !working;
  const error = create.error ?? ask.error ?? cancel.error;
  const goal = context.data?.intent.goal;
  const next = params.intentId ? afterAsk(run.data) : null;

  const send = (message: string): void => {
    const trimmed = message.trim();

    if (target) {
      ask.mutate(
        { intentId: target, text: trimmed },
        {
          onSuccess: (result) => {
            setSent({ text: trimmed, runId: result.runId });
            setText('');
          },
        },
      );

      return;
    }

    create.mutate(trimmed, {
      onSuccess: (result) => {
        setText('');

        // A saved goal opens no plan, so the next send starts a new one.
        if (result.outcome === 'unsupported') {
          setSent({ text: trimmed, runId: null });

          return;
        }

        setTarget(result.snapshot.intent.id);
        setSent({ text: trimmed, runId: result.runId });
      },
    });
  };

  const openPlan = (): void => {
    if (!target) {
      return;
    }

    router.dismiss();
    router.push({ pathname: '/intent/[id]', params: { id: target } });
  };

  const seeChanges = (): void => {
    router.dismiss();
    router.navigate('/changes');
  };

  const seeChoice = (): void => {
    if (target) {
      revealOpenBand(target);
    }

    router.dismiss();
  };

  return (
    <View collapsable={false} style={[styles.sheet, { paddingBottom: keyboardOverlap }]}>
      {/* With the collapsable root, this empty first child stops react-native-screens from
          resizing the ScrollView under the composer (docs/architecture/mobile.md). */}
      <View collapsable={false} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.chip}>
          <Text style={styles.chipTitle}>{target ? (goal ?? 'This plan') : 'New plan'}</Text>
          <Text style={styles.chipDetail}>
            {target ? 'Asking about this plan' : 'Say what you’re trying to do'}
          </Text>
        </View>
        {sent ? <Text style={styles.bubble}>{sent.text}</Text> : null}
        {sent && sent.runId === null ? <SavedGoalReply onTry={setText} /> : null}
        {sent?.runId ? (
          <RunCard
            run={run.data}
            stopping={cancel.isPending}
            onStop={(runId) => cancel.mutate(runId)}
            onRetry={() => send(sent.text)}
            retrying={ask.isPending || create.isPending}
            onSeeChanges={seeChanges}
          />
        ) : null}
        {sent && target && !params.intentId ? (
          <Button label="Open plan" variant="primary" onPress={openPlan} />
        ) : null}
      </ScrollView>
      <View style={styles.composer}>
        {/* Above the input, so the next step stays in view while the keyboard is up. */}
        {next === 'choice' ? (
          <Button label="See the choice" variant="primary" onPress={seeChoice} />
        ) : null}
        {next === 'plan' ? (
          <Button label="Back to plan" variant="primary" onPress={() => router.dismiss()} />
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error.message}
          </Text>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel={target ? 'Ask about this plan' : 'Describe your plan'}
            autoFocus={!sent}
            multiline
            maxLength={target ? 1000 : 500}
            value={text}
            onChangeText={setText}
            placeholder={target ? 'Ask anything or change this plan' : goalPlaceholder}
            placeholderTextColor={colors.faint}
            selectionColor={colors.ink}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => send(text)}
            style={[styles.send, !canSend && styles.dimmed]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  sheet: { flex: 1, backgroundColor: colors.card },
  scroll: { flex: 1 },
  body: { gap: 12, padding: 20, paddingBottom: 24 },
  chip: { gap: 2, padding: 12, borderRadius: 14, backgroundColor: colors.soft },
  chipTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  chipDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
    overflow: 'hidden',
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.card,
    backgroundColor: colors.userMark,
  },
  composer: {
    gap: 6,
    padding: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sendText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.accentInk },
  dimmed: { opacity: 0.45 },
}));
