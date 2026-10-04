type Env = Record<string, string | undefined>;

/** The media settings are malformed. `message` names the variable, never its value. */
export class MediaConfigurationError extends Error {}

export interface MediaConfig {
  /** Who Wikimedia can contact about our requests, sent in the User-Agent. Null: lookups off. */
  contact: string | null;
}

const EMAIL = /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/;
const WEB_ADDRESS = /^https?:\/\/[^\s()]+$/;

/**
 * Reads the media settings. Without `WIKIMEDIA_CONTACT` (an email address or URL Wikimedia can
 * reach us at), lookups are off and only places already cached get details.
 *
 * @example
 * readMediaConfig({ WIKIMEDIA_CONTACT: 'ops@nexui.app' }).contact // 'ops@nexui.app'
 */
export function readMediaConfig(env: Env = process.env): MediaConfig {
  const contact = env.WIKIMEDIA_CONTACT?.trim() ?? '';

  if (contact.length === 0) {
    return { contact: null };
  }

  if (contact.length > 200 || !(EMAIL.test(contact) || WEB_ADDRESS.test(contact))) {
    throw new MediaConfigurationError('WIKIMEDIA_CONTACT must be an email address or a URL.');
  }

  return { contact };
}
