import assert from 'node:assert/strict';
import test from 'node:test';

import {
  careersTokens,
  parseBoardUrl,
  resolveCareersLink,
} from '../apps/api/src/lib/jobs/board-urls.ts';

const UUID = 'a1b2c3d4-0000-4000-8000-000000000001';

test('board URLs map to their board, and a posting to its job', () => {
  const cases = [
    [
      'https://boards.greenhouse.io/figma/jobs/5011',
      { kind: 'posting', board: { provider: 'greenhouse', token: 'figma' }, job: '5011' },
    ],
    [
      'https://job-boards.eu.greenhouse.io/parloa/jobs/77?gh_src=x',
      { kind: 'posting', board: { provider: 'greenhouse', token: 'parloa' }, job: '77' },
    ],
    [
      'https://boards.greenhouse.io/embed/job_app?for=discord&token=88',
      { kind: 'posting', board: { provider: 'greenhouse', token: 'discord' }, job: '88' },
    ],
    [
      `https://jobs.lever.co/palantir/${UUID}/apply`,
      { kind: 'posting', board: { provider: 'lever', token: 'palantir' }, job: UUID },
    ],
    [
      `https://jobs.eu.lever.co/quantinuum/${UUID}`,
      {
        kind: 'posting',
        board: { provider: 'lever', token: 'quantinuum', region: 'eu' },
        job: UUID,
      },
    ],
    [
      `https://jobs.ashbyhq.com/notion/${UUID}/application`,
      { kind: 'posting', board: { provider: 'ashby', token: 'notion' }, job: UUID },
    ],
    [
      'https://jobs.ashbyhq.com/ramp',
      { kind: 'board', board: { provider: 'ashby', token: 'ramp' } },
    ],
  ];

  for (const [url, expected] of cases) {
    assert.deepEqual(parseBoardUrl(url), expected, url);
  }
});

test('anything else is refused, without a request', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/123',
    'http://169.254.169.254/latest/meta-data',
    'http://169.254.169.254/?gh_jid=1',
    'https://user@jobs.lever.co/palantir/x',
    'https://jobs.lever.co.evil.example/palantir/' + UUID,
    'https://jobs.lever.co:8443/palantir/' + UUID,
    'ftp://boards.greenhouse.io/figma/jobs/1',
    'javascript:alert(1)',
    'https://jobs.lever.co/palantir/not-a-uuid',
    'not a url',
  ]) {
    assert.equal(parseBoardUrl(url), null, url);
  }
});

test('a careers site with gh_jid guesses Greenhouse tokens from its host', () => {
  assert.deepEqual(parseBoardUrl('https://stripe.com/jobs/search?gh_jid=101'), {
    kind: 'careers',
    host: 'stripe.com',
    job: '101',
    tokens: ['stripe'],
  });
  assert.deepEqual(careersTokens('www.datadoghq.com'), ['datadoghq', 'datadog']);
  assert.deepEqual(careersTokens('careers.airbnb.com'), ['airbnb']);
});

test('a careers link holds only when the Greenhouse posting points back at that host', async () => {
  const hosts = [];
  const posting = (url) => ({
    id: 101,
    title: 'Staff PM',
    absolute_url: url,
    company_name: 'Stripe',
    content: '',
  });
  const deps = (absoluteUrl) => ({
    contact: 'ops@nexui.test',
    fetch: async (input) => {
      const url = new URL(String(input));

      hosts.push(url.hostname);

      return url.pathname === '/v1/boards/stripe/jobs/101'
        ? Response.json(posting(absoluteUrl))
        : Response.json({}, { status: 404 });
    },
  });
  const careers = parseBoardUrl('https://stripe.com/jobs/search?gh_jid=101');

  assert.equal(
    (await resolveCareersLink(careers, deps('https://stripe.com/jobs/search?gh_jid=101'))).key,
    'greenhouse:stripe:101',
  );
  // A posting that points somewhere else isn't this careers site's.
  assert.equal(
    await resolveCareersLink(careers, deps('https://www.lyft.com/careers?gh_jid=101')),
    null,
  );
  // A hostile host guesses a token, and only Greenhouse's API is asked.
  assert.equal(
    await resolveCareersLink(parseBoardUrl('https://evil.example/?gh_jid=101'), deps('x')),
    null,
  );
  assert.ok(hosts.every((host) => host === 'boards-api.greenhouse.io'));
});
