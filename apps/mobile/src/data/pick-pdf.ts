import * as DocumentPicker from 'expo-document-picker';
import { File as DeviceFile } from 'expo-file-system';

import { checkPdf, type PickedPdf } from './upload-form';

/** What picking ended with: the PDF, why it can't be sent, or null when the user cancelled. */
export type PdfChoice = { pdf: PickedPdf } | { problem: string } | null;

/**
 * Opens the system's document picker for one PDF and checks it can be sent (job search spec,
 * section 4). The API checks again, and reads the file's first bytes to be sure it's a PDF.
 */
export async function choosePdf(): Promise<PdfChoice> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];

  if (!asset) {
    return null;
  }

  const details = { name: asset.name, size: asset.size ?? null };
  // Only web hands over the File; a phone gives the uri of the picker's copy in the cache.
  const pdf: PickedPdf = asset.file
    ? { ...details, file: asset.file }
    : { ...details, copy: new DeviceFile(asset.uri) };
  const problem = checkPdf(pdf);

  return problem ? { problem } : { pdf };
}
