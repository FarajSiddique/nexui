import type { ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { fonts, createThemedStyles, useColors } from '#theme';

/** A summary badge: attention (accent), ok, running (with a spinner), or quiet (plain). */
export function Pill({
  text,
  tone,
}: {
  text: string;
  tone: 'attention' | 'ok' | 'running' | 'quiet';
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();

  return (
    <View style={[styles.pill, tone === 'attention' && styles.attention]}>
      {tone === 'running' ? <ActivityIndicator size="small" color={colors.ink} /> : null}
      <Text
        style={[
          styles.text,
          tone === 'attention' && styles.attentionText,
          tone === 'ok' && styles.okText,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.soft,
  },
  attention: { backgroundColor: colors.accent },
  text: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
  attentionText: { color: colors.accentInk },
  okText: { color: colors.success },
}));
