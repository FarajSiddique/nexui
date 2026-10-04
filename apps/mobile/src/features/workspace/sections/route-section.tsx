import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { GraphObject, LegData, PlaceData } from '@nexui/types';

import { capitalize, formatDays, legFigures, placeName } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { AiText } from '#ui';

import { aiMarkFor } from '../ai-mark';
import { DayStepper, SmallButton } from '../day-stepper';
import { stopButtonLabel, stopKind } from '../stop-details';
import { rememberDays, useEditMemoryStore } from '../use-edit-memory-store';
import { daysAction } from '../workspace-actions';
import type { RouteStop, SectionDataOf } from '../workspace-layout';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

/**
 * One stop: its name, type and `why` are one button that opens the stop's details, with the
 * order and day controls on a line below.
 */
function StopRow({
  stop,
  was,
  canDays,
  canOrder,
  isFirst,
  isLast,
  onDays,
  onMove,
  onOpen,
}: {
  stop: RouteStop;
  was: number | undefined;
  canDays: boolean;
  canOrder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onDays: (days: number) => void;
  onMove: (by: -1 | 1) => void;
  onOpen: () => void;
}): ReactElement {
  const styles = useStyles();
  const data = stop.place.data as PlaceData;
  const name = placeName(stop.place);

  return (
    <View style={styles.stop}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stopButtonLabel(name, stop.order, data.days)}
        onPress={onOpen}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <View style={styles.number}>
          <Text style={styles.numberText}>{stop.order}</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.nameRow}>
            <View style={styles.nameText}>
              <AiText text={name} highlight={aiMarkFor(stop.place).highlight} style={styles.name} />
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
          <Text style={styles.kind}>{stopKind(data)}</Text>
          {data.why ? (
            <Text style={styles.detail} numberOfLines={2}>
              {data.why}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.controls}>
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
        ) : (
          <View />
        )}
        {canDays ? (
          <DayStepper name={name} days={data.days} was={was} onDays={onDays} />
        ) : (
          <Text style={styles.days}>{formatDays(data.days)}</Text>
        )}
      </View>
    </View>
  );
}

function LegRow({ leg }: { leg: GraphObject }): ReactElement {
  const styles = useStyles();
  const data = leg.data as LegData;
  const parts = [data.mode === 'other' ? 'Travel' : capitalize(data.mode), legFigures(data)].filter(
    Boolean,
  );

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

/**
 * The stops in order, with legs between them; days and order are editable when allowed, and
 * each stop opens its details.
 */
export function RouteSection({ section, data, onAction }: SectionProps<'route'>): ReactElement {
  const styles = useStyles();
  const wasDays = useEditMemoryStore((state) => state.wasDays);
  const canDays = section.editable.includes('days');
  const canOrder = section.editable.includes('order');

  const setDays = (place: GraphObject, days: number): void => {
    const action = daysAction(place, days);

    if (!action) {
      return;
    }

    rememberDays(place.id, (place.data as PlaceData).days, days);
    onAction(action);
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
            onOpen={() => onAction({ type: 'openPlace', placeId: stop.place.id })}
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
  stop: { gap: 6, paddingVertical: 8 },
  open: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
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
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameText: { flexShrink: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  chevron: { marginLeft: 'auto', fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  kind: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.faint },
  detail: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 38,
  },
  moves: { flexDirection: 'row', gap: 6 },
  days: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  pressed: { opacity: 0.7 },
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
