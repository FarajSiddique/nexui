/**
 * The job search eval's automatic checks (spec section 9, Part B steps 1 and 3). Pure functions
 * over a contract-shaped snapshot and run, so `tests/eval-jobs-checks.test.mjs` can pin them.
 * The liveness bar needs the boards, so `scripts/eval-jobs.mjs` runs it. A person still judges
 * the roles (Part C).
 */
import { parseKindData } from '../../packages/types/src/index.ts';

const check = (label, ok, detail) => (ok ? { label, ok } : { label, ok, detail });
const ofKind = (snapshot, kind) => snapshot.objects.filter((object) => object.kind === kind);
const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Part A: the goal routed to the case's answer, or to either of an ambiguous case's two. */
export function routingCheck(testCase, answer) {
  return check('routed', testCase.expect.includes(answer), `answered ${answer}`);
}

function companyOf(snapshot, role) {
  const edge = snapshot.relationships.find(
    (link) => link.type === 'at' && link.sourceId === role.id,
  );

  return snapshot.objects.find((object) => object.id === edge?.targetId)?.data.name ?? '';
}

// A role's place fits when it names one of the search's places, or it is remote and the search
// takes remote, or the search names no place.
function placeFits(role, search) {
  const where = (role.location ?? '').toLowerCase();
  const remote = role.workMode === 'remote' || /remote/.test(where);

  if (remote && search.workModes.includes('remote')) {
    return true;
  }

  return (
    search.locations.length === 0 ||
    search.locations.some((place) => where.includes(place.toLowerCase()))
  );
}

/** Part B step 3: each New role fits the criteria, and isn't at a company never to show. */
export function fitChecks(snapshot, fresh, search) {
  const targets = new Set(
    search.roles.flatMap((role) => [...words(role.replace(/\bpm\b/gi, 'product manager'))]),
  );

  return [
    check(
      'each New role is in a place or mode the search wants',
      fresh.every((role) => placeFits(role.data, search)),
      fresh
        .map((role) => `${role.data.title}: ${role.data.location} ${role.data.workMode}`)
        .join('; '),
    ),
    check(
      'each New role shares a word with a target role',
      fresh.every((role) => [...words(role.data.title)].some((word) => targets.has(word))),
      fresh.map((role) => role.data.title).join('; '),
    ),
    check(
      'no New role is at a company the search never shows',
      fresh.every(
        (role) => !search.excludeCompanies.some((name) => same(name, companyOf(snapshot, role))),
      ),
      fresh.map((role) => companyOf(snapshot, role)).join('; '),
    ),
  ];
}

/** Part B step 1: what a build run left, judged against its case. */
export function buildChecks(snapshot, run, testCase, intake) {
  const search = ofKind(snapshot, 'search')[0]?.data;
  const fresh = ofKind(snapshot, 'opportunity').filter((role) => role.data.stage === 'new');
  const invalid = snapshot.objects.filter((object) => !parseKindData(object.kind, object.data).ok);
  const open = ofKind(snapshot, 'decision').filter((decision) => decision.data.status === 'open');
  const cards = ofKind(snapshot, 'insight').map((insight) => insight.data.text);
  const places = [...(search?.locations ?? [])];

  if (search?.workModes.includes('remote')) {
    places.push('remote');
  }

  const checks = [
    check(
      'the build run succeeded',
      run.status === 'succeeded',
      `${run.status}: ${run.error ?? ''}`,
    ),
    check(
      'every object is valid for its kind',
      invalid.length === 0,
      invalid.map((object) => object.kind).join(', '),
    ),
    check(
      'the criteria name a target role',
      (search?.roles.length ?? 0) > 0 &&
        (!testCase.roles || search.roles.some((role) => testCase.roles.test(role))),
      JSON.stringify(search?.roles),
    ),
    check(
      'the criteria fit the place',
      !testCase.places || places.some((place) => testCase.places.test(place)),
      JSON.stringify(places),
    ),
    check(
      `New roles: ${testCase.minNew} to 3`,
      fresh.length >= testCase.minNew && fresh.length <= 3,
      `${fresh.length}`,
    ),
    check(
      'every fit has 1–3 reasons and at most 2 gaps',
      fresh.every(
        (role) =>
          role.data.fit &&
          role.data.fit.reasons.length >= 1 &&
          role.data.fit.reasons.length <= 3 &&
          role.data.fit.gaps.length <= 2,
      ),
      fresh.map((role) => JSON.stringify(role.data.fit)).join('; '),
    ),
    check('at most 2 open decisions', open.length <= 2, `${open.length}`),
  ];

  if (search) {
    checks.push(...fitChecks(snapshot, fresh, search));
  }

  if (testCase.employer) {
    checks.push(
      check(
        "the resume's employer is never shown",
        intake === 'read' && search?.excludeCompanies.some((name) => same(name, testCase.employer)),
        `resume ${intake}; excluded ${JSON.stringify(search?.excludeCompanies)}`,
      ),
    );
  }

  if (testCase.insight) {
    checks.push(
      check(
        `the Open band says "${testCase.insight}"`,
        cards.includes(testCase.insight),
        JSON.stringify(cards),
      ),
    );
  }

  if (testCase.interview) {
    checks.push(
      check('the interview is in the plan', ofKind(snapshot, 'interview').length > 0, 'none'),
    );
  }

  if (testCase.targets) {
    const named = ofKind(snapshot, 'company').filter((company) => company.data.target);

    checks.push(
      check(
        'the named companies are watched',
        testCase.targets.every((name) => named.some((company) => same(company.data.name, name))),
        named.map((company) => company.data.name).join(', '),
      ),
    );
  }

  return checks;
}

/** The plan in a few lines: criteria, New roles with their fit, open questions, cards. */
export function describeSearch(snapshot) {
  const search = ofKind(snapshot, 'search')[0]?.data;
  const lines = [
    `criteria: ${search?.roles.join(' / ')} · ${search?.locations.join(' / ') || 'anywhere'} · ` +
      `${search?.workModes.join('/')} · never ${search?.excludeCompanies.join(', ') || 'none'}`,
  ];

  for (const role of ofKind(snapshot, 'opportunity')) {
    lines.push(
      `${role.data.stage}: ${role.data.title} at ${companyOf(snapshot, role)} ` +
        `(${role.data.fit?.score ?? '–'}) ${role.data.url ?? ''}`,
    );
  }

  for (const decision of ofKind(snapshot, 'decision').filter((one) => one.data.status === 'open')) {
    lines.push(`asks: ${decision.data.question}`);
  }

  for (const insight of ofKind(snapshot, 'insight')) {
    lines.push(`card: ${insight.data.text}`);
  }

  return lines;
}
