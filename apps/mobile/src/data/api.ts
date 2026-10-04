import {
  askResponseSchema,
  changesResponseSchema,
  commitResponseSchema,
  createIntentResponseSchema,
  deleteAccountResponseSchema,
  graphSnapshotSchema,
  healthResponseSchema,
  intentListResponseSchema,
  intentMediaSchema,
  runRecordSchema,
  type AskResponse,
  type CapabilityRequest,
  type ChangesResponse,
  type CommitResponse,
  type CreateIntentResponse,
  type DeleteAccountRequest,
  type DeleteAccountResponse,
  type GraphSnapshot,
  type HealthResponse,
  type IntentListItem,
  type IntentMedia,
  type RunRecord,
} from '@nexui/types';

import { fetchWithSession } from './authenticated-fetch';
import { requestJson, type Parser } from './api-request.ts';
import { supabase } from './supabase';

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  }

  signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 5_000);

  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Health request failed: ${response.status}`);
    }

    const body: unknown = await response.json();

    return healthResponseSchema.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function callApi<T>(
  path: string,
  parser: Parser<T>,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  return requestJson(
    (url, request) => fetchWithSession(supabase.auth, url, request),
    `${apiUrl}${path}`,
    init,
    parser,
    timeoutMs,
  );
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Permanently deletes the signed-in user's account. Pass Apple's authorization code to revoke
 * Nexui's Apple access too. Allows 20 s: the server may call Apple twice after deleting, and
 * giving up early would report an account that's already gone as a failure.
 */
export function deleteAccount(appleAuthorizationCode?: string): Promise<DeleteAccountResponse> {
  const body: DeleteAccountRequest = {};

  if (appleAuthorizationCode) {
    body.appleAuthorizationCode = appleAuthorizationCode;
  }

  return callApi(
    '/api/account',
    deleteAccountResponseSchema,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    20_000,
  );
}

/** Home's cards, most recently active first. */
export async function listIntents(signal?: AbortSignal): Promise<IntentListItem[]> {
  const page = await callApi('/api/intents', intentListResponseSchema, { signal });

  return page.items;
}

/** One intent with its workspace and every live object and relationship. */
export function getIntent(id: string, signal?: AbortSignal): Promise<GraphSnapshot> {
  return callApi(`/api/intents/${id}`, graphSnapshotSchema, { signal });
}

/** Wikipedia details for every place in an intent; places still being looked up are pending. */
export function getPlaceMedia(intentId: string, signal?: AbortSignal): Promise<IntentMedia> {
  return callApi(`/api/intents/${intentId}/media`, intentMediaSchema, { signal });
}

// A 204 answer has no body to parse.
const noContent: Parser<void> = { parse: () => undefined };

/** Deletes a plan for good, with its whole graph and change history. */
export function deleteIntent(id: string): Promise<void> {
  return callApi(`/api/intents/${id}`, noContent, { method: 'DELETE' });
}

/** Starts a plan from a goal; a trip also starts the run that fills it in. */
export function createIntent(goal: string): Promise<CreateIntentResponse> {
  return callApi('/api/intents', createIntentResponseSchema, postJson({ goal }));
}

/** Asks Nexui to change an intent. Answers at once with the run doing the work. */
export function askIntent(id: string, text: string): Promise<AskResponse> {
  return callApi(`/api/intents/${id}/ask`, askResponseSchema, postJson({ text }));
}

/** A button or edit: one user-callable capability, committed like a changeset. */
export function callCapability(
  intentId: string,
  request: CapabilityRequest,
): Promise<CommitResponse> {
  return callApi(`/api/intents/${intentId}/capabilities`, commitResponseSchema, postJson(request));
}

export function getRun(id: string, signal?: AbortSignal): Promise<RunRecord> {
  return callApi(`/api/runs/${id}`, runRecordSchema, { signal });
}

/** Stops a run after its current step; what it already wrote stays. */
export function cancelRun(id: string): Promise<RunRecord> {
  return callApi(`/api/runs/${id}/cancel`, runRecordSchema, { method: 'POST' });
}

/** One page of Changes, newest first. */
export function listChanges(
  query: { cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<ChangesResponse> {
  const params = new URLSearchParams();

  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }

  if (query.cursor !== undefined) {
    params.set('cursor', query.cursor);
  }

  return callApi(`/api/changes?${params.toString()}`, changesResponseSchema, { signal });
}

/** Undo a change; on an Undo event this is Redo. */
export function undoEvent(eventId: string): Promise<CommitResponse> {
  return callApi(`/api/events/${eventId}/undo`, commitResponseSchema, { method: 'POST' });
}
