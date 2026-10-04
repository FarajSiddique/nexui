import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { formatDays } from '#lib';
import { fonts, createThemedStyles } from '#theme';

import type { SectionDataOf } from '../workspace-layout';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

function caption(data: SectionDataOf<'allocation'>): string {
  const used = data.parts.reduce((sum, part) => sum + part.value, 0);

  if (data.total === null) {
    return `${formatDays(used)} placed. The trip's length isn't set yet.`;
  }

  if (data.over > 0) {
    return `${formatDays(data.over)} more than the trip has`;
  }

  if (data.free > 0) {
    return `${formatDays(data.free)} free of ${data.total}`;
  }

  return `All ${formatDays(data.total)} placed`;
}

/**
 * Each part's share of the trip as a proportional bar, with unplaced days dashed. Segments are
 * flex shares, so an over-full trip still fits the card; the caption says how far over it is.
 */
export function AllocationSection({ section, data }: SectionProps<'allocation'>): ReactElement {
  const styles = useStyles();
  const text = caption(data);
  const parts = data.parts.filter((part) => part.value > 0);
  const described = parts.map((part) => `${part.label} ${formatDays(part.value)}`).join(', ');

  return (
    <SectionFrame title={section.title}>
      {parts.length > 0 || data.free > 0 ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={[described, text].filter(Boolean).join('. ')}
          style={styles.bar}
        >
          {parts.map((part) => (
            <View
              key={part.id}
              style={[styles.part, part.ai && styles.aiPart, { flex: part.value }]}
            >
              <Text numberOfLines={1} style={styles.partText}>
                {part.label} {part.value}
              </Text>
            </View>
          ))}
          {data.free > 0 ? <View style={[styles.free, { flex: data.free }]} /> : null}
        </View>
      ) : null}
      <Text style={[styles.caption, data.over > 0 && styles.warn]}>{text}</Text>
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: { flexDirection: 'row', height: 36, gap: 2, borderRadius: 10, overflow: 'hidden' },
  part: { justifyContent: 'center', minWidth: 6, backgroundColor: colors.line },
  aiPart: { backgroundColor: colors.aiMark },
  partText: { paddingHorizontal: 6, fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
  free: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.faint,
    backgroundColor: colors.card,
  },
  caption: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  warn: { color: colors.danger },
}));
