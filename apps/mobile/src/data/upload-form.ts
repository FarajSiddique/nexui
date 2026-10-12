import { MAX_UPLOAD_BYTES } from '@nexui/types';

import { ApiError } from './api-request.ts';

/** A file on the device that can be read whole, such as `expo-file-system`'s `File`. */
export interface DeviceFile {
  bytes(): Promise<Uint8Array>;
}

/**
 * A PDF the user picked (job search spec, section 4), with its name and usually its size. On
 * web the picker hands over the `File` itself; on iOS and Android, its copy in the app's cache.
 */
export type PickedPdf = { name: string; size: number | null } & (
  { file: Blob } | { copy: DeviceFile }
);

/** The API's own refusal for a file over 4 MB, so the app can say it before sending. */
export const TOO_LARGE = 'That file is over 4 MB.';

/** What the app says when the picked file can't be read off the phone. */
export const UNREADABLE_FILE = "Couldn't read that file. Pick it again.";

/** Why a picked PDF can't be sent, or null to send it. */
export function checkPdf(pdf: Pick<PickedPdf, 'size'>): string | null {
  return pdf.size !== null && pdf.size > MAX_UPLOAD_BYTES ? TOO_LARGE : null;
}

/**
 * Adds the PDF as the `file` field `start` and `resume` read. A browser takes the `File`. On a
 * phone, Expo's fetch builds the multipart body itself and sends a part from its `name`, `type`
 * and `bytes()`; it throws on React Native's `{ uri }` part. The cache copy is named by a UUID,
 * so the part carries the name the user picked.
 *
 * The copy is read here, before the request: a read that fails inside fetch would show as
 * "Nexui can't reach its server", so it fails here with `UNREADABLE_FILE`.
 */
export async function appendPdf(form: Pick<FormData, 'append'>, pdf: PickedPdf): Promise<void> {
  if ('file' in pdf) {
    form.append('file', pdf.file, pdf.name);

    return;
  }

  let bytes: Uint8Array;

  try {
    bytes = await pdf.copy.bytes();
  } catch {
    throw new ApiError(UNREADABLE_FILE, 0);
  }

  // Expo's own file part, which the DOM's FormData typing doesn't know.
  form.append('file', {
    name: pdf.name,
    type: 'application/pdf',
    bytes: () => Promise.resolve(bytes),
  } as unknown as Blob);
}
