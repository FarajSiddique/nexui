import assert from 'node:assert/strict';
import test from 'node:test';

import { isPdf } from '../apps/api/src/lib/jobs/resume.ts';
import { BUILD_CASES, ROUTING_CASES } from '../scripts/eval-jobs-cases.mjs';
import { RESUMES, resumePdf } from '../scripts/eval-jobs/resumes.mjs';
import { buildChecks, routingCheck } from '../scripts/lib/eval-jobs-checks.mjs';
import { jobLink, jobObject, jobSnapshot, roleData } from './support/jobs.mjs';

const COMPANY = 'f8000000-0000-4000-8000-000000000001';
const ROLE = 'f8000000-0000-4000-8000-000000000002';
const pmLondon = BUILD_CASES.find((testCase) => testCase.name === 'pm-london');
const run = { status: 'succeeded', error: null };

// What pm-london's build should leave: criteria, the employer excluded, one strong role.
function built(changes = {}) {
  return jobSnapshot({
    search: {
      roles: ['Staff Product Manager'],
      locations: ['London'],
      workModes: ['hybrid'],
      industries: ['Fintech'],
      excludeCompanies: ['Ledgerly'],
      passReasons: [],
      status: 'active',
      roleChecks: 'on',
      forwarding: {},
    },
    objects: [
      jobObject(COMPANY, 'company', { name: 'Halyard', target: false }),
      jobObject(
        ROLE,
        'opportunity',
        roleData({ fit: { score: 0.9, reasons: ['Payments'], gaps: [] }, ...changes }),
        { source: { type: 'ai' } },
      ),
    ],
    links: [jobLink(1, ROLE, COMPANY, 'at')],
  });
}

const failing = (checks) => checks.filter((item) => !item.ok).map((item) => item.label);

test('Part A has 20 clear goals and 4 that may go either of two ways', () => {
  assert.equal(ROUTING_CASES.length, 24);
  assert.equal(ROUTING_CASES.filter((testCase) => testCase.expect.length === 2).length, 4);
  assert.deepEqual(routingCheck({ expect: ['job_search'] }, 'job_search'), {
    label: 'routed',
    ok: true,
  });
  assert.equal(routingCheck({ expect: ['job_search', 'unsupported'] }, 'travel').ok, false);
});

test('a good build passes every check', () => {
  assert.deepEqual(failing(buildChecks(built(), run, pmLondon, 'read')), []);
});

test('a dead or wrong build fails the checks it should', () => {
  assert.deepEqual(
    failing(buildChecks(built({ location: 'Leeds', workMode: 'onsite' }), run, pmLondon, 'read')),
    ['each New role is in a place or mode the search wants'],
  );
  assert.deepEqual(failing(buildChecks(built(), run, pmLondon, 'unreadable')), [
    "the resume's employer is never shown",
  ]);
  // A fit with no reasons can't pass the graph's schema, so the unexplained role has no fit at all.
  assert.deepEqual(failing(buildChecks(built({ fit: undefined }), run, pmLondon, 'read')), [
    'every fit has 1–3 reasons and at most 2 gaps',
  ]);
});

test('only a case whose goal names no role may leave the criteria without one', () => {
  const interviewPrep = BUILD_CASES.find((testCase) => testCase.name === 'interview-prep');
  const noRoles = jobSnapshot({
    search: {
      roles: [],
      locations: [],
      workModes: ['remote', 'hybrid', 'onsite'],
      industries: [],
      excludeCompanies: [],
      passReasons: [],
      status: 'active',
      roleChecks: 'on',
      forwarding: {},
    },
  });
  const label = 'the criteria name a target role';

  assert.equal(interviewPrep.roles, null);
  assert.ok(failing(buildChecks(noRoles, run, pmLondon, 'read')).includes(label));
  assert.equal(
    failing(buildChecks(noRoles, run, interviewPrep, 'unreadable')).includes(label),
    false,
  );
});

test('every case’s resume renders to a PDF the start route accepts; the scan is illegible noise', () => {
  for (const testCase of BUILD_CASES.filter((one) => one.resume)) {
    const bytes = resumePdf(testCase.resume);
    const text = Buffer.from(bytes).toString('latin1');
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);

    assert.equal(isPdf(bytes), true, testCase.name);
    assert.equal(text.slice(xref, xref + 4), 'xref', testCase.name);
  }

  assert.equal(RESUMES['em-toronto'].pages.length, 3);
  assert.equal(RESUMES['designer-nyc'].pages[0].length, 2);
  assert.equal(RESUMES['blurred-scan'].scan, true);
});
