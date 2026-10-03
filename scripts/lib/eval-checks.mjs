/**
 * The travel eval's automatic checks (spec addendum 2026-10-03, section 4). Pure functions over
 * a contract-shaped snapshot and run, so `tests/eval-checks.test.mjs` can pin them. A person
 * still judges the plans; these only catch what is plainly wrong.
 */
import { LENGTH_KEY, UNALLOCATED_KEY } from '../../apps/api/src/lib/kinds/trip.ts';
import { parseKindData, tripFigures, tripParts } from '../../packages/types/src/index.ts';

const check = (label, ok, detail) => (ok ? { label, ok } : { label, ok, detail });

const tripIdOf = (snapshot) => snapshot.workspace?.doc.anchorId ?? null;

const linked = (snapshot, sourceId, type, targetId) =>
  snapshot.relationships.some(
    (edge) => edge.type === type && edge.sourceId === sourceId && edge.targetId === targetId,
  );

const runDetail = (run) => `${run.status}${run.error ? `: ${run.error}` : ''}`;

/**
 * Why a place is outside the case's region, or null when it's inside.
 *
 * @example
 * regionProblem(tokyo, { countries: ['PT'] }) // 'Tokyo is in JP'
 */
export function regionProblem(place, testCase) {
  const { name, country, lat, lng } = place.data;

  if (testCase.countries && !testCase.countries.includes(country)) {
    return `${name} is in ${country}`;
  }

  if (testCase.box) {
    const [south, west, north, east] = testCase.box;

    if (lat < south || lat > north || lng < west || lng > east) {
      return `${name} (${lat}, ${lng}) is outside the expected area`;
    }
  }

  if (testCase.maxAbsLat !== undefined && Math.abs(lat) > testCase.maxAbsLat) {
    return `${name} is at latitude ${lat}`;
  }

  return null;
}

function daysCheck(figures, lengthOpen, testCase) {
  const { totalDays, unallocatedDays } = figures;
  const detail = `total ${totalDays ?? 'unknown'}, unallocated ${unallocatedDays ?? 'unknown'}`;
  const settled = totalDays !== null && unallocatedDays !== null && unallocatedDays >= 0;

  if (testCase.days) {
    const [min, max] = testCase.days;
    const span = min === max ? `${min}` : `${min} to ${max}`;

    return check(
      `the trip is ${span} days and fits its stops`,
      settled && totalDays >= min && totalDays <= max,
      detail,
    );
  }

  if (testCase.expectLengthQuestion) {
    return check('"How long is the trip?" is open', lengthOpen, detail);
  }

  return check('the days add up, or the length question is open', settled || lengthOpen, detail);
}

/** The checks on a plan its goal run made. */
export function goalChecks(snapshot, run, testCase) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return [check('the plan is a trip', false, 'it has no workspace')];
  }

  const { places, legs, decisions } = tripParts(snapshot, tripId);
  const invalid = snapshot.objects
    .map((object) => parseKindData(object.kind, object.data, object.kindVersion))
    .filter((parsed) => !parsed.ok)
    .map((parsed) => parsed.message);
  const missingLegs = places
    .slice(1)
    .map((to, index) => [places[index], to])
    .filter(
      ([from, to]) =>
        !legs.some(
          (leg) =>
            linked(snapshot, leg.id, 'leg_from', from.id) &&
            linked(snapshot, leg.id, 'leg_to', to.id),
        ),
    )
    .map(([from, to]) => `${from.title} → ${to.title}`);
  const outside = places.map((place) => regionProblem(place, testCase)).filter(Boolean);
  const countries = [...new Set(places.map((place) => place.data.country))];
  const lengthOpen = decisions.some(
    (decision) => decision.data.derivedKey === LENGTH_KEY && decision.data.status === 'open',
  );
  const stops = testCase.minStops === 1 ? '1 stop' : `${testCase.minStops} stops`;
  const checks = [
    check('the run succeeded', run.status === 'succeeded', runDetail(run)),
    check('every object passes its kind schema', invalid.length === 0, invalid.join('; ')),
    check(`at least ${stops}`, places.length >= testCase.minStops, `${places.length} stops`),
    check(
      'a leg joins each pair of stops',
      missingLegs.length === 0,
      `missing ${missingLegs.join(', ')}`,
    ),
    check('every stop is in the expected region', outside.length === 0, outside.join('; ')),
  ];

  if (testCase.oneCountry) {
    checks.push(check('every stop is in one country', countries.length <= 1, countries.join(', ')));
  }

  checks.push(daysCheck(tripFigures(snapshot, tripId), lengthOpen, testCase));

  return checks;
}

/** The unallocated insight's own ask, or null when no days are free. */
export function askPromptOf(snapshot) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return null;
  }

  const insight = tripParts(snapshot, tripId).insights.find(
    (candidate) => candidate.data.derivedKey === UNALLOCATED_KEY,
  );

  return insight?.data.actions.find((action) => action.type === 'ask')?.prompt ?? null;
}

/** The checks on what the insight's ask (`run`) added to the plan. */
export function askChecks(snapshot, run, testCase) {
  const tripId = tripIdOf(snapshot);
  const { places, decisions } = tripParts(snapshot, tripId);
  const proposed = decisions.filter(
    (decision) =>
      decision.data.status === 'open' &&
      decision.source?.type === 'ai' &&
      decision.source.runId === run.id,
  );
  const checks = [
    check('the ask run succeeded', run.status === 'succeeded', runDetail(run)),
    check(
      'the ask proposed one open decision',
      proposed.length === 1,
      `${proposed.length} proposed`,
    ),
  ];
  const decision = proposed[0];

  if (!decision) {
    return checks;
  }

  const options = snapshot.relationships
    .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
    .map((edge) => snapshot.objects.find((object) => object.id === edge.sourceId))
    .filter(Boolean);
  const candidates = options
    .map((option) => snapshot.objects.find((object) => object.id === option.data.placeId))
    .filter(Boolean);
  const country = places[0]?.data.country;
  const outside = candidates
    .map((place) => {
      const problem = regionProblem(place, testCase);

      if (problem) {
        return problem;
      }

      return testCase.oneCountry && country && place.data.country !== country
        ? `${place.data.name} is in ${place.data.country}`
        : null;
    })
    .filter(Boolean);
  const sections = snapshot.workspace?.doc.sections ?? [];

  checks.push(
    check(
      'it has 2 to 4 options',
      options.length >= 2 && options.length <= 4,
      `${options.length} options`,
    ),
    check(
      'every candidate place is in the expected region',
      outside.length === 0,
      outside.join('; '),
    ),
    check(
      'the decision is pinned in the workspace',
      sections.some((section) => section.type === 'decision' && section.decisionId === decision.id),
      'no section for it',
    ),
  );

  return checks;
}

/** The plan in three lines: stops with days, legs, and open questions with their options. */
export function describePlan(snapshot) {
  const tripId = tripIdOf(snapshot);

  if (!tripId) {
    return [];
  }

  const { places, legs, decisions } = tripParts(snapshot, tripId);
  const titleOf = (id) => snapshot.objects.find((object) => object.id === id)?.title ?? '?';
  const endOf = (leg, type) =>
    snapshot.relationships.find((edge) => edge.type === type && edge.sourceId === leg.id)?.targetId;
  const stops = places.map((place) => `${place.title} ${place.data.days}d`).join(' → ');
  const legLines = legs.map((leg) => {
    const hours = leg.data.estHours === undefined ? '' : ` ${leg.data.estHours}h`;

    return `${titleOf(endOf(leg, 'leg_from'))} → ${titleOf(endOf(leg, 'leg_to'))} ${leg.data.mode}${hours}`;
  });
  const open = decisions
    .filter((decision) => decision.data.status === 'open')
    .map((decision) => {
      const labels = snapshot.relationships
        .filter((edge) => edge.type === 'option_of' && edge.targetId === decision.id)
        .map((edge) => titleOf(edge.sourceId));

      return labels.length > 0
        ? `${decision.data.question} [${labels.join(' · ')}]`
        : decision.data.question;
    });

  return [
    `stops: ${stops || 'none'}`,
    `legs: ${legLines.join('; ') || 'none'}`,
    `open: ${open.join(' | ') || 'none'}`,
  ];
}
