type Env = Record<string, string | undefined>;

/** What job search's network lookups need. */
export interface JobsConfig {
  /** `NEXUI_CONTACT`: who the job boards can reach about our requests. Null: board lookups off. */
  contact: string | null;
  /** `PARALLEL_API_KEY`. Null: web search off. */
  searchKey: string | null;
}

const EMAIL = /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/;
const WEB_ADDRESS = /^https?:\/\/[^\s()]+$/;

/**
 * Reads job search's settings. A contact that isn't an email address or a URL turns board
 * lookups off, with a log line that names the variable, never its value.
 *
 * @example
 * readJobsConfig({ NEXUI_CONTACT: 'ops@nexui.app' }) // { contact: 'ops@nexui.app', searchKey: null }
 */
export function readJobsConfig(env: Env = process.env): JobsConfig {
  const contact = env.NEXUI_CONTACT?.trim() ?? '';
  const searchKey = env.PARALLEL_API_KEY?.trim() ?? '';
  const valid =
    contact.length > 0 &&
    contact.length <= 200 &&
    (EMAIL.test(contact) || WEB_ADDRESS.test(contact));

  if (contact.length > 0 && !valid) {
    console.error(
      '[jobs]',
      'NEXUI_CONTACT must be an email address or a URL; board lookups are off.',
    );
  }

  return { contact: valid ? contact : null, searchKey: searchKey.length > 0 ? searchKey : null };
}
