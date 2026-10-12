import { MAX_UPLOAD_BYTES } from '@nexui/types';

import { jsonError } from './responses.ts';

/** A file a request uploaded, read into memory. Nexui never stores it. */
export interface Upload {
  bytes: Uint8Array;
  /** The name the device gave it, percent-decoded and cut to 200 characters. */
  name: string;
  /** Its declared media type; `%PDF-` is still checked before it is read. */
  type: string;
}

// Room for the multipart boundary and headers around the file.
const FORM_OVERHEAD = 64 * 1024;

const TOO_LARGE = 'That file is over 4 MB.';
const UNREADABLE_FORM = 'That upload could not be read.';

// Expo's fetch on a phone percent-encodes the file name (`Jordan%20Lee%20CV.pdf`). A browser
// sends the name as it is, so a web file literally named `50%25.pdf` is stored as `50%.pdf`; the
// name is only a label. A name that isn't valid percent-encoding is kept as it came.
function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// The first 200 characters, without leaving half of one that takes two, such as an emoji.
function cutName(name: string): string {
  const cut = name.slice(0, 200);

  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

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
      name: cutName(decodeName(entry.name)),
      type: entry.type,
    },
  };
}
