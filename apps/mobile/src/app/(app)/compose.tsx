import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/buttons';
import { RunCard } from '@/components/run-card';
import {
  isRunActive,
  useAsk,
  useCancelRun,
  useCreateIntent,
  useIntent,
  useRun,
} from '@/lib/queries';
import { fonts } from '@/lib/theme';
import { createThemedStyles, useColors } from '@/lib/use-theme';
import { useIntentLive } from '@/lib/use-intent-live';

interface Sent {
  text: string;
  runId: string | null;
}

/**
 * The + sheet. Opened on a workspace it asks about that plan; opened anywhere else it starts a
 * new plan, then keeps acting on it. The run streams in as a card, and closing the sheet
 * doesn't stop it.
 */
export default function ComposeSheet(): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ intentId?: string; prompt?: string }>();
  const [target, setTarget] = useState<string | null>(params.intentId ?? null);
  const [text, setText] = useState(params.prompt ?? '');
  const [sent, setSent] = useState<Sent | null>(null);
  const context = useIntent(target);
  const run = useRun(sent?.runId ?? null);
  const create = useCreateIntent();
  const ask = useAsk();
  const cancel = useCancelRun();

  useIntentLive(target);

  const working = isRunActive(run.data) || create.isPending || ask.isPending;
  const canSend = text.trim().length >= (target ? 2 : 3) && !working;
  const error = create.error ?? ask.error ?? cancel.error;
  const goal = context.data?.intent.goal;

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
        setTarget(result.snapshot.intent.id);
        setSent({ text: trimmed, runId: result.runId });
        setText('');
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.sheet}
    >
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
        {sent && sent.runId === null ? (
          <Text style={styles.note}>Nexui can plan trips so far. Your plan is saved on Home.</Text>
        ) : null}
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
        {sent && !params.intentId ? (
          <Button label="Open plan" variant="primary" onPress={openPlan} />
        ) : null}
      </ScrollView>
      <View style={styles.composer}>
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
            placeholder={target ? 'Ask anything or change this plan' : 'A week in Portugal in May'}
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
    </KeyboardAvoidingView>
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
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
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
