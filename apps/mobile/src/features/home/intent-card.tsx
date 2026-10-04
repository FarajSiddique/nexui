import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { IntentListItem } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { AiText, PlacePhoto, Pill } from '#ui';

import { photoBand, type PhotoBand } from './photo-band';

/** Up to three photos across the top of a card, with "+N" on the last for the stops beyond. */
function Band({ band }: { band: PhotoBand }): ReactElement {
  const styles = useStyles();
  const last = band.photos.length - 1;

  return (
    <View style={styles.band}>
      {band.photos.map((uri, index) => (
        <View key={`${index}-${uri}`} style={styles.tile}>
          <PlacePhoto uri={uri} height={108} />
          {index === last && band.more > 0 ? (
            <View style={styles.more}>
              <Text style={styles.moreText}>+{band.more}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * A plan on Home: a band of its stops' photos when it has any, then its goal, badge, summary
 * line and a mini route of its stops. With `onDelete`, screen readers also offer a Delete
 * action, the counterpart of swiping the card away.
 */
export function IntentCard({
  item,
  onPress,
  onDelete,
}: {
  item: IntentListItem;
  onPress: () => void;
  onDelete?: () => void;
}): ReactElement {
  const styles = useStyles();
  const { summary } = item;
  const strip = summary.strip ?? [];
  const band = photoBand(item);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.goal, summary.badge?.text, summary.line].filter(Boolean).join(', ')}
      accessibilityActions={onDelete ? [{ name: 'delete', label: 'Delete' }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') {
          onDelete?.();
        }
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {band.photos.length > 0 ? <Band band={band} /> : null}
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.goal} numberOfLines={2}>
            {item.goal}
          </Text>
          {summary.badge ? <Pill text={summary.badge.text} tone={summary.badge.tone} /> : null}
        </View>
        {summary.line ? <Text style={styles.line}>{summary.line}</Text> : null}
        {strip.length > 0 ? (
          <View style={styles.strip}>
            {strip.map((stop, index) => (
              <Fragment key={`${stop.label}-${index}`}>
                {index > 0 ? <View style={styles.connector} /> : null}
                <AiText text={stop.label} highlight={stop.ai} tag={false} style={styles.stop} />
              </Fragment>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.card },
  pressed: { opacity: 0.8 },
  band: { flexDirection: 'row', gap: 2, height: 108 },
  tile: { flex: 1 },
  more: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: colors.photoScrim,
  },
  moreText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.photoInk },
  body: { gap: 8, padding: 16 },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  goal: { flex: 1, fontFamily: fonts.heading, fontSize: 18, lineHeight: 23, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  connector: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.line },
  stop: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
}));
