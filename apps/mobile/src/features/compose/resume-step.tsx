import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { TemplateIntake } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

/**
 * The step after a goal whose plan reads a document first (job search spec, section 4): what
 * Nexui is planning, why it asks, then Add or Continue without; either starts the plan. Closing
 * the sheet here leaves the plan on Home as Ready to start.
 */
export function ResumeStep({
  intake,
  reading,
  busy,
  onAdd,
  onSkip,
}: {
  intake: TemplateIntake;
  /** The file is being read: 10 to 20 seconds. */
  reading: boolean;
  /** A start is in flight, with a file or without. */
  busy: boolean;
  onAdd: () => void;
  onSkip: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <View style={styles.tagRow}>
        <NexuiTag />
        <Text style={styles.planning}>{intake.planning}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {intake.title}
      </Text>
      <Text style={styles.body}>{intake.detail}</Text>
      {reading ? (
        <Text accessibilityLiveRegion="polite" style={styles.reading}>
          {intake.reading}
        </Text>
      ) : null}
      <Button label={intake.add} variant="primary" busy={reading} disabled={busy} onPress={onAdd} />
      <Button label={intake.skip} busy={busy && !reading} disabled={busy} onPress={onSkip} />
      <Text style={styles.note}>{intake.note}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planning: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.faint },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  reading: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
}));
