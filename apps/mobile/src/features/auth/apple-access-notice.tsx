import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { Button } from '#ui';

import { dismissAppleAccessNotice, useAuthNoticeStore } from './use-auth-notice-store';

/** After deleting an account whose Apple access Nexui couldn't revoke: how to finish. */
export function AppleAccessNotice(): ReactElement | null {
  const styles = useStyles();
  const visible = useAuthNoticeStore((state) => state.appleAccessRemains);

  if (!visible) {
    return null;
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.title}>Your account is deleted</Text>
      <Text style={styles.text}>
        To finish, remove Nexui under Sign in with Apple in your Apple Account settings, on an Apple
        device or at account.apple.com.
      </Text>
      <Button
        variant="text"
        label="Dismiss"
        onPress={dismissAppleAccessNotice}
        style={styles.dismiss}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  notice: { padding: 16, borderRadius: 16, backgroundColor: colors.card, marginBottom: 24 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 6 },
  dismiss: { alignSelf: 'flex-start', marginTop: 4 },
}));
