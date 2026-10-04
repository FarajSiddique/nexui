import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useChangesFeed, useUndo } from '@/data/queries';
import {
  buildChangeRows,
  filterRows,
  groupByDay,
  type ChangeFilter,
} from '@/features/changes/change-feed';
import { ChangeRowView } from '@/features/changes/change-row';
import { fonts } from '@/theme/theme';
import { createThemedStyles, useColors } from '@/theme/use-theme';
import { Button } from '@/ui/buttons';
import { ListEmpty, ListError, RefetchNotice, SkeletonRows } from '@/ui/list-states';
import { TabHeader } from '@/ui/tab-header';

const FILTERS: { value: ChangeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'you', label: 'You' },
  { value: 'nexui', label: 'Nexui' },
  { value: 'auto', label: 'Auto-calculated' },
];

/** Every change you, Nexui or a calculation made, grouped by day, with Undo and Redo. */
export default function ChangesScreen(): ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const feed = useChangesFeed();
  const { refetch } = feed;
  const undo = useUndo();
  const [filter, setFilter] = useState<ChangeFilter>('all');

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const rows = useMemo(
    () => buildChangeRows(feed.data?.pages.flatMap((page) => page.items) ?? []),
    [feed.data],
  );
  const now = new Date();
  const groups = groupByDay(filterRows(rows, filter), now);
  const pendingId = undo.isPending ? undo.variables : null;

  const renderFeed = (): ReactElement => {
    if (feed.isPending) {
      return <SkeletonRows count={5} />;
    }

    if (feed.isLoadingError) {
      return <ListError message={feed.error.message} onRetry={() => void feed.refetch()} />;
    }

    if (rows.length === 0) {
      return <ListEmpty text="Every change you or Nexui make will show here, with Undo." />;
    }

    if (groups.length === 0) {
      return <ListEmpty text="Nothing here for this filter yet." />;
    }

    return (
      <View style={styles.groups}>
        {groups.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text accessibilityRole="header" style={styles.day}>
              {group.label}
            </Text>
            <View style={styles.card}>
              {group.rows.map((row) => (
                <ChangeRowView
                  key={row.key}
                  row={row}
                  now={now}
                  pending={row.revert !== null && pendingId === row.revert.eventId}
                  onRevert={(eventId) => undo.mutate(eventId)}
                />
              ))}
            </View>
          </View>
        ))}
        {feed.hasNextPage ? (
          <Button
            label="Show older changes"
            busy={feed.isFetchingNextPage}
            onPress={() => void feed.fetchNextPage()}
          />
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => void feed.refetch()}
            tintColor={colors.muted}
          />
        }
      >
        <TabHeader title="Changes" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((option) => {
            const selected = option.value === filter;

            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(option.value)}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {feed.isRefetchError ? <RefetchNotice subject="changes" style={styles.notice} /> : null}
        {undo.isError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {undo.error.message}
          </Text>
        ) : null}
        {renderFeed()}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
  // A horizontal ScrollView grows by default; in the growing column it would absorb the spare
  // height whenever the filtered feed is short, stretching the chips.
  filterBar: { flexGrow: 0 },
  filters: { gap: 8, paddingVertical: 12 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.userMark },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  chipTextOn: { color: colors.card },
  notice: { marginBottom: 8 },
  error: {
    marginBottom: 8,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  groups: { gap: 16 },
  group: { gap: 6 },
  day: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
}));
