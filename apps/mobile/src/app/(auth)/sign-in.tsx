import { GoogleSigninButton } from '@react-native-google-signin/google-signin';
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { fonts, createThemedStyles, useColors, useScheme } from '#theme';
import { Button, FormError } from '#ui';
import {
  AppleAccessNotice,
  AuthActionError,
  dismissAppleAccessNotice,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  AuthScreen,
  useAuthStyles,
} from '#features/auth';

type Pending = 'email' | 'google' | 'apple' | null;

// Web shows only email codes; Apple sign-in is iOS only.
const SUBTITLE = Platform.select({
  ios: 'Use Apple or Google, or get a one-time code by email.',
  web: 'Get a one-time code by email.',
  default: 'Use Google, or get a one-time code by email.',
});

export default function SignInScreen(): ReactElement {
  const styles = useStyles();
  const authStyles = useAuthStyles();
  const colors = useColors();
  const scheme = useScheme();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail() {
    if (pending !== null) {
      return;
    }

    dismissAppleAccessNotice();
    setPending('email');
    setError(null);
    try {
      const sentTo = await sendEmailCode(email);

      router.push({ pathname: '/verify', params: { email: sentTo } });
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  // A successful sign-in updates the session, and the root layout swaps to the app.
  async function continueWithGoogle() {
    if (pending !== null) {
      return;
    }

    dismissAppleAccessNotice();
    setPending('google');
    setError(null);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  async function continueWithApple() {
    if (pending !== null) {
      return;
    }

    dismissAppleAccessNotice();
    setPending('apple');
    setError(null);
    try {
      await signInWithApple();
    } catch (caught) {
      setError(caught instanceof AuthActionError ? caught.message : 'Something went wrong.');
    } finally {
      setPending(null);
    }
  }

  return (
    <AuthScreen title="Sign in" subtitle={SUBTITLE}>
      <AppleAccessNotice />

      {Platform.OS !== 'web' ? (
        <View style={styles.providers}>
          {Platform.OS === 'ios' ? (
            // The Apple button has no disabled state, so its wrapper dims it and takes no touches.
            <View style={pending !== null && styles.inactive}>
              <AppleAuthenticationButton
                buttonType={AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthenticationButtonStyle.BLACK
                }
                style={styles.providerButton}
                onPress={() => void continueWithApple()}
              />
            </View>
          ) : null}
          <GoogleSigninButton
            style={styles.providerButton}
            size={GoogleSigninButton.Size.Wide}
            color={GoogleSigninButton.Color.Light}
            disabled={pending !== null}
            onPress={() => void continueWithGoogle()}
          />
        </View>
      ) : null}

      {Platform.OS !== 'web' ? (
        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.rule} />
        </View>
      ) : null}

      <Text nativeID="email-label" style={authStyles.label}>
        Email
      </Text>
      <TextInput
        accessibilityLabelledBy="email-label"
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => void submitEmail()}
        placeholder="you@example.com"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        editable={pending === null}
        style={authStyles.input}
      />
      <FormError message={error} />
      <Button
        variant="ink"
        label="Email me a code"
        busy={pending === 'email'}
        disabled={pending !== null || !email.trim()}
        onPress={() => void submitEmail()}
        style={authStyles.submit}
      />
    </AuthScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  providers: { gap: 12 },
  providerButton: { width: '100%', height: 52 },
  inactive: { opacity: 0.6, pointerEvents: 'none' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { fontFamily: fonts.body, fontSize: 14, color: colors.faint },
}));
