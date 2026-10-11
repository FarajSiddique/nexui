import { jsonError } from './responses.ts';

/** A file a request uploaded, read into memory. Nexui never stores it. */
export interface Upload {
  bytes: Uint8Array;
  /** The name the device gave it, cut to 200 characters. */
  name: string;
  /** Its declared media type; `%PDF-` is still checked before it is read. */
  type: string;
}

/** The largest file `start` and `resume` take: 4 MB, under Vercel's 4.5 MB request limit. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Room for the multipart boundary and headers around the file.
const FORM_OVERHEAD = 64 * 1024;

const TOO_LARGE = 'That file is over 4 MB.';
const UNREADABLE_FORM = 'That upload could not be read.';

/**
 * Reads an optional file from a multipart request's `file` field. Returns `{ file }`, null
 * when the request carries none (an empty body is "start without"), or the response to send:
 * 413 over 4 MB, 400 for a body that isn't a file upload.
 *
 * @example
 * const upload = await readUpload(request, headers);
 *
 * if (upload instanceof Response) {
 *   return upload;
 * }
 */
export async function readUpload(
  request: Request,
  headers: HeadersInit,
): Promise<{ file: Upload | null } | Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + FORM_OVERHEAD) {
    return jsonError(TOO_LARGE, 413, headers);
  }

  const type = request.headers.get('content-type') ?? '';

  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    const text = await request.text().catch(() => null);

    return text === '' ? { file: null } : jsonError(UNREADABLE_FORM, 400, headers);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return jsonError(UNREADABLE_FORM, 400, headers);
  }

  const entry = form.get('file');

  if (entry === null) {
    return { file: null };
  }

  if (typeof entry === 'string') {
    return jsonError(UNREADABLE_FORM, 400, headers);
  }

  if (entry.size > MAX_UPLOAD_BYTES) {
    return jsonError(TOO_LARGE, 413, headers);
  }

  return {
    file: {
      bytes: new Uint8Array(await entry.arrayBuffer()),
      name: entry.name.slice(0, 200),
      type: entry.type,
    },
  };
}
