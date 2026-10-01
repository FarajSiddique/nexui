import type { IntentListItem } from '@nexui/types';
import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AiText } from '@/components/ai-text';
import { Pill } from '@/components/pill';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/** A plan on Home: its goal, badge, summary line and a mini route of its stops. */
export function IntentCard({
  item,
  onPress,
}: {
  item: IntentListItem;
  onPress: () => void;
}): ReactElement {
  const styles = useStyles();
  const { summary } = item;
  const strip = summary.strip ?? [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.goal, summary.badge?.text, summary.line].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Text style={styles.goal} numberOfLines={2}>
          {item.goal}
        </Text>
        {summary.badge ? <Pill text={summary.badge.text} tone={summary.badge.tone} /> : null}
      </View>
      {summary.line ? <Text style={styles.line}>{summary.line}</Text> : null}
      {strip.length > 0 ? (
        <View style={styles.strip}>
          {strip.map((stop, index) => (
            <Fragment key={`${stop.label}-${index}`}>
              {index > 0 ? <View style={styles.connector} /> : null}
              <AiText text={stop.label} highlight={stop.ai} tag={false} style={styles.stop} />
            </Fragment>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { gap: 8, padding: 16, borderRadius: 20, backgroundColor: colors.card },
  pressed: { opacity: 0.8 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  goal: { flex: 1, fontFamily: fonts.heading, fontSize: 18, lineHeight: 23, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  connector: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.line },
  stop: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
}));
