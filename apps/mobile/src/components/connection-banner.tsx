import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/lib/theme';
import { useHealth } from '@/lib/use-health';

// Shown under a tab's header only while the server is unreachable; it goes on recovery.
export function ConnectionBanner(): ReactElement | null {
  const health = useHealth();

  if (!health.isError) {
    return null;
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <Text style={styles.text}>
        Nexui can’t reach its server. Check that the API is running, then try again.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check the connection again"
        disabled={health.isFetching}
        onPress={() => void health.refetch()}
        style={({ pressed }) => [styles.retry, (pressed || health.isFetching) && styles.dimmed]}
      >
        <Text style={styles.retryText}>{health.isFetching ? 'Checking…' : 'Check again'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    gap: 8,
  },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  dimmed: { opacity: 0.6 },
});
