import type { ReactElement, ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import { colors, fonts } from '@/lib/theme';

/**
 * A tab's fixed header: large title on the left, tools on the right. When `filter` is
 * given, a ⌕ button opens a field under the header; `null` means closed, and closing it
 * clears the text.
 */
export function TabHeader({
  title,
  tools,
  filter,
  onFilterChange,
}: {
  title: string;
  tools?: ReactNode;
  filter?: string | null;
  onFilterChange?: (value: string | null) => void;
}): ReactElement {
  const filterable = filter !== undefined && onFilterChange !== undefined;
  const open = filterable && filter !== null;

  return (
    <View>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <View style={styles.tools}>
          {tools}
          {filterable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Filter ${title}`}
              accessibilityState={{ expanded: open }}
              onPress={() => onFilterChange?.(open ? null : '')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <SearchGlyph />
            </Pressable>
          ) : null}
        </View>
      </View>
      {open ? (
        <View style={styles.filter}>
          <TextInput
            accessibilityLabel={`Filter ${title.toLowerCase()}`}
            autoFocus
            value={filter ?? ''}
            onChangeText={(value) => onFilterChange?.(value)}
            placeholder={`Filter ${title.toLowerCase()}`}
            placeholderTextColor={colors.faint}
            selectionColor={colors.ink}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.filterInput, webInput]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close filter"
            hitSlop={8}
            onPress={() => onFilterChange?.(null)}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** A round 40×40 header button, for tools such as Home's gear. */
export function HeaderButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

// A magnifier drawn with views: a ring and a short handle.
function SearchGlyph(): ReactElement {
  return (
    <View style={styles.glyph}>
      <View style={styles.lens} />
      <View style={styles.handle} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
  },
  title: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 32,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  glyph: { width: 20, height: 20 },
  lens: {
    position: 'absolute',
    top: 1,
    left: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  handle: {
    position: 'absolute',
    top: 14,
    left: 12,
    width: 7,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.ink,
    transform: [{ rotate: '45deg' }],
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: 13,
    backgroundColor: colors.card,
  },
  filterInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.muted },
});

// The field's container already frames it; drop the browser's focus ring.
const webInput = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;
