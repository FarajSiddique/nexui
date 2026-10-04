import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';

const GLYPH = { user: 'You', ai: 'N', derived: '∑' } as const;
const NAME = { user: 'You', ai: 'Nexui', derived: 'Auto-calculated' } as const;
const TEXT_KEY = { user: 'userText', ai: 'aiText', derived: 'derivedText' } as const;

/** Who made a change: you, Nexui, or an automatic calculation. */
export function ActorAvatar({ actor }: { actor: 'user' | 'ai' | 'derived' }): ReactElement {
  const styles = useStyles();

  return (
    <View accessible accessibilityLabel={NAME[actor]} style={[styles.avatar, styles[actor]]}>
      <Text style={[styles.glyph, styles[TEXT_KEY[actor]]]}>{GLYPH[actor]}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  user: { backgroundColor: colors.userMark },
  ai: { backgroundColor: colors.aiChip },
  derived: { backgroundColor: colors.soft },
  glyph: { fontFamily: fonts.bodyBold, fontSize: 11 },
  userText: { color: colors.card },
  aiText: { color: colors.aiChipInk, fontSize: 14 },
  derivedText: { color: colors.ink, fontSize: 15 },
}));
