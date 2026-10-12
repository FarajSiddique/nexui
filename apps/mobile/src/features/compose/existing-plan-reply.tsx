import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { TemplateExample } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button, NexuiTag } from '#ui';

/**
 * The answer to a second plan of a kind a user keeps one of at a time (job search spec, section
 * 8): it offers the plan already going, and Open puts the goal back in the composer to add to it.
 * With no `example` (the sheet couldn't learn the plan's template) it names no kind.
 */
export function ExistingPlanReply({
  example,
  onOpen,
}: {
  example: TemplateExample | null;
  onOpen: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <NexuiTag />
      <Text accessibilityRole="header" style={styles.title}>
        You already have {example ? example.one : 'a plan like this'}. Add this to it?
      </Text>
      <Button
        label={example ? `Open my ${example.short}` : 'Open my plan'}
        variant="primary"
        onPress={onOpen}
      />
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
    backgroundColor: colors.card,
  },
  title: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, color: colors.ink },
}));
