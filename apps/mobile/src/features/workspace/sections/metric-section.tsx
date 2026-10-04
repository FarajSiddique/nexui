import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { MetricValue } from '@/features/workspace/workspace-layout';
import { formatMoney } from '@/lib/format';
import { fonts } from '@/theme/theme';
import { createThemedStyles } from '@/theme/use-theme';

import type { SectionProps } from './types';

function metricText(metric: MetricValue): string {
  if (metric.value === null) {
    return '—';
  }

  if (typeof metric.value === 'number') {
    return String(metric.value);
  }

  return `≈${formatMoney(metric.value)}`;
}

function MetricTile({ metric }: { metric: MetricValue }): ReactElement {
  const styles = useStyles();
  const value = metricText(metric);

  return (
    <View
      accessible
      accessibilityLabel={`${value} ${metric.label}, calculated automatically`}
      style={[styles.tile, metric.hot && styles.hot]}
    >
      <Text style={[styles.value, metric.hot && styles.hotText]}>{value}</Text>
      <Text style={[styles.label, metric.hot && styles.hotText]}>{metric.label}</Text>
      <Text style={[styles.auto, metric.hot && styles.hotText]}>∑</Text>
    </View>
  );
}

/** The numbers row. The unallocated tile fills with the accent while above 0. */
export function MetricSection({ data }: SectionProps<'metric'>): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      {data.metrics.map((metric) => (
        <MetricTile key={metric.label} metric={metric} />
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    minHeight: 76,
    gap: 2,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  hot: { backgroundColor: colors.accent },
  value: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  label: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.muted },
  auto: {
    position: 'absolute',
    top: 8,
    right: 10,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.faint,
  },
  hotText: { color: colors.accentInk },
}));
