import { commitResponseSchema, idSchema } from '@nexui/types';

import { sessionOpener } from '#lib/ai';
import { graphErrorResponse } from '#lib/graph';
import { corsHeaders, jsonError, preflight, readUpload, withUser } from '#lib/http';
import { replaceIntake } from '#lib/orchestrator';
import { getUserClient } from '#lib/supabase';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

// The read happens before the response, and no run follows (spikes note 5.1, item 4).
export const maxDuration = 90;

interface ResumeRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Replaces a started job search's resume (job search spec, section 4, "Later uploads"): a PDF
 * of at most 4 MB in the multipart field `file`. It answers like a changeset, which Undo
 * reverts; a file that can't be read is a 400 that changes nothing.
 */
export const POST = withUser(
  headers,
  async (request, user, { params }: ResumeRouteContext): Promise<Response> => {
    const { id } = await params;

    if (!idSchema.safeParse(id).success) {
      return jsonError('Not found.', 404, headers);
    }

    const upload = await readUpload(request, headers);

    if (upload instanceof Response) {
      return upload;
    }

    if (!upload.file) {
      return jsonError('Add a PDF.', 400, headers);
    }

    try {
      const result = await replaceIntake(
        { db: getUserClient(user.accessToken), openSession: sessionOpener() },
        id,
        upload.file,
      );

      return Response.json(commitResponseSchema.parse(result), { headers });
    } catch (error) {
      return graphErrorResponse(error, '[resume]', 'Could not replace your resume', headers);
    }
  },
);
