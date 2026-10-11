import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOARD_HOSTS,
  SearchError,
  searchBoards,
  searchQuery,
} from '../apps/api/src/lib/jobs/search.ts';

const NOW = new Date('2026-10-20T12:00:00Z');
const criteria = {
  roles: ['Staff PM'],
  locations: ['London'],
  workModes: ['hybrid', 'remote'],
  industries: ['fintech'],
};

test('a search is built from the criteria alone, and needs a role', () => {
  assert.deepEqual(searchQuery(criteria), {
    objective: 'Open job postings for Staff PM roles in London, remote welcome, in fintech.',
    queries: ['Staff PM London', 'Staff PM remote'],
  });
  assert.equal(searchQuery({ ...criteria, roles: [] }), null);
});

test('one search: the six board hosts, the last 7 days, fast, 10 results, the key as a header', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });

    return Response.json({
      search_id: 's1',
      session_id: 'x',
      results: [
        { url: 'https://jobs.lever.co/halyard/a1b2c3d4-0000-4000-8000-000000000001', excerpts: [] },
        { url: 'https://www.linkedin.com/jobs/view/1', excerpts: [] },
        { url: 'https://boards.greenhouse.io/figma/jobs/5011', excerpts: [] },
      ],
    });
  };
  const urls = await searchBoards(searchQuery(criteria), { key: 'par_test', fetch, now: NOW });

  assert.deepEqual(urls, [
    'https://jobs.lever.co/halyard/a1b2c3d4-0000-4000-8000-000000000001',
    'https://boards.greenhouse.io/figma/jobs/5011',
  ]);
  assert.equal(seen[0].url, 'https://api.parallel.ai/v1/search');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.redirect, 'error');
  assert.equal(seen[0].init.headers['x-api-key'], 'par_test');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    objective: 'Open job postings for Staff PM roles in London, remote welcome, in fintech.',
    search_queries: ['Staff PM London', 'Staff PM remote'],
    mode: 'fast',
    advanced_settings: {
      source_policy: { include_domains: [...BOARD_HOSTS], after_date: '2026-10-13' },
      max_results: 10,
    },
  });
});

test('a failed search is a SearchError with its status, and the log is left to the caller', async () => {
  const answering = (response) => ({ key: 'k', fetch: async () => response, now: NOW });

  await assert.rejects(
    searchBoards(searchQuery(criteria), answering(new Response(null, { status: 429 }))),
    (error) => error instanceof SearchError && error.status === 429,
  );
  await assert.rejects(
    searchBoards(searchQuery(criteria), answering(Response.json({ unexpected: true }))),
    SearchError,
  );
});
