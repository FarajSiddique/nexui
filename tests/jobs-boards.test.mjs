import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BoardError,
  findBoard,
  listPostings,
  readPosting,
} from '../apps/api/src/lib/jobs/boards.ts';
import { readJobsConfig } from '../apps/api/src/lib/jobs/config.ts';
import { matchesRole, plainText } from '../apps/api/src/lib/jobs/text.ts';

const CONTACT = 'ops@nexui.test';
const LEVER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const ASHBY_ID = 'b1b2c3d4-0000-4000-8000-000000000002';

// Board answers, trimmed to the fields Nexui reads, as the spikes saw them on 2026-10-10.
const greenhouseList = {
  jobs: [
    {
      id: 101,
      title: 'Staff Product Manager, Payments',
      absolute_url: 'https://stripe.com/jobs/search?gh_jid=101',
      location: { name: 'London, UK (Hybrid)' },
      first_published: '2026-10-18T09:00:00-04:00',
      updated_at: '2026-10-20T00:00:00Z',
    },
    {
      id: 102,
      title: 'Account Executive',
      absolute_url: 'https://stripe.com/jobs/search?gh_jid=102',
      location: { name: 'Dublin' },
      first_published: '2024-01-02T09:00:00Z',
    },
  ],
  meta: { total: 2 },
};
const greenhouseOne = {
  ...greenhouseList.jobs[0],
  company_name: 'Stripe',
  // Greenhouse escapes its HTML.
  content: '&lt;p&gt;Lead &amp;amp; grow payments&lt;/p&gt;',
  pay_input_ranges: [
    { min_cents: 12_000_000, max_cents: 15_000_000, currency_type: 'GBP', title: 'London' },
  ],
};
const leverList = [
  {
    id: LEVER_ID,
    text: 'Product Manager',
    hostedUrl: `https://jobs.eu.lever.co/quantinuum/${LEVER_ID}`,
    createdAt: 1_760_000_000_000,
    categories: { location: 'Cambridge, UK' },
    workplaceType: 'hybrid',
    descriptionPlain: 'Build quantum products.',
    salaryRange: { min: 90_000, max: 110_000, currency: 'GBP', interval: 'per-year-salary' },
  },
];
const ashbyBoard = {
  jobs: [
    {
      id: ASHBY_ID,
      title: 'Product Manager, Growth',
      jobUrl: `https://jobs.ashbyhq.com/ramp/${ASHBY_ID}`,
      location: 'New York',
      workplaceType: 'Hybrid',
      publishedAt: '2026-10-15T12:00:00.000+00:00',
      descriptionPlain: 'Grow Ramp.',
      isListed: true,
      compensation: {
        summaryComponents: [
          { compensationType: 'Salary', currencyCode: 'USD', minValue: 180_000, maxValue: 220_000 },
        ],
      },
    },
  ],
};

// A stand-in for the board hosts: each request's URL is matched by prefix against `routes`, and
// recorded with its headers. Anything unmatched is a 404.
function upstream(routes) {
  const seen = [];

  async function fetch(input, init = {}) {
    const url = String(input);

    seen.push({ url, headers: new Headers(init.headers) });

    for (const [prefix, answer] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return typeof answer === 'function' ? answer(url, init) : Response.json(answer);
      }
    }

    return Response.json({ status: 404, error: 'Not found' }, { status: 404 });
  }

  return { seen, deps: (extra = {}) => ({ contact: CONTACT, fetch, ...extra }) };
}

test('Greenhouse: a list, newest first, then one posting with its pay and text', async () => {
  const { seen, deps } = upstream({
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/101': greenhouseOne,
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs': greenhouseList,
  });
  const board = { provider: 'greenhouse', token: 'stripe' };
  const list = await listPostings(board, deps());

  assert.deepEqual(
    list.map((posting) => [posting.key, posting.title, posting.postedAt]),
    [
      ['greenhouse:stripe:101', 'Staff Product Manager, Payments', '2026-10-18T13:00:00.000Z'],
      ['greenhouse:stripe:102', 'Account Executive', '2024-01-02T09:00:00.000Z'],
    ],
  );

  const one = await readPosting(board, '101', deps());

  assert.deepEqual(one, {
    key: 'greenhouse:stripe:101',
    board,
    job: '101',
    company: 'Stripe',
    title: 'Staff Product Manager, Payments',
    url: 'https://stripe.com/jobs/search?gh_jid=101',
    location: 'London, UK (Hybrid)',
    workMode: 'hybrid',
    salary: { min: 120_000, max: 150_000, currency: 'GBP' },
    postedAt: '2026-10-18T13:00:00.000Z',
    text: 'Lead & grow payments',
  });
  assert.deepEqual(
    seen.map((request) => request.url),
    [
      'https://boards-api.greenhouse.io/v1/boards/stripe/jobs',
      'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/101?pay_transparency=true',
    ],
  );
  assert.ok(
    seen.every((request) => request.headers.get('User-Agent') === `Nexui/1.0 (${CONTACT})`),
  );
});

test("Lever's EU boards answer on their own host, with work mode and pay", async () => {
  const { seen, deps } = upstream({ 'https://api.eu.lever.co/v0/postings/quantinuum': leverList });
  const [posting] = await listPostings(
    { provider: 'lever', token: 'quantinuum', region: 'eu' },
    deps(),
  );

  assert.equal(seen[0].url, 'https://api.eu.lever.co/v0/postings/quantinuum?mode=json&limit=300');
  assert.deepEqual(
    [posting.key, posting.company, posting.workMode, posting.salary, posting.postedAt],
    [
      `lever:quantinuum:${LEVER_ID}`,
      'Quantinuum',
      'hybrid',
      { min: 90_000, max: 110_000, currency: 'GBP' },
      new Date(1_760_000_000_000).toISOString(),
    ],
  );
});

test('Ashby is read whole once per run, and a role gone from it is gone', async () => {
  const { seen, deps } = upstream({
    'https://api.ashbyhq.com/posting-api/job-board/ramp': ashbyBoard,
  });
  const run = deps({ cache: new Map() });
  const board = { provider: 'ashby', token: 'ramp' };

  assert.equal((await readPosting(board, ASHBY_ID, run)).salary.max, 220_000);
  assert.equal(await readPosting(board, 'c0000000-0000-4000-8000-000000000009', run), null);
  assert.deepEqual(
    seen.map((request) => request.url),
    ['https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true'],
  );
});

test('a 404 is gone; a throttle, junk or silence is a BoardError, within its time', async () => {
  const board = { provider: 'greenhouse', token: 'stripe' };
  const { deps } = upstream({
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/429': () =>
      new Response(null, { status: 429 }),
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/500': () =>
      new Response('<html>Oops</html>', { headers: { 'Content-Type': 'text/html' } }),
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/600': (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });

  assert.equal(await readPosting(board, '404', deps()), null);
  await assert.rejects(
    readPosting(board, '429', deps()),
    (error) => error instanceof BoardError && error.status === 429,
  );
  await assert.rejects(readPosting(board, '500', deps()), BoardError);

  const started = Date.now();

  await assert.rejects(
    readPosting(board, '600', deps({ signal: AbortSignal.timeout(20) })),
    (error) => error instanceof BoardError && error.message === 'The board did not answer.',
  );
  assert.ok(Date.now() - started < 1_000);
});

test('one host gets at most 4 requests at a time', async () => {
  let started = 0;
  let open = 0;
  let most = 0;
  const releases = [];
  const { deps } = upstream({
    'https://boards-api.greenhouse.io/': () => {
      started += 1;
      open += 1;
      most = Math.max(most, open);

      return new Promise((resolve) => {
        releases.push(() => {
          open -= 1;
          resolve(Response.json(greenhouseOne));
        });
      });
    },
  });
  const board = { provider: 'greenhouse', token: 'stripe' };
  const reads = Array.from({ length: 6 }, (_, n) => readPosting(board, String(200 + n), deps()));

  // Finish one request at a time until all six have started, then the rest.
  while (started < 6) {
    await new Promise((resolve) => setTimeout(resolve, 1));

    releases.shift()?.();
  }

  for (const release of releases.splice(0)) {
    release();
  }

  await Promise.all(reads);
  assert.equal(most, 4);
});

test('a named company’s board is the first one with open roles', async () => {
  const { seen, deps } = upstream({
    'https://boards-api.greenhouse.io/v1/boards/ramp/jobs': { jobs: [], meta: { total: 0 } },
    'https://api.lever.co/v0/postings/ramp': [],
    'https://api.ashbyhq.com/posting-api/job-board/ramp': ashbyBoard,
  });

  assert.deepEqual(await findBoard('Ramp', deps()), { provider: 'ashby', token: 'ramp' });
  assert.equal(seen.length, 4);
  assert.equal(await findBoard('!!!', deps()), null);
});

test('the contact must be an email address or a URL; without one, board lookups are off', (t) => {
  const logged = t.mock.method(console, 'error', () => {});

  assert.deepEqual(readJobsConfig({ NEXUI_CONTACT: 'ops@nexui.app', PARALLEL_API_KEY: ' k ' }), {
    contact: 'ops@nexui.app',
    searchKey: 'k',
  });
  assert.deepEqual(readJobsConfig({}), { contact: null, searchKey: null });
  assert.deepEqual(readJobsConfig({ NEXUI_CONTACT: 'not a contact' }), {
    contact: null,
    searchKey: null,
  });
  assert.deepEqual(logged.mock.calls[0].arguments, [
    '[jobs]',
    'NEXUI_CONTACT must be an email address or a URL; board lookups are off.',
  ]);
});

test('posting text is plain, and a title matches a role by its words', () => {
  assert.equal(
    plainText('&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Hot&lt;/li&gt;'),
    'Fish & chips Hot',
  );
  assert.equal(matchesRole('Product Manager, Payments', ['Staff PM']), true);
  assert.equal(matchesRole('Account Manager', ['Staff PM']), false);
  assert.equal(matchesRole('Senior Backend Engineer', ['Backend Engineer']), true);
  assert.equal(matchesRole('Product Designer', ['Staff Product Manager']), false);
});
