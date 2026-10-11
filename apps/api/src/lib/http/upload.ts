/** A file a request uploaded, read into memory. Nexui never stores it. */
export interface Upload {
  bytes: Uint8Array;
  /** The name the device gave it, cut to 200 characters. */
  name: string;
  /** Its declared media type; `%PDF-` is still checked before it is read. */
  type: string;
}
