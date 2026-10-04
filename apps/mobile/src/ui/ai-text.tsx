import type { ReactElement } from 'react';
import { Text, View, type StyleProp, type TextStyle } from 'react-native';

import { fonts, createThemedStyles } from '#theme';

/** The small yellow "Nexui" tag. */
export function NexuiTag({ label = 'Nexui' }: { label?: string }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

/**
 * Text Nexui wrote. It sits on the highlighter with a "Nexui" tag until the user edits the
 * object (spec section D). Plain text otherwise.
 */
export function AiText({
  text,
  highlight,
  style,
  tag = true,
  numberOfLines,
}: {
  text: string;
  highlight: boolean;
  style?: StyleProp<TextStyle>;
  tag?: boolean;
  numberOfLines?: number;
}): ReactElement {
  const styles = useStyles();

  if (!highlight) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  return (
    <View style={styles.row} accessible accessibilityLabel={`${text}, added by Nexui`}>
      <Text style={[style, styles.mark]} numberOfLines={numberOfLines}>
        {text}
      </Text>
      {tag ? <NexuiTag /> : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  mark: { flexShrink: 1, backgroundColor: colors.aiMark, borderRadius: 3, paddingHorizontal: 2 },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.aiChip,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.aiChipInk },
}));
