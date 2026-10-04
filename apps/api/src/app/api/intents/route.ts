import {
  createIntentRequestSchema,
  createIntentResponseSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { sessionOpener } from '#lib/ai';
import { graphErrorResponse, listIntents } from '#lib/graph';
import { readJsonBody, corsHeaders, jsonError, preflight } from '#lib/http';
import { withHomePhotos } from '#lib/media';
import { startIntent } from '#lib/orchestrator';
import { runWorker } from '#lib/runs';
import { getAdminClient, getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

// The worker claims the run that fills in a new trip in `after()`, once the response is sent.
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Home's cards, with their stops' cached photos. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const listed = await listIntents(getUserClient(user.accessToken));
    // The user's own summaries name the keys; the secret-key client reads the shared cache.
    const items = await withHomePhotos(getAdminClient(), listed);

    return Response.json(intentListResponseSchema.parse({ items }), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not load your plans', headers);
  }
}

/**
 * Starts a plan from a goal (spec section F): Jev picks the template, the trip and workspace are
 * seeded at once, and a run fills them in after the response. Answers `{ snapshot, runId }`.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const read = await readJsonBody(request, headers);

  if (read instanceof Response) {
    return read;
  }

  const parsed = createIntentRequestSchema.safeParse(read.body);

  if (!parsed.success) {
    return jsonError('Describe what you are planning in 3 to 500 characters.', 400, headers);
  }

  try {
    const started = await startIntent(
      {
        db: getUserClient(user.accessToken),
        userId: user.userId,
        openSession: sessionOpener(),
        worker: runWorker(),
      },
      parsed.data.goal,
    );

    return Response.json(createIntentResponseSchema.parse(started), { status: 201, headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
}
