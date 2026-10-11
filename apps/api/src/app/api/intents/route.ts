import {
  type CreateIntentResponse,
  createIntentRequestSchema,
  createIntentResponseSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { sessionOpener } from '#lib/ai';
import { graphErrorResponse, listIntents } from '#lib/graph';
import { readJsonBody, corsHeaders, parseBody, preflight, withUser, jsonError } from '#lib/http';
import { withHomePhotos } from '#lib/media';
import { startIntent } from '#lib/orchestrator';
import { PerceptionFailedError } from '#lib/perception';
import { runWorker } from '#lib/runs';
import { getAdminClient, getUserClient } from '#lib/supabase';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

// Each outcome's status (job search spec, section 2). A new outcome must name its own.
const CREATE_STATUS: Record<CreateIntentResponse['outcome'], number> = {
  started: 201,
  awaiting_resume: 201,
  unsupported: 201,
  existing_search: 200,
};

// The worker claims the run that fills in a new trip in `after()`, once the response is sent.
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Home's cards, with their stops' cached photos. */
export const GET = withUser(headers, async (request, user) => {
  try {
    const listed = await listIntents(getUserClient(user.accessToken));
    // The user's own summaries name the keys; the secret-key client reads the shared cache.
    const items = await withHomePhotos(getAdminClient, listed);

    return Response.json(intentListResponseSchema.parse({ items }), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not load your plans', headers);
  }
});

/**
 * Starts a plan from a goal (spec section F; job search spec, section 2). Jev picks the
 * template: a trip is seeded at once and a run fills it in after the response (`started`); a
 * job search is seeded and waits for its resume (`awaiting_resume`); a second job search
 * answers with the first (`existing_search`); and a goal no template fits is saved with no plan
 * (`unsupported`). If Jev can't read the goal, it answers 503 and writes nothing.
 */
export const POST = withUser(headers, async (request, user) => {
  const read = await readJsonBody(request, headers);

  if (read instanceof Response) {
    return read;
  }

  const parsed = parseBody(
    createIntentRequestSchema,
    read.body,
    'Describe what you are planning in 3 to 500 characters.',
    headers,
  );

  if (parsed instanceof Response) {
    return parsed;
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
      parsed.data.timezone ?? 'UTC',
    );
    const body = createIntentResponseSchema.parse(started);

    return Response.json(body, { status: CREATE_STATUS[body.outcome], headers });
  } catch (error) {
    // Nexui doesn't guess a template; the + sheet keeps the goal so a retry is one tap.
    if (error instanceof PerceptionFailedError) {
      return jsonError(error.message, 503, headers);
    }

    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
});
