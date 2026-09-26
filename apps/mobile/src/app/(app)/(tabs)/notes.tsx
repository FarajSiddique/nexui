import type { SavedItem } from '@nexui/types';
import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionBanner } from '@/components/connection-banner';
import { EditSheet } from '@/components/edit-sheet';
import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { TabHeader } from '@/components/tab-header';
import { TimelineRow } from '@/components/timeline-row';
import { filterItems } from '@/lib/item-filter';
import { colors } from '@/lib/theme';
import { useNotes } from '@/lib/use-timeline';

// Saved notes, newest first (`GET /api/timeline?kind=note`), 50 at a time.
export default function NotesScreen(): ReactElement {
  const notes = useNotes();
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedItem | null>(null);
  const shown = useMemo(() => filterItems(notes.items, filter ?? ''), [notes.items, filter]);

  let emptyState = <ListEmpty text="No notes yet. Tap + and start with “note:”." />;

  if (notes.isPending) {
    emptyState = <SkeletonRows />;
  } else if (notes.isError) {
    emptyState = (
      <ListError message="Could not load your notes." onRetry={() => void notes.refetch()} />
    );
  } else if (filter?.trim()) {
    emptyState = <ListEmpty text={`Nothing in Notes matches “${filter.trim()}”.`} />;
  }

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        data={shown}
        keyExtractor={(note) => note.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <TabHeader title="Notes" filter={filter} onFilterChange={setFilter} />
            <ConnectionBanner />
          </View>
        }
        ListEmptyComponent={emptyState}
        renderItem={({ item }) => (
          <TimelineRow item={item} onComplete={() => undefined} onOpen={() => setEditing(item)} />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (notes.hasNextPage && !notes.isFetchingNextPage) {
            void notes.fetchNextPage();
          }
        }}
        ListFooterComponent={
          notes.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Loading more" style={styles.footer} />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={notes.isRefetching && !notes.isPending && !notes.isFetchingNextPage}
            onRefresh={() => void notes.refetch()}
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
  header: { marginBottom: 8 },
  footer: { marginVertical: 20 },
});
