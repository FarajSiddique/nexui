import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { ActorAvatar } from '@/components/actor-avatar';
import { Button } from '@/components/buttons';
import type { ChangeRow } from '@/lib/change-feed';
import { formatRelative } from '@/lib/format';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/**
 * One change: who, what (with before → after), which plan and when. In Changes it carries
 * Undo or Redo; a derived row instead says it undoes with the edit that caused it.
 */
export function ChangeRowView({
  row,
  now,
  compact = false,
  onRevert,
  pending = false,
}: {
  row: ChangeRow;
  now: Date;
  compact?: boolean;
  onRevert?: (eventId: string) => void;
  pending?: boolean;
}): ReactElement {
  const styles = useStyles();
  const meta = [row.intentGoal, formatRelative(row.createdAt, now)].filter(Boolean).join(', ');
  const unit = row.diff?.unit ? ` ${row.diff.unit}` : '';
  const revert = row.revert;

  const renderTrailing = (): ReactElement | null => {
    if (compact) {
      return null;
    }

    if (revert && onRevert) {
      return (
        <Button
          label={revert.label}
          accessibilityLabel={`${revert.label}: ${row.who} ${row.text}`}
          busy={pending}
          onPress={() => onRevert(revert.eventId)}
        />
      );
    }

    return row.actor === 'derived' ? <Text style={styles.tied}>Undoes with your edit</Text> : null;
  };

  return (
    <View style={styles.row}>
      <ActorAvatar actor={row.actor} />
      <View style={styles.body}>
        <Text style={[styles.sentence, row.undone && styles.undone]}>
          <Text style={styles.who}>{row.who}</Text> {row.text}
          {row.diff ? (
            <Text style={styles.diff}>
              {' '}
              {row.diff.before} → {row.diff.after}
            </Text>
          ) : null}
          {unit}
        </Text>
        <Text style={styles.meta}>{row.undone ? `Undone · ${meta}` : meta}</Text>
      </View>
      {renderTrailing()}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  body: { flex: 1, gap: 2 },
  sentence: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  undone: { textDecorationLine: 'line-through', color: colors.muted },
  who: { fontFamily: fonts.bodyBold },
  diff: { fontFamily: fonts.bodyBold },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
  tied: {
    maxWidth: 92,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.faint,
    textAlign: 'right',
  },
}));
