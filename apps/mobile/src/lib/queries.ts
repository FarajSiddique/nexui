import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  applyOps,
  type AskResponse,
  type CapabilityRequest,
  type ChangesetOp,
  type ChangesResponse,
  type CommitResponse,
  type CreateIntentResponse,
  type GraphSnapshot,
  type IntentListItem,
  type RunRecord,
} from '@nexui/types';

import {
  askIntent,
  callCapability,
  cancelRun,
  createIntent,
  getIntent,
  getRun,
  listChanges,
  listIntents,
  undoEvent,
} from './api';
import { ApiError } from './api-request';

export const queryKeys = {
  intents: ['intents'] as const,
  intent: (id: string) => ['intent', id] as const,
  runs: ['run'] as const,
  run: (id: string) => ['run', id] as const,
  changes: ['changes'] as const,
  changesFeed: ['changes', 'feed'] as const,
  recentChanges: ['changes', 'recent'] as const,
};

/** Every workspace edit on one intent shares this key; they run one at a time, in tap order. */
export const editKey = (intentId: string) => ['edit', intentId] as const;

export function isRunActive(run: RunRecord | undefined): boolean {
  return run?.status === 'queued' || run?.status === 'running';
}

/** Home's cards. Polls while any plan is Drafting, since `intents` isn't on Realtime. */
export function useIntents(): UseQueryResult<IntentListItem[], Error> {
  return useQuery({
    queryKey: queryKeys.intents,
    queryFn: ({ signal }) => listIntents(signal),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.summary.badge?.tone === 'running') ? 4_000 : false,
  });
}

/** One intent's snapshot: the cache every workspace section reads. */
export function useIntent(id: string | null): UseQueryResult<GraphSnapshot, Error> {
  return useQuery({
    queryKey: queryKeys.intent(id ?? ''),
    queryFn: ({ signal }) => getIntent(id ?? '', signal),
    enabled: id !== null,
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 1,
  });
}

/** A run's status and progress. Realtime refetches it; the poll covers a dropped socket. */
export function useRun(id: string | null): UseQueryResult<RunRecord, Error> {
  return useQuery({
    queryKey: queryKeys.run(id ?? ''),
    queryFn: ({ signal }) => getRun(id ?? '', signal),
    enabled: id !== null,
    refetchInterval: (query) => (isRunActive(query.state.data) ? 3_000 : false),
  });
}

export function useChangesFeed(): UseInfiniteQueryResult<
  InfiniteData<ChangesResponse, string | undefined>,
  Error
> {
  return useInfiniteQuery({
    queryKey: queryKeys.changesFeed,
    queryFn: ({ pageParam, signal }) => listChanges({ cursor: pageParam, limit: 50 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The newest few events, for Home's "What changed". */
export function useRecentChanges(): UseQueryResult<ChangesResponse, Error> {
  return useQuery({
    queryKey: queryKeys.recentChanges,
    queryFn: ({ signal }) => listChanges({ limit: 10 }, signal),
  });
}

function refreshLists(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.changes });
  void client.invalidateQueries({ queryKey: queryKeys.intents });
}

// An op that no longer fits (the object vanished) just isn't shown; the server answer follows.
function showOptimistic(current: GraphSnapshot, ops: ChangesetOp[]): GraphSnapshot {
  try {
    return applyOps(current, ops, new Date().toISOString());
  } catch {
    return current;
  }
}

export interface WorkspaceEdit {
  request: CapabilityRequest;
  /** Applied to the cached snapshot at once, for display. */
  optimistic: ChangesetOp[];
}

/**
 * Sends workspace edits one at a time, in tap order (a shared mutation scope). Each shows at
 * once through its optimistic ops. Only the last edit to finish writes the server's snapshot,
 * so an earlier answer never wipes a later tap. A failure refetches the server's state.
 */
export function useWorkspaceEdit(
  intentId: string,
): UseMutationResult<CommitResponse, Error, WorkspaceEdit> {
  const client = useQueryClient();
  const key = queryKeys.intent(intentId);

  return useMutation({
    mutationKey: editKey(intentId),
    scope: { id: `edit-${intentId}` },
    mutationFn: (edit) => callCapability(intentId, edit.request),
    onMutate: async (edit) => {
      if (edit.optimistic.length === 0) {
        return;
      }

      await client.cancelQueries({ queryKey: key });
      client.setQueryData<GraphSnapshot>(key, (current) =>
        current ? showOptimistic(current, edit.optimistic) : current,
      );
    },
    onSuccess: (result) => {
      if (client.isMutating({ mutationKey: editKey(intentId) }) === 1) {
        client.setQueryData(key, result.snapshot);
      }
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: key });
    },
    onSettled: () => refreshLists(client),
  });
}

/** Undo, or Redo when given an Undo event. */
export function useUndo(): UseMutationResult<CommitResponse, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: undoEvent,
    onSuccess: (result) => {
      client.setQueryData(queryKeys.intent(result.snapshot.intent.id), result.snapshot);
      refreshLists(client);
    },
  });
}

export function useCreateIntent(): UseMutationResult<CreateIntentResponse, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: createIntent,
    onSuccess: (result) => {
      client.setQueryData(queryKeys.intent(result.snapshot.intent.id), result.snapshot);
      refreshLists(client);
    },
  });
}

export function useAsk(): UseMutationResult<
  AskResponse,
  Error,
  { intentId: string; text: string }
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ intentId, text }) => askIntent(intentId, text),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.intents });
    },
  });
}

export function useCancelRun(): UseMutationResult<RunRecord, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: cancelRun,
    onSuccess: (run) => {
      client.setQueryData(queryKeys.run(run.id), run);
    },
  });
}
