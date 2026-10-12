import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftDetails,
  mailtoUrl,
  sentAction,
} from '../apps/mobile/src/features/jobs/draft-details.ts';
import { RUN_ID } from './support/graph.mjs';
import {
  COMPANY_ID,
  jobLink,
  jobObject,
  jobSnapshot,
  RESUME_ID,
  ROLE_ID,
  roleData,
} from './support/jobs.mjs';

const FOLLOW_UP_ID = 'f2000000-0000-4000-8000-000000000040';
const LETTER_ID = 'f2000000-0000-4000-8000-000000000041';
const followUp = {
  docType: 'follow_up',
  to: 'priya@halyard.example',
  subject: 'Following up: Senior PM, Payments',
  body: 'Hi Priya,\nStill keen.',
};
const snapshot = jobSnapshot({
  objects: [
    jobObject(COMPANY_ID, 'company', { name: 'Halyard', target: false }, { title: 'Halyard' }),
    jobObject(
      ROLE_ID,
      'opportunity',
      roleData({ title: 'Senior PM, Payments', stage: 'applied' }),
      {
        title: 'Senior PM, Payments',
      },
    ),
    jobObject(FOLLOW_UP_ID, 'document', followUp, { source: { type: 'ai', runId: RUN_ID } }),
    jobObject(LETTER_ID, 'document', { docType: 'cover_letter', body: 'Dear Halyard team,' }),
    jobObject(RESUME_ID, 'document', {
      docType: 'resume',
      body: 'Priya Rao',
      profile: { skills: [], pastRoles: [] },
    }),
  ],
  links: [
    jobLink(1, ROLE_ID, COMPANY_ID, 'at'),
    jobLink(2, FOLLOW_UP_ID, ROLE_ID, 'for'),
    jobLink(3, LETTER_ID, ROLE_ID, 'for'),
  ],
});

test('a follow-up opens in Mail, filled in, and I sent it logs the contact on its role', () => {
  const details = draftDetails(snapshot, FOLLOW_UP_ID);

  assert.deepEqual(
    [details.title, details.kicker, details.ai, details.canLogSent],
    ['Follow-up to Halyard', 'Senior PM, Payments', true, true],
  );
  assert.deepEqual(details.email, {
    to: 'priya@halyard.example',
    subject: 'Following up: Senior PM, Payments',
    mailto:
      'mailto:priya@halyard.example?subject=Following%20up%3A%20Senior%20PM%2C%20Payments&body=Hi%20Priya%2C%0D%0AStill%20keen.',
  });
  assert.deepEqual(sentAction(details.role), {
    type: 'capability',
    request: { name: 'jobs.logContact', input: { objectId: ROLE_ID, direction: 'sent' } },
    optimistic: [],
  });
});

test('a cover letter is copied, not mailed; a resume opens no draft sheet', () => {
  const letter = draftDetails(snapshot, LETTER_ID);

  assert.deepEqual(
    [letter.title, letter.email, letter.canLogSent, letter.ai],
    ['Cover letter', null, false, false],
  );
  assert.equal(draftDetails(snapshot, RESUME_ID), null);
  assert.equal(draftDetails(snapshot, ROLE_ID), null);
});

test('a mailto link leaves the address readable and needs none', () => {
  assert.equal(mailtoUrl({ body: 'Hi' }), 'mailto:?body=Hi');
  assert.equal(
    mailtoUrl({ to: 'a@b.example', subject: 'Re: 50% & more', body: 'x' }),
    'mailto:a@b.example?subject=Re%3A%2050%25%20%26%20more&body=x',
  );
});

test('an address with a query in it adds no field to the message', () => {
  const url = mailtoUrl({ to: 'a@b.example?bcc=x@y.example', body: 'x' });

  assert.equal(url, 'mailto:a@b.example%3Fbcc%3Dx@y.example?body=x');
  assert.deepEqual([...new URL(url).searchParams.keys()], ['body']);
});
