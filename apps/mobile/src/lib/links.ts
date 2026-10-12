const OPENABLE = new Set(['https:', 'mailto:']);

/**
 * The URL a `link` action may hand the system, or null: only an https page or a `mailto:`
 * message opens, as the URL it parses to, so a stored link can't dial, run script or open a file.
 *
 * @example
 * openableUrl('https://en.wikipedia.org/wiki/Kyoto') // 'https://en.wikipedia.org/wiki/Kyoto'
 * openableUrl('tel:+441234567890') // null
 */
export function openableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    return OPENABLE.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
