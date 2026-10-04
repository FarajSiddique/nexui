import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts } from '@/theme/theme';
import { createThemedStyles } from '@/theme/use-theme';

interface AuthScreenProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthScreen({ title, subtitle, children }: AuthScreenProps): ReactElement {
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.brand}>nexui</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The sign-in forms' fields, and where their buttons sit: `submit` for the ink button, `link`
 * for a text button.
 */
export const useAuthStyles = createThemedStyles((colors) => ({
  input: {
    fontFamily: fonts.input,
    fontSize: 18,
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  submit: { marginTop: 16 },
  link: { alignSelf: 'center', marginTop: 8 },
}));

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  brand: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -1, color: colors.ink },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.ink, marginTop: 36 },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 24,
  },
}));
