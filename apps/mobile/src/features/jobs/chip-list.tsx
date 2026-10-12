import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { fonts, createThemedStyles, useColors } from '#theme';
import { Button } from '#ui';

import { SheetSection } from './sheet-parts';

export interface Chip {
  key: string;
  label: string;
  /** Said after the label: "your current employer". */
  note: string | null;
  removable: boolean;
}

/**
 * A titled row of chips, each removable with ✕, and + Add, which opens a field below. With no
 * `onAdd` there is no + Add (pass reasons).
 */
export function ChipList({
  title,
  chips,
  busy,
  onRemove,
  onAdd,
  addLabel = '',
  maxLength = 100,
}: {
  title: string;
  chips: readonly Chip[];
  busy: boolean;
  onRemove: (key: string) => void;
  onAdd?: (value: string) => void;
  /** The field's accessible name: "Add a role". */
  addLabel?: string;
  maxLength?: number;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const close = (): void => {
    setValue('');
    setAdding(false);
  };

  // The return key calls this too, so it waits out an edit in flight as Add does.
  const submit = (): void => {
    if (busy) {
      return;
    }

    onAdd?.(value);
    close();
  };

  return (
    <SheetSection title={title}>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip.key} style={styles.chip}>
            <Text style={styles.chipText}>
              {chip.note ? `${chip.label} · ${chip.note}` : chip.label}
            </Text>
            {chip.removable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${chip.label}`}
                disabled={busy}
                hitSlop={8}
                onPress={() => onRemove(chip.key)}
                style={styles.remove}
              >
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {onAdd && !adding ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            onPress={() => setAdding(true)}
            style={[styles.chip, styles.add]}
          >
            <Text style={styles.chipText}>+ Add</Text>
          </Pressable>
        ) : null}
      </View>
      {adding ? (
        <View style={styles.addRow}>
          <TextInput
            accessibilityLabel={addLabel}
            autoFocus
            maxLength={maxLength}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            returnKeyType="done"
            selectionColor={colors.ink}
            style={styles.input}
          />
          <Button
            label="Add"
            variant="primary"
            disabled={busy || value.trim().length === 0}
            onPress={submit}
          />
          <Button label="Cancel" variant="text" onPress={close} />
        </View>
      ) : null}
    </SheetSection>
  );
}

const useStyles = createThemedStyles((colors) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.soft,
  },
  add: { paddingRight: 12 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  addRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  input: {
    flexGrow: 1,
    minWidth: 160,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
}));
