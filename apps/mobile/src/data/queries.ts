import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  applyOps,
  isActiveRunStatus,
  type AskResponse,
  type CapabilityRequest,
  type ChangesetOp,
  type ChangesResponse,
  type CommitResponse,
  type CreateIntentResponse,
  type GraphSnapshot,
  type IntentListItem,
  type IntentMedia,
  type PlaceAbout,
  type RunRecord,
} from '@nexui/types';

import {
  askIntent,
  callCapability,
  cancelRun,
  createIntent,
  deleteIntent,
  getIntent,
  getPlaceMedia,
  getRun,
  listChanges,
  listIntents,
  undoEvent,
} from './api';
import { ApiError } from './api-request';
import {
  mediaKeyIds,
  mediaPollInterval,
  mediaStaleTime,
  placeAbout,
  placePhotos,
  type MediaQueryState,
  type PhotoState,
} from './place-media';
import { planDeletes, type DeleteAttempt, type PlanDeletes } from './plan-deletes';

export const queryKeys = {
  intents: ['intents'] as const,
  intent: (id: string): readonly ['intent', string] => ['intent', id] as const,
  media: (intentId: string, ids: string): readonly ['media', string, string] =>
    ['media', intentId, ids] as const,
  runs: ['run'] as const,
  run: (id: string): readonly ['run', string] => ['run', id] as const,
  changes: ['changes'] as const,
  changesFeed: ['changes', 'feed'] as const,
  recentChanges: ['changes', 'recent'] as const,
};

/** Every workspace edit on one intent shares this key; they run one at a time, in tap order. */
export const editKey = (intentId: string): readonly ['edit', string] => ['edit', intentId] as const;

export function isRunActive(run: RunRecord | undefined): boolean {
  return isActiveRunStatus(run?.status);
}

/** Nexui is still writing to this plan (its card reads Drafting). */
export function isDrafting(item: IntentListItem): boolean {
  return item.summary.badge?.tone === 'running';
}

function anyDrafting(items: IntentListItem[] | undefined): boolean {
  return items?.some(isDrafting) ?? false;
}

/**
 * Home's cards. Polls while any plan is Drafting, since `intents` isn't on Realtime. Also
 * invalidates `changes` once the moment nothing is Drafting any more, to catch a run's last
 * change even if it landed just before this poll saw the plan settle.
 */
export function useIntents(): UseQueryResult<IntentListItem[], Error> {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.intents,
    queryFn: ({ signal }) => listIntents(signal),
    refetchInterval: (current) => (anyDrafting(current.state.data) ? 4_000 : false),
  });
  const drafting = anyDrafting(query.data);
  const wasDrafting = useRef(drafting);

  useEffect(() => {
    if (wasDrafting.current && !drafting) {
      void client.invalidateQueries({ queryKey: queryKeys.changes });
    }

    wasDrafting.current = drafting;
  }, [drafting, client]);

  return query;
}

/**
 * One intent's snapshot: the cache every workspace section reads. `poll` refetches every 4 s
 * while the plan is Drafting, since only Realtime covers that otherwise, and skips a tick a
 * workspace edit is in flight for, so a refetch can't overwrite an optimistic change.
 */
export function useIntent(
  id: string | null,
  options: { poll?: boolean } = {},
): UseQueryResult<GraphSnapshot, Error> {
  const client = useQueryClient();
  const poll = options.poll ?? false;

  return useQuery({
    queryKey: queryKeys.intent(id ?? ''),
    queryFn: ({ signal }) => getIntent(id ?? '', signal),
    enabled: id !== null,
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 1,
    refetchInterval: () =>
      poll && client.isMutating({ mutationKey: editKey(id ?? '') }) === 0 ? 4_000 : false,
  });
}

/**
 * Wikipedia details for an intent's places, keyed by its sorted place ids so a stop the model
 * adds starts a fetch. While any lookup is pending it asks again every 2 seconds, up to ten
 * times. The last answer stays on screen while a new key loads.
 */
export function usePlaceMedia(
  intentId: string,
  placeIds: readonly string[],
): UseQueryResult<IntentMedia, Error> {
  const ids = mediaKeyIds(placeIds);

  return useQuery({
    queryKey: queryKeys.media(intentId, ids),
    queryFn: ({ signal }) => getPlaceMedia(intentId, signal),
    enabled: ids.length > 0,
    staleTime: (query) => mediaStaleTime(query.state.data),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => mediaPollInterval(query.state.data, query.state.dataUpdateCount),
  });
}

// One intent's media and how far its query has got, for `placeAbout` and `placePhotos`.
function useMediaAnswers(
  intentId: string,
  placeIds: readonly string[],
): { media: IntentMedia | undefined; query: MediaQueryState } {
  const client = useQueryClient();
  const media = usePlaceMedia(intentId, placeIds);
  const answers =
    client.getQueryState(queryKeys.media(intentId, mediaKeyIds(placeIds)))?.dataUpdateCount ?? 0;

  return {
    media: media.data,
    query: { loading: media.isPending || media.isPlaceholderData, answers },
  };
}

/**
 * What a stop sheet's About shows for one place (`placeAbout`), from the same query as
 * `usePlaceMedia`. A lookup still pending once the polls have run out shows nothing.
 */
export function usePlaceAbout(
  intentId: string,
  placeIds: readonly string[],
  placeId: string,
): PlaceAbout | 'pending' | null {
  const { media, query } = useMediaAnswers(intentId, placeIds);

  return placeAbout(media, placeId, query);
}

/**
 * Every place's photo slot by id (`placePhotos`), from the same query as `usePlaceMedia`, so
 * calling it also starts the plan's lookups.
 */
export function usePlacePhotos(
  intentId: string,
  placeIds: readonly string[],
): Readonly<Record<string, PhotoState>> {
  const { media, query } = useMediaAnswers(intentId, placeIds);

  return placePhotos(media, placeIds, query);
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

/**
 * The newest few events, for Home's "What changed". Polls on the same cadence as `useIntents`
 * while any plan is Drafting, since a run's changes aren't on Realtime when no workspace is open.
 */
export function useRecentChanges(): UseQueryResult<ChangesResponse, Error> {
  const client = useQueryClient();

  return useQuery({
    queryKey: queryKeys.recentChanges,
    queryFn: ({ signal }) => listChanges({ limit: 10 }, signal),
    refetchInterval: () =>
      anyDrafting(client.getQueryData<IntentListItem[]>(queryKeys.intents)) ? 4_000 : false,
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
 * so an earlier answer never wipes a later tap. Only the last edit to fail refetches the
 * server's state too; an earlier failure leaves later taps' optimistic ops in place, since their
 * own success or error settles the cache.
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
      if (client.isMutating({ mutationKey: editKey(intentId) }) === 1) {
        void client.invalidateQueries({ queryKey: key });
      }
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

const deleteKey = ['deleteIntent'] as const;

/**
 * Deletes a plan for good. Home hides its card while the delete is pending (`usePlanDeletes`),
 * so a failure just shows it again; a plan that's already gone counts as deleted. Its changes go
 * with it, so the change feeds refetch too.
 */
export function useDeleteIntent(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationKey: deleteKey,
    mutationFn: async (id) => {
      try {
        await deleteIntent(id);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          throw error;
        }
      }
    },
    onSuccess: (_result, id) => {
      client.setQueryData<IntentListItem[]>(queryKeys.intents, (items) =>
        items?.filter((item) => item.id !== id),
      );
      client.removeQueries({ queryKey: queryKeys.intent(id) });
    },
    onSettled: () => refreshLists(client),
  });
}

/**
 * The plans being deleted right now and those whose delete failed, from every delete still in
 * the mutation cache (a failure is dropped with its mutation, after 5 minutes).
 */
export function usePlanDeletes(): PlanDeletes {
  const attempts = useMutationState({
    filters: { mutationKey: deleteKey },
    select: (mutation): DeleteAttempt => ({
      id: String(mutation.state.variables),
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
    }),
  });

  return planDeletes(attempts);
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
