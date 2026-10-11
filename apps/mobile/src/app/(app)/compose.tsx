import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { intakeRoute, TEMPLATE_EXAMPLES, TEMPLATE_INTAKES } from '@nexui/types';

import {
  choosePdf,
  isRunActive,
  useAsk,
  useCancelRun,
  useCreateIntent,
  useIntent,
  useIntents,
  useReplaceResume,
  useRun,
  useIntentLive,
  useStartPlan,
  type PickedPdf,
} from '#data';
import { fonts, createThemedStyles, useColors } from '#theme';
import { Button } from '#ui';
import {
  ExistingPlanReply,
  ResumeStep,
  RunCard,
  SavedGoalReply,
  afterAsk,
  nextGoalPlaceholder,
  replyFor,
  targetOf,
  useKeyboardOverlap,
  type Reply,
} from '#features/compose';
import { revealOpenBand } from '#features/workspace';

interface Sent {
  /** What the user typed; empty when they only sent a file. */
  text: string;
  /** The PDF sent with it, by name. */
  file: string | null;
  reply: Reply;
}

/**
 * The + sheet. Opened on a workspace it asks about that plan; opened anywhere else it starts a
 * new plan, then keeps acting on it. A trip's run streams in as a card; a job search first asks
 * for its resume (spec section 4), and a second job search offers the first. On a plan that takes
 * a document, the PDF button adds or replaces it. Closing the sheet doesn't stop a run. After an
 * ask about the plan underneath, it offers See the choice (when Nexui proposed one) or Back to
 * plan.
 */
export default function ComposeSheet(): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ intentId?: string; prompt?: string }>();
  const [target, setTarget] = useState<string | null>(params.intentId ?? null);
  const [text, setText] = useState(params.prompt ?? '');
  const [sent, setSent] = useState<Sent | null>(null);
  const [goalPlaceholder] = useState(() => (params.intentId ? '' : nextGoalPlaceholder()));
  const context = useIntent(target);
  const run = useRun(sent?.reply.type === 'run' ? sent.reply.runId : null);
  const create = useCreateIntent();
  const ask = useAsk();
  const cancel = useCancelRun();
  const intents = useIntents();
  const start = useStartPlan();
  const replace = useReplaceResume();
  const [notice, setNotice] = useState<string | null>(null);
  const keyboardOverlap = useKeyboardOverlap();
  const inputRef = useRef<TextInput>(null);

  // A plan open underneath keeps its own Realtime channel, so the sheet only listens for a plan
  // it started.
  useIntentLive(params.intentId ? null : target);

  const plan = context.data?.intent;
  // Home's list is almost always cached, so a second search's reply needn't wait on its plan.
  const template =
    intents.data?.find((item) => item.id === target)?.template ?? plan?.template ?? null;
  const intake = template ? TEMPLATE_INTAKES[template] : null;
  const example = template ? TEMPLATE_EXAMPLES[template] : null;
  const reading = replace.isPending || (start.isPending && Boolean(start.variables?.pdf));
  const working =
    isRunActive(run.data) ||
    create.isPending ||
    ask.isPending ||
    start.isPending ||
    replace.isPending;
  const canSend = text.trim().length >= (target ? 2 : 3) && !working;
  const canAttach = intake !== null && sent?.reply.type !== 'resume' && !working;
  const error = create.error ?? ask.error ?? cancel.error ?? start.error ?? replace.error;
  const goal = plan?.goal;
  const next = params.intentId ? afterAsk(run.data) : null;

  // A "Try one" example only fills the composer; focusing it shows the text landed.
  const tryExample = (exampleGoal: string): void => {
    setText(exampleGoal);
    inputRef.current?.focus();
  };

  const send = (message: string): void => {
    const trimmed = message.trim();

    setNotice(null);

    if (target) {
      ask.mutate(
        { intentId: target, text: trimmed },
        {
          onSuccess: (result) => {
            setSent({
              text: trimmed,
              file: null,
              reply: { type: 'run', runId: result.runId, restart: false },
            });
            setText('');
          },
        },
      );

      return;
    }

    create.mutate(trimmed, {
      onSuccess: (result) => {
        setText('');
        setTarget(targetOf(result));
        setSent({ text: trimmed, file: null, reply: replyFor(result) });
      },
    });
  };

  // Starts the plan waiting for its document, with the file or without, then streams its build.
  // A failed build starts again the same way (job search PR 2, Decision 20).
  const startPlan = (pdf: PickedPdf | null): void => {
    if (!target) {
      return;
    }

    start.mutate(
      { intentId: target, pdf },
      {
        onSuccess: (result) => {
          setSent((current) => ({
            text: current?.text ?? '',
            file: pdf?.name ?? current?.file ?? null,
            reply: { type: 'run', runId: result.runId, restart: true },
          }));

          if (result.intake === 'unreadable' && intake) {
            setNotice(intake.unreadable);
          }
        },
      },
    );
  };

  // Picks a PDF and sends it where the plan's intake takes it (spec section 4).
  const attach = async (): Promise<void> => {
    if (!plan) {
      return;
    }

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

      if (intakeRoute(plan) === 'resume') {
        replace.mutate(
          { intentId: plan.id, pdf: choice.pdf },
          { onSuccess: () => setNotice('Replaced your resume.') },
        );

        return;
      }

      startPlan(choice.pdf);
    } catch {
      setNotice("Couldn't open your files. Try again.");
    }
  };

  // Open my search: the goal goes back in the composer, to send to the plan already going.
  const openExisting = (): void => {
    setText(sent?.text ?? '');
    setSent(null);
    inputRef.current?.focus();
  };

  const retry = (current: Sent): void => {
    if (current.reply.type === 'run' && current.reply.restart) {
      startPlan(null);

      return;
    }

    send(current.text);
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
        {sent?.text ? <Text style={styles.bubble}>{sent.text}</Text> : null}
        {sent?.file ? <Text style={styles.file}>{sent.file} · PDF</Text> : null}
        {sent?.reply.type === 'saved' ? <SavedGoalReply onTry={tryExample} /> : null}
        {sent?.reply.type === 'resume' && intake ? (
          <ResumeStep
            intake={intake}
            reading={reading}
            busy={start.isPending}
            onAdd={() => void attach()}
            onSkip={() => startPlan(null)}
          />
        ) : null}
        {sent?.reply.type === 'existing' ? (
          <ExistingPlanReply example={example} onOpen={openExisting} />
        ) : null}
        {sent?.reply.type === 'run' ? (
          <RunCard
            run={run.data}
            stopping={cancel.isPending}
            onStop={(runId) => cancel.mutate(runId)}
            onRetry={() => retry(sent)}
            retrying={ask.isPending || create.isPending || start.isPending}
            onSeeChanges={seeChanges}
          />
        ) : null}
        {sent?.reply.type === 'run' && target && !params.intentId ? (
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
        {reading && sent?.reply.type !== 'resume' && intake ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {intake.reading}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error.message}
          </Text>
        ) : null}
        <View style={styles.inputRow}>
          {canAttach && intake ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={intake.add}
              onPress={() => void attach()}
              style={styles.attach}
            >
              <Text style={styles.attachText}>PDF</Text>
            </Pressable>
          ) : null}
          <TextInput
            ref={inputRef}
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
  file: {
    alignSelf: 'flex-end',
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.muted,
  },
  notice: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  attach: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  attachText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
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
