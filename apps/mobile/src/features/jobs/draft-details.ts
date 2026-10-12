import type { DocumentData, GraphObject, GraphSnapshot, OpportunityData } from '@nexui/types';

import { aiMarkFor } from '#lib';
import type { CapabilityAction } from '#features/workspace';

import { companyName, linkedTo } from './job-parts.ts';
import { DOC_LABELS } from './role-details.ts';

// Drafts that are emails, which Open in Mail fills in.
const EMAILS: readonly DocumentData['docType'][] = ['follow_up', 'withdrawal'];

/** What a draft's sheet shows (job search spec, section 6). */
export interface DraftDetails {
  draft: GraphObject;
  data: DocumentData;
  /** "Follow-up to Halyard", "Cover letter", "Interview brief". */
  title: string;
  /** The sheet's top line: what the draft is for, or "Draft". */
  kicker: string;
  /** The role it's for, which I sent it logs contact on, or null. */
  role: GraphObject | null;
  ai: boolean;
  /** An email's address, subject and the `mailto:` link Open in Mail opens; null otherwise. */
  email: { to: string | null; subject: string | null; mailto: string } | null;
  /** A follow-up for a role: I sent it logs the contact. */
  canLogSent: boolean;
}

/**
 * A `mailto:` link the user's own mail app fills in (spec section 6: Nexui never sends). The
 * address is encoded but its `@` stays readable, so it can't add a field of its own; subject and
 * body are encoded, with line breaks as CRLF (RFC 6068).
 *
 * @example mailtoUrl({ to: 'a@b.example', subject: 'Hi', body: 'x' }) // 'mailto:a@b.example?subject=Hi&body=x'
 */
export function mailtoUrl(email: { to?: string; subject?: string; body: string }): string {
  const params: string[] = [];

  if (email.subject) {
    params.push(`subject=${encodeURIComponent(email.subject)}`);
  }

  params.push(`body=${encodeURIComponent(email.body.replace(/\r?\n/g, '\r\n'))}`);

  const to = encodeURIComponent(email.to ?? '').replace(/%40/g, '@');

  return `mailto:${to}?${params.join('&')}`;
}

/** A draft's sheet, or null for a resume, a missing object or another kind. */
export function draftDetails(snapshot: GraphSnapshot, draftId: string): DraftDetails | null {
  const draft = snapshot.objects.find(
    (object) => object.id === draftId && object.kind === 'document',
  );
  const data = draft?.data as DocumentData | undefined;

  if (!draft || !data || data.docType === 'resume') {
    return null;
  }

  const target = linkedTo(snapshot, draft.id, 'for');
  const role = target?.kind === 'opportunity' ? target : null;
  const company = role ? companyName(snapshot, role.id) : null;
  const isEmail = EMAILS.includes(data.docType);
  const forInterview = target?.kind === 'interview';
  let title = DOC_LABELS[data.docType];

  if (forInterview && data.docType === 'brief') {
    title = 'Interview brief';
  } else if (isEmail && company) {
    title = `${title} to ${company}`;
  }

  return {
    draft,
    data,
    title,
    kicker: role ? (role.data as OpportunityData).title : (target?.title ?? 'Draft'),
    role,
    ai: aiMarkFor(draft).highlight,
    email: isEmail
      ? { to: data.to ?? null, subject: data.subject ?? null, mailto: mailtoUrl(data) }
      : null,
    canLogSent: data.docType === 'follow_up' && role !== null,
  };
}

/** I sent it: the follow-up went out, so its role's last contact and follow-ups move. */
export function sentAction(role: GraphObject): CapabilityAction {
  return {
    type: 'capability',
    request: { name: 'jobs.logContact', input: { objectId: role.id, direction: 'sent' } },
    optimistic: [],
  };
}
