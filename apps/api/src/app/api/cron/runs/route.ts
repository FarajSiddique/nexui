import { logLine } from '#lib/graph';
import { jsonError, verifyCronRequest } from '#lib/http';
import { runWorker, sweepRuns } from '#lib/runs';

// Server to server, so no CORS headers.
const headers = { 'Cache-Control': 'no-store' };

// The runs this sweep claims execute in `after()`, once the response is sent.
export const maxDuration = 300;

/**
 * The run queue's safety net, which Vercel Cron calls every minute (`apps/api/vercel.json`): it
 * settles runs whose worker is gone and starts runs nobody claimed. Answers
 * `{ reaped, claimed }`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = verifyCronRequest(request, headers);

  if (refused) {
    return refused;
  }

  try {
    const swept = await sweepRuns(runWorker());

    return Response.json(swept, { headers });
  } catch (error) {
    console.error('[cron]', logLine(error, 'Could not sweep runs'));

    return jsonError('Could not sweep runs.', 500, headers);
  }
}
