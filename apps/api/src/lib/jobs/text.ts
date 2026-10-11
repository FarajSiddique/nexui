const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }

    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }

    return NAMED[name.toLowerCase()] ?? entity;
  });
}

/**
 * A posting's HTML as plain text: entities decoded (Greenhouse escapes its HTML once more), tags
 * dropped, whitespace collapsed.
 *
 * @example
 * plainText('&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;') // 'Fish & chips'
 */
export function plainText(html: string): string {
  return decode(decode(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A board token as a company name, when the board names none.
 *
 * @example
 * titleCase('jane-street') // 'Jane Street'
 */
export function titleCase(token: string): string {
  return token
    .split(/[-_.]+/)
    .filter((word) => word.length > 0)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/**
 * JSON for a prompt fence: quotes and newlines stay inside the string, and `<` is escaped so the
 * text can't close the tag. The same rule as `cognition/prompts.ts`, which `lib/jobs` can't import.
 */
export function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

// Short forms job titles use, read as their words.
const SHORT_FORMS: Record<string, string> = {
  pm: 'product manager',
  tpm: 'technical program manager',
  em: 'engineering manager',
  swe: 'software engineer',
  sde: 'software engineer',
  sre: 'site reliability engineer',
  ux: 'user experience',
  ml: 'machine learning',
  qa: 'quality assurance',
};

// Words that say how senior a role is, or join others, rather than what the work is.
const NOT_THE_WORK = new Set([
  'senior',
  'sr',
  'staff',
  'principal',
  'lead',
  'head',
  'junior',
  'jr',
  'associate',
  'intern',
  'ii',
  'iii',
  'iv',
  'of',
  'the',
  'and',
  'an',
  'for',
  'in',
]);

/** The words that say what a role is, seniority dropped and short forms spelled out. */
export function roleTerms(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((word) => (SHORT_FORMS[word] ?? word).split(' '))
    .filter((word) => word.length > 1 && !NOT_THE_WORK.has(word));
}

/**
 * Whether a posting's title is one of the search's roles: every word of some role appears in
 * it. It narrows a big board before Jev scores what's left.
 *
 * @example
 * matchesRole('Product Manager, Payments', ['Staff PM']) // true
 * matchesRole('Account Manager', ['Staff PM']) // false
 */
export function matchesRole(title: string, roles: readonly string[]): boolean {
  const words = new Set(roleTerms(title));

  return roles.some((role) => {
    const terms = roleTerms(role);

    return terms.length > 0 && terms.every((term) => words.has(term));
  });
}
