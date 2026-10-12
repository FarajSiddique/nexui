import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { SectionFrame, type SectionProps } from '#features/workspace';

import { timelineRows, type TimelineRow } from '../timeline';

function Row({
  row,
  past,
  onOpen,
}: {
  row: TimelineRow;
  past: boolean;
  onOpen: (objectId: string) => void;
}): ReactElement {
  const styles = useStyles();
  const label = [row.weekday, row.day, row.title, row.detail].filter(Boolean).join(', ');
  const opens = row.opens;
  const body = (
    <>
      <View style={[styles.day, past && styles.dim]}>
        <Text style={styles.weekday}>{row.weekday}</Text>
        <Text style={styles.date}>{row.day}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{row.title}</Text>
        {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
      </View>
    </>
  );

  if (!opens) {
    return (
      <View accessible accessibilityLabel={label} style={styles.row}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show the role`}
      onPress={() => onOpen(opens)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * What's coming up (spec section 3.2): interviews soonest first, with the past folded to a
 * count. A row opens the role its interview is for. "Now" is read when the plan's data changes,
 * so an interview that passes while the plan stays open moves to the past on the next change.
 */
export function TimelineSection({
  section,
  data,
  snapshot,
  onAction,
}: SectionProps<'timeline'>): ReactElement {
  const styles = useStyles();
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = useMemo(
    () => timelineRows(section, data.objects, snapshot, new Date()),
    [section, data.objects, snapshot],
  );
  const open = (objectId: string): void => onAction({ type: 'open', objectId });

  return (
    <SectionFrame title={section.title}>
      {upcoming.length === 0 ? (
        <Text style={styles.empty}>{section.empty ?? 'Nothing coming up.'}</Text>
      ) : null}
      {upcoming.map((row) => (
        <Row key={row.id} row={row} past={false} onOpen={open} />
      ))}
      {past.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showPast }}
          onPress={() => setShowPast((shown) => !shown)}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            Past · {past.length} {showPast ? '▴' : '▾'}
          </Text>
        </Pressable>
      ) : null}
      {showPast ? past.map((row) => <Row key={row.id} row={row} past onOpen={open} />) : null}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  pressed: { opacity: 0.7 },
  day: { minWidth: 40, alignItems: 'center' },
  dim: { opacity: 0.6 },
  weekday: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.faint },
  date: { fontFamily: fonts.display, fontSize: 22, lineHeight: 24, color: colors.ink },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
}));
