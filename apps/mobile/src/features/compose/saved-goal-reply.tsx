import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

import { GOAL_EXAMPLES, plansToday } from './goal-examples';

/**
 * The + sheet's answer to a goal no template fits (job search spec, section 2): Nexui saved it,
 * says what it plans today, and offers each template's example goal. Choosing one puts it in
 * the composer to edit or send; it starts a new plan, since a saved goal opens none.
 */
export function SavedGoalReply({ onTry }: { onTry: (goal: string) => void }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.reply}>
      <View style={styles.card}>
        <NexuiTag />
        <Text accessibilityRole="header" style={styles.title}>
          Nexui can&apos;t plan this yet.
        </Text>
        <Text style={styles.body}>
          It&apos;s saved, and you&apos;ll hear when it can. {plansToday(GOAL_EXAMPLES)}
        </Text>
        <Text style={styles.label}>Try one</Text>
        {GOAL_EXAMPLES.map((example) => (
          <Button
            key={example.goal}
            label={example.goal}
            accessibilityLabel={`Try: ${example.goal}`}
            onPress={() => onTry(example.goal)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        No plan was created. Saved goals help decide what Nexui learns next.
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  reply: { gap: 8 },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  label: { marginTop: 4, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.faint },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
}));
