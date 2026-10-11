import { idSchema, startResponseSchema } from '@nexui/types';

import { sessionOpener } from '#lib/ai';
import { graphErrorResponse } from '#lib/graph';
import { corsHeaders, jsonError, preflight, readUpload, withUser } from '#lib/http';
import { startPlan } from '#lib/orchestrator';
import { runWorker } from '#lib/runs';
import { getUserClient } from '#lib/supabase';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

// The worker claims the build run in `after()`, once the 202 is sent: its model steps and its
// scan need the function's whole 300 seconds (spikes note 5.1's 90 fits `resume` only).
export const maxDuration = 300;

interface StartRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Starts a plan that waits for its resume (job search spec, section 4): an optional PDF of at
 * most 4 MB in the multipart field `file`, or an empty body to start without one. It reads the
 * file once, stores what it found, and queues the build run; it answers 202 with the plan, the
 * run and what the read found, or 409 once the plan has started.
 */
export const POST = withUser(
  headers,
  async (request, user, { params }: StartRouteContext): Promise<Response> => {
    const { id } = await params;

    if (!idSchema.safeParse(id).success) {
      return jsonError('Not found.', 404, headers);
    }

    const upload = await readUpload(request, headers);

    if (upload instanceof Response) {
      return upload;
    }

    try {
      const started = await startPlan(
        {
          db: getUserClient(user.accessToken),
          userId: user.userId,
          openSession: sessionOpener(),
          worker: runWorker(),
        },
        id,
        upload.file,
      );

      return Response.json(startResponseSchema.parse(started), { status: 202, headers });
    } catch (error) {
      return graphErrorResponse(error, '[start]', 'Could not start that plan', headers);
    }
  },
);
