import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CardAction, PassReason } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { AiText, Button } from '#ui';
import { SectionFrame, type SectionProps, type WorkspaceAction } from '#features/workspace';

import { pipelineGroups, type PipelineCard, type PipelineGroup } from '../pipeline';
import { cardAction } from '../role-actions';
import { PassPicker } from './pass-picker';

const DISCLOSURE = "Picked by Nexui's AI from employers' own job boards.";

function Fit({ fit }: { fit: NonNullable<PipelineCard['fit']> }): ReactElement {
  const styles = useStyles();

  return (
    <Text style={styles.fit}>
      <Text style={styles.strong}>Fits: </Text>
      {fit.reasons.join('; ')}.
      {fit.gaps.length > 0 ? (
        <>
          {' '}
          <Text style={styles.strong}>Gaps: </Text>
          {fit.gaps.join('; ')}.
        </>
      ) : null}
    </Text>
  );
}

function RoleCard({
  card,
  busy,
  onAction,
}: {
  card: PipelineCard;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const [passing, setPassing] = useState(false);

  const press = (action: CardAction): void => {
    if (action.pick === 'passReason') {
      setPassing(true);

      return;
    }

    onAction(cardAction(card.role, action, null));
  };

  const pass = (reason: PassReason | null): void => {
    const action = card.actions.find((entry) => entry.pick === 'passReason');

    setPassing(false);

    if (action) {
      onAction(cardAction(card.role, action, reason));
    }
  };

  return (
    <View style={[styles.card, card.ai && styles.suggested]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${[card.title, card.line, card.note].filter(Boolean).join(', ')}. Show details`}
        onPress={() => onAction({ type: 'open', objectId: card.role.id })}
        style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
      >
        <AiText text={card.title} highlight={card.ai} tag={false} style={styles.title} />
        {card.line ? <Text style={styles.line}>{card.line}</Text> : null}
        {card.fit ? <Fit fit={card.fit} /> : null}
        {card.note ? <Text style={styles.note}>{card.note}</Text> : null}
      </Pressable>
      {passing ? (
        <PassPicker
          title={card.title}
          busy={busy}
          onPick={pass}
          onCancel={() => setPassing(false)}
        />
      ) : null}
      {!passing && card.actions.length > 0 ? (
        <View style={styles.buttons}>
          {card.actions.map((action) => (
            <View key={`${action.capability}-${action.label}`} style={styles.buttonSlot}>
              <Button
                label={action.label}
                accessibilityLabel={`${action.label}: ${card.title}`}
                variant={action.tone === 'primary' ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => press(action)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Group({
  group,
  first,
  busy,
  onAction,
}: {
  group: PipelineGroup;
  first: boolean;
  busy: boolean;
  onAction: (action: WorkspaceAction) => void;
}): ReactElement {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const shown = !group.collapsed || open;

  return (
    <View style={styles.group}>
      {group.collapsed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={styles.foldRow}
        >
          <Text style={styles.foldText}>
            {group.label} · {group.cards.length} {open ? '▴' : '▾'}
          </Text>
        </Pressable>
      ) : (
        <Text accessibilityRole="header" style={styles.groupLabel}>
          {group.label} · {group.cards.length}
        </Text>
      )}
      {first ? <Text style={styles.disclosure}>{DISCLOSURE}</Text> : null}
      {first && group.cards.length === 0 ? (
        <Text style={styles.empty}>No new roles yet. Nexui adds its best matches here.</Text>
      ) : null}
      {shown
        ? group.cards.map((card) => (
            <RoleCard key={card.role.id} card={card} busy={busy} onAction={onAction} />
          ))
        : null}
    </View>
  );
}

/**
 * Roles by stage (spec section 3.2): New first, with Nexui's picks AI-marked and Interested and
 * Pass on each; later stages only with roles in them; Closed folded to a count. Every card opens
 * its role. "Now" is read when the plan's data changes, so a follow-up note that falls due while
 * the plan stays open shows on the next change.
 */
export function PipelineSection({
  section,
  data,
  snapshot,
  onAction,
  busy,
}: SectionProps<'pipeline'>): ReactElement {
  const groups = useMemo(
    () => pipelineGroups(section, data.objects, snapshot),
    [section, data.objects, snapshot],
  );

  return (
    <SectionFrame title={section.title}>
      {groups.map((group, index) => (
        <Group
          key={group.stage}
          group={group}
          first={index === 0}
          busy={busy}
          onAction={onAction}
        />
      ))}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  group: { gap: 10 },
  groupLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  disclosure: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  foldRow: { minHeight: 44, justifyContent: 'center' },
  foldText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  card: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.soft },
  suggested: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.faint },
  cardBody: { gap: 4 },
  pressed: { opacity: 0.7 },
  title: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 21, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  fit: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  strong: { fontFamily: fonts.bodyBold },
  note: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.ink },
  buttons: { flexDirection: 'row', gap: 8 },
  buttonSlot: { flex: 1 },
}));
