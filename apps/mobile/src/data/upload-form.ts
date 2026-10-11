import { MAX_UPLOAD_BYTES } from '@nexui/types';

/**
 * A PDF the user picked (job search spec, section 4). On web the picker hands over the `File`
 * itself; on iOS and Android, a `uri` the upload streams from, with its name and usually its
 * size.
 */
export interface PickedPdf {
  uri: string;
  name: string;
  size: number | null;
  file: Blob | null;
}

/** The API's own refusal for a file over 4 MB, so the app can say it before sending. */
export const TOO_LARGE = 'That file is over 4 MB.';

/** Why a picked PDF can't be sent, or null to send it. */
export function checkPdf(pdf: Pick<PickedPdf, 'size'>): string | null {
  return pdf.size !== null && pdf.size > MAX_UPLOAD_BYTES ? TOO_LARGE : null;
}

/**
 * Adds the PDF as the `file` field `start` and `resume` read. React Native's FormData takes a
 * `{ uri, name, type }` part for a file on the device; a browser takes the `File`.
 */
export function appendPdf(form: Pick<FormData, 'append'>, pdf: PickedPdf): void {
  if (pdf.file) {
    form.append('file', pdf.file, pdf.name);

    return;
  }

  // React Native's own file part, which the DOM's FormData typing doesn't know.
  form.append('file', {
    uri: pdf.uri,
    name: pdf.name,
    type: 'application/pdf',
  } as unknown as Blob);
}
