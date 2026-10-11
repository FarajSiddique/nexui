import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { AiText, Button, ListEmpty, NexuiTag } from '#ui';
import type { DetailProps } from '#features/workspace';

import { draftDetails, sentAction } from './draft-details';
import { SheetHeader } from './sheet-parts';

/**
 * A draft in the object sheet (job search spec, section 6): its text, Copy, and for an email
 * Open in Mail, which fills in a message the user sends from their own mail app. Nothing leaves
 * Nexui. I sent it, on a follow-up, records the contact on its role.
 */
export function DraftBody({ object, snapshot, onAction, onDone, busy }: DetailProps): ReactElement {
  const styles = useStyles();
  const details = draftDetails(snapshot, object.id);

  if (!details) {
    return (
      <View style={styles.gap}>
        <ListEmpty text="There's nothing more to show for this." />
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const { data, email, role } = details;

  return (
    <View>
      <SheetHeader kicker={details.kicker} onDone={onDone} />
      <View style={styles.head}>
        <AiText text={details.title} highlight={details.ai} tag={false} style={styles.title} />
        {details.ai ? <NexuiTag label="Nexui draft" /> : null}
      </View>
      {email?.to ? (
        <Text style={styles.meta}>
          <Text style={styles.label}>To </Text>
          {email.to}
        </Text>
      ) : null}
      {email?.subject ? (
        <Text style={styles.meta}>
          <Text style={styles.label}>Subject </Text>
          {email.subject}
        </Text>
      ) : null}
      <Text selectable style={styles.body}>
        {data.body}
      </Text>
      <View style={styles.actions}>
        {email ? (
          <Button
            label="Open in Mail"
            variant="primary"
            onPress={() => onAction({ type: 'link', url: email.mailto })}
          />
        ) : null}
        <Button label="Copy" onPress={() => onAction({ type: 'copy', text: data.body })} />
        {details.canLogSent && role ? (
          <Button label="I sent it" disabled={busy} onPress={() => onAction(sentAction(role))} />
        ) : null}
      </View>
      {email ? (
        <Text style={styles.note}>
          Nexui never sends email. Open in Mail fills in a message in your own mail app.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  gap: { gap: 12 },
  head: { gap: 6, paddingTop: 8 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink, paddingTop: 6 },
  label: { fontFamily: fonts.bodyBold, color: colors.muted },
  body: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 16 },
  note: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.faint,
    paddingTop: 10,
  },
}));
