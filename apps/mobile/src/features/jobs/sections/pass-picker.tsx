import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { PASS_REASONS, type PassReason } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

/**
 * Why the user passes on a role (spec section 3.2): one tap on a reason, or Skip to pass with
 * none. It sits inside the role's card rather than over the page.
 */
export function PassPicker({
  title,
  busy,
  onPick,
  onCancel,
}: {
  title: string;
  busy: boolean;
  onPick: (reason: PassReason | null) => void;
  onCancel: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.picker}>
      <Text
        accessibilityRole="header"
        accessibilityLabel={`Why pass on ${title}?`}
        style={styles.title}
      >
        Why pass?
      </Text>
      <View style={styles.reasons}>
        {PASS_REASONS.map((reason) => (
          <Button
            key={reason.value}
            label={reason.label}
            disabled={busy}
            onPress={() => onPick(reason.value)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        One tap. Nexui uses it to tune the roles it picks, and you can remove it from your search
        later.
      </Text>
      <View style={styles.footer}>
        <Button
          label="Skip, just pass"
          variant="text"
          disabled={busy}
          onPress={() => onPick(null)}
        />
        <Button label="Cancel" variant="text" onPress={onCancel} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  picker: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  title: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
}));
