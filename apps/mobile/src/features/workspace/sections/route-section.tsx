import type { GraphObject, LegData, PlaceData } from '@nexui/types';
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { aiMarkFor } from '@/features/workspace/ai-mark';
import { rememberDays, useEditMemoryStore } from '@/features/workspace/use-edit-memory-store';
import { MAX_PLACE_DAYS } from '@/features/workspace/workspace-actions';
import type { RouteStop, SectionDataOf } from '@/features/workspace/workspace-layout';
import { formatDays, formatHours, formatMoney, placeName } from '@/lib/format';
import { fonts } from '@/theme/theme';
import { createThemedStyles } from '@/theme/use-theme';
import { AiText } from '@/ui/ai-text';

import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function SmallButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.small, pressed && styles.pressed, disabled && styles.dimmed]}
    >
      <Text style={styles.smallGlyph}>{glyph}</Text>
    </Pressable>
  );
}

function DayStepper({
  name,
  days,
  was,
  onDays,
}: {
  name: string;
  days: number;
  was: number | undefined;
  onDays: (days: number) => void;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Days in ${name}`}
      accessibilityValue={{ text: formatDays(days) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onDays(event.nativeEvent.actionName === 'increment' ? days + 1 : days - 1)
      }
      style={styles.stepper}
    >
      <SmallButton
        glyph="−"
        label={`One day less in ${name}`}
        disabled={days <= 0}
        onPress={() => onDays(days - 1)}
      />
      <View style={styles.dayValue}>
        <Text style={styles.days}>{formatDays(days)}</Text>
        {was !== undefined && was !== days ? <Text style={styles.was}>was {was}</Text> : null}
      </View>
      <SmallButton
        glyph="+"
        label={`One more day in ${name}`}
        disabled={days >= MAX_PLACE_DAYS}
        onPress={() => onDays(days + 1)}
      />
    </View>
  );
}

function StopRow({
  stop,
  was,
  canDays,
  canOrder,
  isFirst,
  isLast,
  onDays,
  onMove,
}: {
  stop: RouteStop;
  was: number | undefined;
  canDays: boolean;
  canOrder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onDays: (days: number) => void;
  onMove: (by: -1 | 1) => void;
}): ReactElement {
  const styles = useStyles();
  const data = stop.place.data as PlaceData;
  const name = placeName(stop.place);
  const detail = [capitalize(data.placeType), data.why].filter(Boolean).join(' · ');

  return (
    <View style={styles.stop}>
      <View style={styles.number}>
        <Text style={styles.numberText}>{stop.order}</Text>
      </View>
      <View style={styles.body}>
        <AiText text={name} highlight={aiMarkFor(stop.place).highlight} style={styles.name} />
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
        {canOrder ? (
          <View style={styles.moves}>
            <SmallButton
              glyph="↑"
              label={`Move ${name} earlier`}
              disabled={isFirst}
              onPress={() => onMove(-1)}
            />
            <SmallButton
              glyph="↓"
              label={`Move ${name} later`}
              disabled={isLast}
              onPress={() => onMove(1)}
            />
          </View>
        ) : null}
      </View>
      {canDays ? (
        <DayStepper name={name} days={data.days} was={was} onDays={onDays} />
      ) : (
        <Text style={styles.days}>{formatDays(data.days)}</Text>
      )}
    </View>
  );
}

function LegRow({ leg }: { leg: GraphObject }): ReactElement {
  const styles = useStyles();
  const data = leg.data as LegData;
  const parts = [
    data.mode === 'other' ? 'Travel' : capitalize(data.mode),
    data.estHours === undefined ? null : formatHours(data.estHours),
    data.estCost ? `≈ ${formatMoney(data.estCost)}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.leg}>
      <View style={styles.legLine} />
      <Text style={styles.legText}>{parts.join(', ')}</Text>
    </View>
  );
}

function UnallocatedRow({ data }: { data: SectionDataOf<'route'> }): ReactElement | null {
  const styles = useStyles();
  const { unallocatedDays, allocatedDays, totalDays } = data;

  if (unallocatedDays === null || totalDays === null || unallocatedDays === 0) {
    return null;
  }

  const over = unallocatedDays < 0;
  const title = over
    ? `${formatDays(-unallocatedDays)} more than the trip has`
    : `${formatDays(unallocatedDays)} not in the route`;

  return (
    <View accessibilityLiveRegion="polite" style={[styles.gap, over && styles.gapOver]}>
      <Text style={styles.gapTitle}>{title}</Text>
      <Text style={styles.gapDetail}>
        {allocatedDays} of {totalDays} days placed
      </Text>
    </View>
  );
}

/** The stops in order, with legs between them; days and order are editable when allowed. */
export function RouteSection({ section, data, onAction }: SectionProps<'route'>): ReactElement {
  const styles = useStyles();
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const canDays = section.editable.includes('days');
  const canOrder = section.editable.includes('order');

  const setDays = (place: GraphObject, days: number): void => {
    const before = (place.data as PlaceData).days;

    if (days < 0 || days > MAX_PLACE_DAYS || days === before) {
      return;
    }

    rememberDays(place.id, before, days);
    onAction({ type: 'setDays', placeId: place.id, days });
  };

  return (
    <SectionFrame title={section.title ?? 'Route'}>
      {data.stops.length === 0 ? (
        <Text style={styles.empty}>
          No stops yet. Nexui adds them as it plans, or ask for one with +.
        </Text>
      ) : null}
      {data.stops.map((stop, index) => (
        <View key={stop.place.id}>
          <StopRow
            stop={stop}
            was={wasDays[stop.place.id]}
            canDays={canDays}
            canOrder={canOrder && data.stops.length > 1}
            isFirst={index === 0}
            isLast={index === data.stops.length - 1}
            onDays={(days) => setDays(stop.place, days)}
            onMove={(by) => onAction({ type: 'move', placeId: stop.place.id, by })}
          />
          {stop.legAfter ? <LegRow leg={stop.legAfter} /> : null}
        </View>
      ))}
      {section.showUnallocated ? <UnallocatedRow data={data} /> : null}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  number: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.userMark,
  },
  numberText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.card },
  body: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  moves: { flexDirection: 'row', gap: 6, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayValue: { minWidth: 56, alignItems: 'center' },
  days: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  was: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.faint,
    textDecorationLine: 'line-through',
  },
  small: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  smallGlyph: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.4 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, minHeight: 28 },
  legLine: { width: 2, alignSelf: 'stretch', backgroundColor: colors.line },
  legText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  gap: {
    gap: 2,
    marginTop: 6,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.faint,
  },
  gapOver: { borderColor: colors.danger },
  gapTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  gapDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
}));
