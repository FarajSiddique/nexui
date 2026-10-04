import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { fonts } from '@/theme/theme';
import { createThemedStyles } from '@/theme/use-theme';

interface FormMessageProps {
  message: string | null;
}

/** A form's error under its fields, announced as an alert; renders nothing without a message. */
export function FormError({ message }: FormMessageProps): ReactElement | null {
  const styles = useStyles();

  if (!message) {
    return null;
  }

  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  );
}

/** A form's success note, such as "We sent a new code."; renders nothing without a message. */
export function FormNotice({ message }: FormMessageProps): ReactElement | null {
  const styles = useStyles();

  if (!message) {
    return null;
  }

  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {message}
    </Text>
  );
}

const useStyles = createThemedStyles((colors) => ({
  error: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
    marginTop: 12,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.success,
    marginTop: 12,
  },
}));
