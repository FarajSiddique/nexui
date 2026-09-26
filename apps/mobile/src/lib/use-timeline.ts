import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { ItemKind, SavedTask, TasksResponse } from '@nexui/types';
import { useMemo } from 'react';

import { getTasks, getTimelinePage, updateItem } from './api';
import { showCompletionUndo, showUndoStatus } from '@/stores/use-undo-store';

/**
 * Every list of saved items lives under `['items']`, one key per kind, so a save can
 * refresh the list it belongs to and Undo or an edit can refresh them all.
 *
 * @example
 * itemsKey('task') // ['items', 'task']: the Tasks tab
 * itemsKey('note') // ['items', 'note']: the Notes tab
 */
export const ITEMS_KEY = ['items'] as const;

export function itemsKey(kind: ItemKind): QueryKey {
  return [...ITEMS_KEY, kind];
}

/** Open tasks for the Tasks tab, due first and no date last (one request, up to 300). */
export function useTasks() {
  return useQuery({
    queryKey: itemsKey('task'),
    queryFn: ({ signal }) => getTasks(signal),
  });
}

/** Saved notes for the Notes tab, newest first, 50 per page. */
export function useNotes() {
  const query = useInfiniteQuery({
    queryKey: itemsKey('note'),
    queryFn: ({ pageParam, signal }) => getTimelinePage(pageParam, 'note', signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return { ...query, items };
}

/**
 * Completes a task: it leaves the list at once, the server keeps it for 30 days, and the
 * card offers Undo. If the server refuses, the refetch brings the task back (restoring a
 * snapshot could undo a sibling completion that succeeded meanwhile).
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: SavedTask) => updateItem(task, { completed: true }),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ITEMS_KEY });
      queryClient.setQueryData<TasksResponse>(itemsKey('task'), (data) =>
        data ? { items: data.items.filter((item) => item.id !== task.id) } : data,
      );
    },
    onSuccess: (_saved, task) => showCompletionUndo(task, `Marked done: ${task.title}`),
    onError: () => {
      showUndoStatus('Could not mark it done. Check your connection.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ITEMS_KEY }),
  });
}
