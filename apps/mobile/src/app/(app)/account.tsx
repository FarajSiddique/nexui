import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormError, PrimaryButton, TextButton } from '@/components/auth-screen';
import { deleteAccount } from '@/lib/api';
import { clearDeletedAccount, signOut } from '@/lib/auth';
import { colors, fonts } from '@/lib/theme';
import { useHealth } from '@/lib/use-health';
import { useSessionStore } from '@/stores/use-session-store';

type Pending = 'signOut' | 'delete' | null;

export default function AccountScreen(): ReactElement {
  const email = useSessionStore((state) => state.session?.user.email);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const health = useHealth();
  const status = health.isPending ? 'Checking…' : health.isError ? 'Unreachable' : 'Connected';
  const statusColor = health.isPending
    ? colors.faint
    : health.isError
      ? colors.danger
      : colors.success;

  // Both actions end the session, and the root layout then returns to sign-in.
  async function onSignOut() {
    setPending('signOut');
    setError(null);
    try {
      await signOut();
    } catch {
      setError('Could not sign out. Try again.');
      setPending(null);
    }
  }

  async function onDelete() {
    setPending('delete');
    setError(null);
    try {
      await deleteAccount();
      await clearDeletedAccount();
    } catch (caught) {
      if (__DEV__) {
        console.warn('Account deletion failed', caught);
      }

      setError('Could not delete your account. Check your connection and try again.');
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.dimmed]}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            Account
          </Text>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.email}>{email ?? 'Unknown email'}</Text>
          <Text style={styles.label}>Server</Text>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.statusText, { color: statusColor }]}
            >
              {status}
            </Text>
          </View>

          <PrimaryButton
            label="Sign out"
            busy={pending === 'signOut'}
            disabled={pending !== null}
            onPress={() => void onSignOut()}
          />

          <View style={styles.danger}>
            <Text style={styles.dangerTitle}>Delete account</Text>
            <Text style={styles.dangerText}>
              This permanently deletes your Nexui account and signs you out on every device. It
              can’t be undone.
            </Text>
            {confirmingDelete ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending !== null, busy: pending === 'delete' }}
                  disabled={pending !== null}
                  onPress={() => void onDelete()}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    (pressed || pending !== null) && styles.dimmed,
                  ]}
                >
                  <Text style={styles.deleteText}>
                    {pending === 'delete' ? 'Deleting…' : 'Delete permanently'}
                  </Text>
                </Pressable>
                <TextButton
                  label="Cancel"
                  disabled={pending !== null}
                  onPress={() => setConfirmingDelete(false)}
                />
              </>
            ) : (
              <TextButton
                label="Delete my account"
                disabled={pending !== null}
                onPress={() => setConfirmingDelete(true)}
              />
            )}
          </View>
          <FormError message={error} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.ink, marginTop: 16 },
  label: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 20 },
  email: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink, marginTop: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: fonts.bodyBold, fontSize: 16 },
  danger: {
    marginTop: 40,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  dangerTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.ink },
  dangerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 6,
  },
  deleteButton: {
    backgroundColor: colors.danger,
    minHeight: 48,
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 16,
  },
  deleteText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.card,
    textAlign: 'center',
  },
  dimmed: { opacity: 0.6 },
});
