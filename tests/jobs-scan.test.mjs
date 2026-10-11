import assert from 'node:assert/strict';
import test from 'node:test';

import { questionId } from '../apps/api/src/lib/jobs/score.ts';
import {
  FIND_BUDGET_MS,
  rankRoles,
  scanForRoles,
  scanInput,
} from '../apps/api/src/lib/jobs/scan.ts';
import {
  Experimental_EvaluationMockModelV4,
  failingEvaluationModel,
  scriptedModel,
  textStep,
} from './support/ai.mjs';
import {
  COMPANY_ID,
  jobObject,
  jobSnapshot,
  RESUME_ID,
  ROLE_ID,
  roleData,
  SEARCH_ID,
  searchData,
} from './support/jobs.mjs';

const NOW = new Date('2026-10-20T12:00:00Z');
const CORVID_ID = 'f6000000-0000-4000-8000-000000000001';
const LEVER_JOB = 'a1b2c3d4-0000-4000-8000-000000000001';
const ASHBY_JOB = 'b1b2c3d4-0000-4000-8000-000000000002';
const profile = { currentEmployer: 'Ledgerly', skills: ['Payments'], pastRoles: [] };

// Halyard's board (a target with a board), Corvid's (found by name, on Ashby), and one search
// whose hits are a Lever role at Tessera, Halyard's 101 again, a role the plan has seen (999),
// and one at Ledgerly.
const boards = {
  'https://boards-api.greenhouse.io/v1/boards/halyard/jobs/101': {
    id: 101,
    title: 'Staff Product Manager, Payments',
    absolute_url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
    location: { name: 'London' },
    first_published: '2026-10-18T09:00:00Z',
    content: '&lt;p&gt;Own card payments.&lt;/p&gt;',
  },
  'https://boards-api.greenhouse.io/v1/boards/halyard/jobs': {
    jobs: [
      {
        id: 101,
        title: 'Staff Product Manager, Payments',
        absolute_url: 'https://job-boards.greenhouse.io/halyard/jobs/101',
        first_published: '2026-10-18T09:00:00Z',
      },
      {
        id: 102,
        title: 'Account Executive',
        absolute_url: 'https://job-boards.greenhouse.io/halyard/jobs/102',
        first_published: '2026-10-18T09:00:00Z',
      },
    ],
  },
  'https://boards-api.greenhouse.io/v1/boards/corvid/jobs': { jobs: [] },
  'https://api.lever.co/v0/postings/corvid': [],
  'https://api.ashbyhq.com/posting-api/job-board/corvid': {
    jobs: [
      {
        id: ASHBY_JOB,
        title: 'Principal Product Manager, Lending',
        jobUrl: `https://jobs.ashbyhq.com/corvid/${ASHBY_JOB}`,
        location: 'Leeds',
        workplaceType: 'OnSite',
        publishedAt: '2026-10-19T09:00:00.000Z',
        descriptionPlain: 'Lending products, four days in Leeds.',
        isListed: true,
      },
    ],
  },
  'https://api.parallel.ai/v1/search': {
    results: [
      { url: `https://jobs.lever.co/tessera/${LEVER_JOB}` },
      { url: 'https://job-boards.greenhouse.io/halyard/jobs/101' },
      { url: 'https://job-boards.greenhouse.io/halyard/jobs/999' },
      { url: 'https://jobs.lever.co/ledgerly/c1b2c3d4-0000-4000-8000-000000000003' },
    ],
  },
  [`https://api.lever.co/v0/postings/tessera/${LEVER_JOB}`]: {
    id: LEVER_JOB,
    text: 'Senior Product Manager, Treasury',
    hostedUrl: `https://jobs.lever.co/tessera/${LEVER_JOB}`,
    createdAt: Date.parse('2026-10-17T09:00:00Z'),
    categories: { location: 'London' },
    workplaceType: 'hybrid',
    descriptionPlain: 'Treasury products.',
  },
  'https://api.lever.co/v0/postings/ledgerly/': {
    id: 'c1b2c3d4-0000-4000-8000-000000000003',
    text: 'Group Product Manager',
    hostedUrl: 'https://jobs.lever.co/ledgerly/c1b2c3d4-0000-4000-8000-000000000003',
    createdAt: Date.parse('2026-10-17T09:00:00Z'),
  },
};

function network(routes = boards) {
  const urls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input);

    urls.push(url);

    // Longest prefix first, so a posting's route wins over its board's.
    const match = Object.keys(routes)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];

    if (match === undefined) {
      return Response.json({}, { status: 404 });
    }

    const answer = routes[match];

    return typeof answer === 'function' ? answer(url, init) : Response.json(answer);
  };

  return { urls, fetch };
}

// Jev answering by question id, recording what it was asked.
function jev(scores, seen = []) {
  return new Experimental_EvaluationMockModelV4({
    doEvaluate: async (options) => {
      seen.push(options);

      return {
        answers: Object.fromEntries(
          Object.keys(options.questions).map((id) => [
            id,
            { type: 'boolean', probability: scores[id] ?? 0 },
          ]),
        ),
        warnings: [],
      };
    },
  });
}

const explainer = (roles) => scriptedModel([textStep(JSON.stringify({ roles }))]);

// The plan: Halyard named with its board, Corvid named without, a resume, one role seen.
function plan() {
  return jobSnapshot({
    search: { ...searchData, excludeCompanies: ['Ledgerly'] },
    context: {
      jobs: {
        timezone: 'Europe/London',
        seen: ['greenhouse:halyard:999'],
        startedAt: NOW.toISOString(),
      },
    },
    objects: [
      jobObject(COMPANY_ID, 'company', {
        name: 'Halyard',
        target: true,
        board: { provider: 'greenhouse', token: 'halyard' },
      }),
      jobObject(CORVID_ID, 'company', { name: 'Corvid', target: true }),
      jobObject(RESUME_ID, 'document', { docType: 'resume', body: 'Secret resume text', profile }),
      jobObject(
        ROLE_ID,
        'opportunity',
        roleData({
          title: 'Old role',
          url: 'https://job-boards.greenhouse.io/halyard/jobs/555',
          source: { provider: 'greenhouse', token: 'halyard', job: '555' },
        }),
      ),
    ],
  });
}

function deps(net, evaluation, explain, config = { contact: 'ops@nexui.test', searchKey: 'k' }) {
  return {
    config,
    fetch: net.fetch,
    now: NOW,
    signal: AbortSignal.timeout(5_000),
    evaluation: { model: evaluation, providerOptions: undefined },
    explain: { model: explain, providerOptions: undefined },
  };
}

const HALYARD = questionId('greenhouse:halyard:101');
const CORVID = questionId(`ashby:corvid:${ASHBY_JOB}`);
const TESSERA = questionId(`lever:tessera:${LEVER_JOB}`);

test('a scan reads the plan: named companies, the resume profile, and the keys it has seen', () => {
  const input = scanInput(plan(), SEARCH_ID, null);

  assert.deepEqual(input.targets, [
    { id: COMPANY_ID, name: 'Halyard', board: { provider: 'greenhouse', token: 'halyard' } },
    { id: CORVID_ID, name: 'Corvid' },
  ]);
  assert.deepEqual(input.profile, profile);
  assert.deepEqual([...input.known].sort(), ['greenhouse:halyard:555', 'greenhouse:halyard:999']);
});

test('the scan finds, confirms, scores and explains: up to 3 strong roles and a partial fit', async () => {
  const net = network();
  const asked = [];
  const result = await scanForRoles(
    scanInput(plan(), SEARCH_ID, null),
    deps(
      net,
      jev({ [HALYARD]: 0.93, [TESSERA]: 0.88, [CORVID]: 0.7 }, asked),
      explainer([
        { id: HALYARD, reasons: ['Payments PM experience matches'], gaps: [] },
        { id: TESSERA, reasons: ['Treasury is close to payments'], gaps: ['Smaller team'] },
        { id: CORVID, reasons: ['Strong on lending'], gaps: ['On-site four days in Leeds'] },
      ]),
    ),
  );

  assert.deepEqual(
    result.roles.map((role) => [role.title, role.company.name, role.fit.score]),
    [
      ['Staff Product Manager, Payments', 'Halyard', 0.93],
      ['Senior Product Manager, Treasury', 'Tessera', 0.88],
    ],
  );
  assert.deepEqual(result.roles[0].fit, {
    score: 0.93,
    reasons: ['Payments PM experience matches'],
    gaps: [],
  });
  assert.deepEqual(result.roles[0].source, {
    provider: 'greenhouse',
    token: 'halyard',
    job: '101',
  });
  assert.equal(result.partial.title, 'Principal Product Manager, Lending');
  assert.deepEqual(result.partial.fit.gaps, ['On-site four days in Leeds']);
  assert.deepEqual(result.boards, [
    { companyId: CORVID_ID, board: { provider: 'ashby', token: 'corvid' } },
  ]);
  assert.deepEqual(result.seen.sort(), [
    `ashby:corvid:${ASHBY_JOB}`,
    'greenhouse:halyard:101',
    `lever:tessera:${LEVER_JOB}`,
  ]);
  assert.equal(result.usage.model, 'mock-model-id');

  // Jev saw the person, never the resume's text, and each question carried its own role.
  const { state, questions } = asked[0];

  assert.deepEqual(Object.keys(questions).sort(), [CORVID, HALYARD, TESSERA].sort());
  assert.equal(questions[HALYARD].type, 'boolean');
  assert.equal(questions[HALYARD].instructions.role.title, 'Staff Product Manager, Payments');
  assert.deepEqual(state.person.profile, profile);
  assert.doesNotMatch(JSON.stringify(state), /Secret resume text/);
  // The Account Executive role isn't one of the search's roles, a seen role isn't read again,
  // and Ledgerly is never shown.
  assert.equal(
    net.urls.some((url) => url.includes('/halyard/jobs/102')),
    false,
  );
  assert.equal(
    net.urls.some((url) => url.includes('/halyard/jobs/999')),
    false,
  );
  assert.equal(
    net.urls.some((url) =>
      url.endsWith('/ledgerly/c1b2c3d4-0000-4000-8000-000000000003?mode=json'),
    ),
    true,
  );
});

test('when Jev fails, nothing surfaces and seen is left alone; found boards are kept', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const result = await scanForRoles(
    scanInput(plan(), SEARCH_ID, null),
    deps(network(), failingEvaluationModel(), explainer([])),
  );

  assert.deepEqual([result.roles, result.partial, result.seen], [[], null, []]);
  assert.equal(result.boards.length, 1);
  assert.deepEqual(logged.mock.calls.at(-1).arguments, ['[jobs]', 'Scoring roles failed.']);
});

test('when the explain call leaves a role without a reason, nothing surfaces', async (t) => {
  t.mock.method(console, 'error', () => {});

  const result = await scanForRoles(
    scanInput(plan(), SEARCH_ID, null),
    deps(network(), jev({ [HALYARD]: 0.93 }), explainer([{ id: HALYARD, reasons: [], gaps: [] }])),
  );

  assert.deepEqual([result.roles, result.seen], [[], []]);
});

test('without a contact the scan asks no one; without a key it reads named boards only', async () => {
  const silent = network();

  assert.deepEqual(
    await scanForRoles(
      scanInput(plan(), SEARCH_ID, null),
      deps(silent, jev({}), explainer([]), { contact: null, searchKey: 'k' }),
    ),
    { roles: [], partial: null, seen: [], boards: [], usage: null },
  );
  assert.deepEqual(silent.urls, []);

  const noKey = network();

  await scanForRoles(
    scanInput(plan(), SEARCH_ID, null),
    deps(noKey, jev({}), explainer([]), { contact: 'ops@nexui.test', searchKey: null }),
  );
  assert.equal(
    noKey.urls.some((url) => url.startsWith('https://api.parallel.ai')),
    false,
  );
});

test('a board that never answers is dropped when the scan’s time runs out', async () => {
  // Hangs until its signal aborts; a request sent after the budget ran out fails at once.
  const stuck = network({
    'https://boards-api.greenhouse.io/': (url, init) =>
      new Promise((resolve, reject) => {
        if (init.signal.aborted) {
          reject(new Error('aborted'));
        }

        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  const started = Date.now();
  const result = await scanForRoles(scanInput(plan(), SEARCH_ID, null), {
    ...deps(stuck, jev({}), explainer([]), { contact: 'ops@nexui.test', searchKey: null }),
    signal: AbortSignal.timeout(50),
  });

  assert.deepEqual(result.roles, []);
  assert.ok(Date.now() - started < 2_000);
});

test('a strong fit the daily three leave out stays unseen; a dropped one is seen', async () => {
  const halyardJob = (id) => ({
    id,
    title: `Staff Product Manager, ${id}`,
    absolute_url: `https://job-boards.greenhouse.io/halyard/jobs/${id}`,
    location: { name: 'London' },
    first_published: '2026-10-18T09:00:00Z',
    content: 'Payments.',
  });
  const more = {
    ...boards,
    'https://boards-api.greenhouse.io/v1/boards/halyard/jobs': {
      jobs: [101, 103, 104, 105].map(halyardJob),
    },
  };

  for (const id of [103, 104, 105]) {
    more[`https://boards-api.greenhouse.io/v1/boards/halyard/jobs/${id}`] = halyardJob(id);
  }

  const scores = {
    [HALYARD]: 0.95,
    [questionId('greenhouse:halyard:103')]: 0.9,
    [questionId('greenhouse:halyard:104')]: 0.88,
    [TESSERA]: 0.86,
    [CORVID]: 0.7,
    [questionId('greenhouse:halyard:105')]: 0.2,
  };
  const result = await scanForRoles(
    scanInput(plan(), SEARCH_ID, null),
    deps(
      network(more),
      jev(scores),
      explainer(Object.keys(scores).map((id) => ({ id, reasons: ['Fits'], gaps: [] }))),
    ),
  );

  assert.deepEqual(
    result.roles.map((role) => role.source.job),
    ['101', '103', '104'],
  );
  assert.equal(result.partial.source.job, ASHBY_JOB);
  // Tessera scored strong but came fourth: not shown, so not seen, and scored again tomorrow.
  // The role at 0.2 was dropped, so it is seen.
  assert.deepEqual(result.seen.sort(), [
    `ashby:corvid:${ASHBY_JOB}`,
    'greenhouse:halyard:101',
    'greenhouse:halyard:103',
    'greenhouse:halyard:104',
    'greenhouse:halyard:105',
  ]);
});

test('named companies are read at once, inside the find phase’s own share of the budget', async () => {
  let open = 0;
  let most = 0;
  const slow = (answer) => async () => {
    open += 1;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 20));
    open -= 1;

    return Response.json(answer);
  };
  const net = network({
    ...boards,
    'https://boards-api.greenhouse.io/v1/boards/halyard/jobs': slow(
      boards['https://boards-api.greenhouse.io/v1/boards/halyard/jobs'],
    ),
    'https://boards-api.greenhouse.io/v1/boards/corvid/jobs': slow({ jobs: [] }),
  });

  await scanForRoles(scanInput(plan(), SEARCH_ID, null), deps(net, jev({}), explainer([])));

  // Halyard's list and Corvid's first probe were in flight together.
  assert.equal(most, 2);
  assert.ok(FIND_BUDGET_MS < 45_000);
});

test('ranking is by probability, ties to the newer posting', () => {
  const posting = (key, postedAt) => ({ key, postedAt });
  const { strong, partial } = rankRoles(
    [
      posting('a', '2026-10-01T00:00:00.000Z'),
      posting('b', '2026-10-10T00:00:00.000Z'),
      posting('c', '2026-10-05T00:00:00.000Z'),
      posting('d', '2026-10-05T00:00:00.000Z'),
      posting('e', '2026-10-05T00:00:00.000Z'),
    ],
    new Map([
      ['a', 0.9],
      ['b', 0.9],
      ['c', 0.86],
      ['d', 0.85],
      ['e', 0.61],
    ]),
  );

  assert.deepEqual(
    strong.map((one) => one.key),
    ['b', 'a', 'c'],
  );
  assert.equal(partial.key, 'e');
});

// The search's one hit is the employer's Lever board, whose company name is the board token
// title-cased ("Janestreet"), spelt differently from the resume's "Jane Street".
async function scanWithEmployerHit(excludeCompanies) {
  const JANE_JOB = 'd1b2c3d4-0000-4000-8000-000000000004';
  const base = plan();
  const snapshot = {
    ...base,
    objects: base.objects.map((object) => {
      if (object.id === SEARCH_ID) {
        return { ...object, data: { ...object.data, excludeCompanies } };
      }

      if (object.id === RESUME_ID) {
        const employed = { ...profile, currentEmployer: 'Jane Street' };

        return { ...object, data: { ...object.data, profile: employed } };
      }

      return object;
    }),
  };
  const routes = {
    ...boards,
    'https://api.parallel.ai/v1/search': {
      results: [{ url: `https://jobs.lever.co/janestreet/${JANE_JOB}` }],
    },
    [`https://api.lever.co/v0/postings/janestreet/${JANE_JOB}`]: {
      id: JANE_JOB,
      text: 'Product Manager, Trading',
      hostedUrl: `https://jobs.lever.co/janestreet/${JANE_JOB}`,
      createdAt: Date.parse('2026-10-17T09:00:00Z'),
    },
  };
  const asked = [];
  const janeKey = questionId(`lever:janestreet:${JANE_JOB}`);
  const result = await scanForRoles(
    scanInput(snapshot, SEARCH_ID, null),
    deps(
      network(routes),
      jev({ [janeKey]: 0.99, [HALYARD]: 0.9 }, asked),
      explainer([
        { id: janeKey, reasons: ['Fits'], gaps: [] },
        { id: HALYARD, reasons: ['Fits'], gaps: [] },
      ]),
    ),
  );

  return { result, questions: asked.flatMap((one) => Object.keys(one.questions)), janeKey };
}

test('the current employer stays out when its board token is spelt differently', async () => {
  const { result, questions, janeKey } = await scanWithEmployerHit(['Jane Street']);

  assert.ok(!questions.includes(janeKey));
  assert.ok(questions.includes(HALYARD));
  assert.ok(result.roles.every((role) => role.company.board.token !== 'janestreet'));
});

test('the current employer stays out even when the never-show list is empty', async () => {
  const { result, questions, janeKey } = await scanWithEmployerHit([]);

  assert.ok(!questions.includes(janeKey));
  assert.ok(result.roles.every((role) => role.company.board.token !== 'janestreet'));
  assert.ok(!result.seen.some((key) => key.includes('janestreet')));
});
