import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { GraphObject } from '@nexui/types';

import { fonts, createThemedStyles, useColors } from '#theme';
import { Button, ListEmpty } from '#ui';
import type { CapabilityAction, DetailProps, WorkspaceAction } from '#features/workspace';

import { ChipList, type Chip } from './chip-list';
import {
  addTo,
  forgetPassAction,
  LISTS,
  removeFrom,
  salaryFloorAction,
  searchDetails,
  toggleWorkMode,
  type ListField,
} from './search-details';
import { SheetHeader, SheetSection } from './sheet-parts';

// The floor, Change to type a new one, or Set in + when there's none to change.
function SalaryFloor({
  search,
  floor,
  busy,
  onAction,
}: {
  search: GraphObject;
  floor: string | null;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [typed, setTyped] = useState<string | null>(null);

  if (typed === null) {
    return (
      <View style={styles.floor}>
        <Text style={styles.value}>{floor ?? 'None'}</Text>
        {floor ? (
          <Button label="Change" variant="text" onPress={() => setTyped('')} />
        ) : (
          <Button
            label="Set in +"
            variant="text"
            onPress={() => onAction({ type: 'ask', prompt: 'Set my salary floor to ' })}
          />
        )}
      </View>
    );
  }

  const save = (): void => {
    const action = salaryFloorAction(search, typed);

    setTyped(null);

    if (action) {
      onAction(action);
    }
  };

  return (
    <View style={styles.floor}>
      <TextInput
        accessibilityLabel="New salary floor"
        autoFocus
        keyboardType="numeric"
        placeholder="e.g. 130,000"
        placeholderTextColor={colors.faint}
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={save}
        selectionColor={colors.ink}
        style={styles.input}
      />
      <Button label="Save" variant="primary" disabled={busy} onPress={save} />
      <Button label="Cancel" variant="text" onPress={() => setTyped(null)} />
    </View>
  );
}

/**
 * The search in the object sheet (job search spec, section 6): its criteria as editable chips,
 * the never-show list, why the user passed, and the resume. Criteria go through `object.update`
 * and a pass reason through `jobs.forgetPass`; Replace reports an upload.
 */
export function SearchBody({
  object,
  snapshot,
  onAction,
  onDone,
  busy,
}: DetailProps): ReactElement {
  const styles = useStyles();
  const details = searchDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="This search is no longer here." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { search, data } = details;
  const send = (action: CapabilityAction | null): void => {
    if (action) {
      onAction(action);
    }
  };
  const chipsOf = (field: ListField): Chip[] =>
    data[field].map((label) => ({ key: label, label, note: null, removable: true }));
  const listProps = (field: ListField, addLabel: string) => ({
    chips: chipsOf(field),
    busy,
    addLabel,
    maxLength: LISTS[field].length,
    onRemove: (value: string) => send(removeFrom(search, field, value)),
    onAdd: (value: string) => send(addTo(search, field, value)),
  });

  return (
    <View>
      <SheetHeader kicker="Your search" onDone={onDone} />
      <Text accessibilityRole="header" style={styles.title}>
        Your search
      </Text>
      <ChipList title="Roles" {...listProps('roles', 'Add a role')} />
      <ChipList title="Where" {...listProps('locations', 'Add a place')} />
      <SheetSection title="How you work">
        <View style={styles.modes}>
          {details.workModes.map((mode) => (
            <Pressable
              key={mode.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: mode.on, disabled: busy }}
              disabled={busy}
              onPress={() => send(toggleWorkMode(search, mode.value))}
              style={[styles.mode, mode.on && styles.modeOn]}
            >
              <Text style={[styles.modeText, mode.on && styles.modeTextOn]}>{mode.label}</Text>
            </Pressable>
          ))}
        </View>
      </SheetSection>
      <SheetSection title="Salary floor">
        <SalaryFloor search={search} floor={details.salaryFloor} busy={busy} onAction={onAction} />
      </SheetSection>
      <ChipList title="Industries" {...listProps('industries', 'Add an industry')} />
      <ChipList
        title="Never show"
        {...listProps('excludeCompanies', 'Add a company never to show')}
        chips={details.neverShow.map((entry) => ({
          key: entry.name,
          label: entry.name,
          note: entry.employer ? 'your current employer' : null,
          removable: !entry.employer,
        }))}
      />
      {details.passes.length > 0 ? (
        <ChipList
          title="You passed because"
          busy={busy}
          chips={details.passes.map((pass) => ({
            key: pass.at,
            label: pass.text,
            note: null,
            removable: true,
          }))}
          onRemove={(at) => onAction(forgetPassAction(search, at))}
        />
      ) : null}
      <SheetSection title="Resume">
        {details.resume ? (
          <>
            <Text style={styles.value}>Read {details.resume.read}</Text>
            {details.resume.profile ? (
              <Text style={styles.quiet}>{details.resume.profile}</Text>
            ) : null}
            <Button
              label="Replace"
              disabled={busy}
              onPress={() => onAction({ type: 'upload', docType: 'resume' })}
              style={styles.start}
            />
          </>
        ) : (
          <>
            <Text style={styles.quiet}>No resume yet. Nexui screens roles on your goal alone.</Text>
            <Button
              label="Add resume"
              variant="primary"
              disabled={busy}
              onPress={() => onAction({ type: 'upload', docType: 'resume' })}
              style={styles.start}
            />
          </>
        )}
      </SheetSection>
      <Text style={styles.footnote}>The search ends when you accept an offer.</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 31,
    color: colors.ink,
    paddingTop: 8,
  },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mode: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  modeOn: { backgroundColor: colors.ink },
  modeText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  modeTextOn: { color: colors.card },
  floor: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  quiet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  input: {
    flexGrow: 1,
    minWidth: 140,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  start: { alignSelf: 'flex-start' },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.faint,
    paddingTop: 24,
  },
}));
