import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { fonts, createThemedStyles, useColors } from '#theme';
import { AiText, Button, ListEmpty, NexuiTag } from '#ui';
import type { DetailProps } from '#features/workspace';

import { renameAction, stageAction } from './role-actions';
import { askAbout, roleDetails } from './role-details';
import { SheetHeader, SheetSection } from './sheet-parts';

/**
 * A role in the object sheet (job search spec, section 6): what it is and where it stands, why
 * it fits, its posting, and what's for it. Moving it, renaming it and the buttons all report
 * capability actions; a draft opens in place.
 */
export function RoleBody({ object, snapshot, onAction, onDone, busy }: DetailProps): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [closing, setClosing] = useState(false);
  const details = roleDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="This role is no longer in your search." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { data, role, posting } = details;
  const subtitle = [details.company, details.line].filter(Boolean).join(' · ');

  // The return key calls this too, so it waits out an edit in flight as Save does.
  const saveName = (): void => {
    if (busy) {
      return;
    }

    const action = renameAction(role, name);

    setRenaming(false);

    if (action) {
      onAction(action);
    }
  };

  return (
    <View>
      <SheetHeader kicker="Role" onDone={onDone} />
      {renaming ? (
        <View style={styles.rename}>
          <TextInput
            accessibilityLabel="Role title"
            autoFocus
            maxLength={200}
            value={name}
            onChangeText={setName}
            onSubmitEditing={saveName}
            returnKeyType="done"
            selectionColor={colors.ink}
            style={styles.input}
          />
          <View style={styles.row}>
            <Button label="Save" variant="primary" disabled={busy} onPress={saveName} />
            <Button label="Cancel" variant="text" onPress={() => setRenaming(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.titleRow}>
          <AiText text={data.title} highlight={details.ai} style={styles.title} />
          <Button
            label="Rename"
            variant="text"
            accessibilityLabel={`Rename ${data.title}`}
            onPress={() => {
              setName(data.title);
              setRenaming(true);
            }}
          />
        </View>
      )}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View accessibilityRole="radiogroup" accessibilityLabel="Stage" style={styles.stages}>
        {details.stages.map((stage) => (
          <Pressable
            key={stage.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: stage.current, disabled: busy || stage.current }}
            disabled={busy || stage.current}
            onPress={() => onAction(stageAction(role, stage.value))}
            style={[styles.stage, stage.current && styles.stageOn]}
          >
            <Text style={[styles.stageText, stage.current && styles.stageTextOn]}>
              {stage.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {details.closed ? <Text style={styles.strong}>{details.closed}</Text> : null}
      {data.stage === 'offer' ? (
        <View style={styles.row}>
          <Button
            label="Accept offer"
            variant="primary"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'closed', 'accepted'))}
          />
          <Button
            label="Decline"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'closed', 'declined'))}
          />
        </View>
      ) : null}
      {data.stage !== 'closed' && !closing ? (
        <Button
          label="Close this role"
          variant="text"
          onPress={() => setClosing(true)}
          style={styles.start}
        />
      ) : null}
      {data.stage !== 'closed' && closing ? (
        <View style={styles.wrap}>
          {details.closeWith.map((outcome) => (
            <Button
              key={outcome.value}
              label={outcome.label}
              disabled={busy}
              onPress={() => {
                setClosing(false);
                onAction(stageAction(role, 'closed', outcome.value));
              }}
            />
          ))}
          <Button label="Cancel" variant="text" onPress={() => setClosing(false)} />
        </View>
      ) : null}

      {details.fit ? (
        <SheetSection title="Why it fits">
          {details.fit.reasons.map((reason) => (
            <Text key={reason} style={styles.bullet}>
              • {reason}
            </Text>
          ))}
        </SheetSection>
      ) : null}
      {details.fit && details.fit.gaps.length > 0 ? (
        <SheetSection title="Gaps">
          {details.fit.gaps.map((gap) => (
            <Text key={gap} style={styles.bullet}>
              • {gap}
            </Text>
          ))}
        </SheetSection>
      ) : null}

      {posting ? (
        <View style={styles.posting}>
          <Button
            label="View posting"
            variant="primary"
            accessibilityLabel={`View posting on ${posting.host}`}
            onPress={() => onAction({ type: 'link', url: posting.url })}
            style={styles.start}
          />
          <Text style={styles.quiet}>Opens {posting.host}</Text>
          {posting.note ? <Text style={styles.quiet}>{posting.note}</Text> : null}
        </View>
      ) : null}
      {details.dates.length > 0 ? (
        <Text style={styles.quiet}>{details.dates.join(' · ')}</Text>
      ) : null}

      {details.drafts.length > 0 ? (
        <SheetSection title="Drafts">
          {details.drafts.map((draft) => (
            <Pressable
              key={draft.id}
              accessibilityRole="button"
              accessibilityLabel={`${draft.label}. Open`}
              onPress={() => onAction({ type: 'open', objectId: draft.id })}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
            >
              <Text style={styles.listTitle}>{draft.label}</Text>
              {draft.ai ? <NexuiTag /> : null}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </SheetSection>
      ) : null}
      <SheetSection title="People">
        {details.people.length === 0 ? (
          <Text style={styles.quiet}>
            No contacts yet. Tell Nexui who you&apos;re talking to and it adds them here.
          </Text>
        ) : null}
        {details.people.map((person) => (
          <Text key={person.name} style={styles.bullet}>
            {person.role ? `${person.name} · ${person.role}` : person.name}
          </Text>
        ))}
      </SheetSection>
      {details.interviews.length > 0 ? (
        <SheetSection title="Interviews">
          {details.interviews.map((interview) => (
            <Text key={`${interview.label}-${interview.when}`} style={styles.bullet}>
              {interview.label} · {interview.when}
            </Text>
          ))}
        </SheetSection>
      ) : null}

      <View style={styles.footer}>
        {data.stage === 'new' || data.stage === 'interested' ? (
          <Button
            label="I applied"
            variant="primary"
            disabled={busy}
            onPress={() => onAction(stageAction(role, 'applied'))}
          />
        ) : null}
        <Button
          label="Ask about this role"
          onPress={() => onAction({ type: 'ask', prompt: askAbout(details) })}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.muted },
  rename: { gap: 8, paddingTop: 8 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontFamily: fonts.input,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 16 },
  stage: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  stageOn: { backgroundColor: colors.ink },
  stageText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  stageTextOn: { color: colors.card },
  strong: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, paddingTop: 8 },
  start: { alignSelf: 'flex-start' },
  bullet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  posting: { gap: 4, paddingTop: 22 },
  quiet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  listTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  pressed: { opacity: 0.7 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 24 },
}));
