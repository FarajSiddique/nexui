import type { SavedItem } from '@nexui/types';
import { useMemo, useState, type ReactElement } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionBanner } from '@/components/connection-banner';
import { EditSheet } from '@/components/edit-sheet';
import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { TimelineRow } from '@/components/timeline-row';
import { localToday } from '@/lib/form-values';
import { filterItems } from '@/lib/item-filter';
import { groupTasks, taskDueLabel } from '@/lib/task-groups';
import { colors, fonts } from '@/lib/theme';
import { useCompleteTask, useTasks } from '@/lib/use-timeline';

// Open tasks in Today · Upcoming · No date. Checking one off removes it; Undo brings it back.
export default function TasksScreen(): ReactElement {
  const tasks = useTasks();
  const completeTask = useCompleteTask();
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedItem | null>(null);
  const today = localToday();
  const sections = useMemo(
    () => groupTasks(filterItems(tasks.data?.items ?? [], filter ?? ''), today),
    [tasks.data, filter, today],
  );

  let emptyState = <ListEmpty text="Nothing to do. Tap + to add a task." />;

  if (tasks.isPending) {
    emptyState = <SkeletonRows />;
  } else if (tasks.isError) {
    emptyState = (
      <ListError message="Could not load your tasks." onRetry={() => void tasks.refetch()} />
    );
  } else if (filter?.trim()) {
    emptyState = <ListEmpty text={`Nothing in Tasks matches “${filter.trim()}”.`} />;
  }

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        sections={sections}
        keyExtractor={(task) => task.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <TabHeader title="Tasks" filter={filter} onFilterChange={setFilter} />
            <ConnectionBanner />
          </View>
        }
        ListEmptyComponent={emptyState}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TimelineRow
            item={item}
            meta={taskDueLabel(item, today)}
            onComplete={() => completeTask.mutate(item)}
            onOpen={() => setEditing(item)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={tasks.isRefetching && !tasks.isPending}
            onRefresh={() => void tasks.refetch()}
            tintColor={colors.ink}
          />
        }
      />
      {editing ? <EditSheet item={editing} onClose={() => setEditing(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
    marginTop: 24,
    marginBottom: 2,
  },
});
