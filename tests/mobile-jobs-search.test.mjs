import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addTo,
  forgetPassAction,
  removeFrom,
  salaryFloorAction,
  searchDetails,
  toggleWorkMode,
} from '../apps/mobile/src/features/jobs/search-details.ts';
import { jobObject, jobSnapshot, RESUME_ID, SEARCH_ID, searchData } from './support/jobs.mjs';

const passes = [
  { reason: 'too_junior', company: 'Northbeam', title: 'Lead PM', at: '2026-10-12T09:00:00.000Z' },
  { reason: 'not_this_company', company: 'Pennant', title: 'PM', at: '2026-10-13T09:00:00.000Z' },
];
const data = {
  ...searchData,
  salaryFloor: { amount: 120_000, currency: 'GBP' },
  excludeCompanies: ['Brightbank', 'Quayside'],
  passReasons: passes,
};
const resume = jobObject(
  RESUME_ID,
  'document',
  {
    docType: 'resume',
    body: 'Jordan Lee',
    profile: {
      currentTitle: 'Senior PM',
      currentEmployer: 'Brightbank',
      years: 8,
      skills: ['payments', 'risk', 'lending', 'pricing'],
      pastRoles: [],
    },
  },
  { updatedAt: '2026-10-12T09:00:00.000Z' },
);
const snapshot = jobSnapshot({ search: data, objects: [resume] });
const search = snapshot.objects.find((object) => object.id === SEARCH_ID);
const sent = (action) => action.request.input.data;

test('the search sheet shows its criteria, never-show list, passes and resume', () => {
  const details = searchDetails(snapshot, SEARCH_ID, 'Europe/London');

  assert.deepEqual(
    details.workModes.map((mode) => [mode.label, mode.on]),
    [
      ['Remote', true],
      ['Hybrid', true],
      ['On-site', false],
    ],
  );
  assert.equal(details.salaryFloor, '£120k');
  assert.deepEqual(details.neverShow, [
    { name: 'Brightbank', employer: true },
    { name: 'Quayside', employer: false },
  ]);
  assert.deepEqual(
    details.passes.map((pass) => pass.text),
    ['Not this company · Pennant', 'Too junior · Northbeam'],
  );
  assert.deepEqual(details.resume, {
    read: 'Oct 12',
    profile: 'Senior PM at Brightbank · 8 years · payments, risk, lending',
  });
  assert.equal(searchDetails(snapshot, RESUME_ID), null);
});

test('lists take a new entry once, within their limits, and keep one role', () => {
  assert.deepEqual(sent(addTo(search, 'locations', '  Leeds ')), {
    locations: ['London', 'Leeds'],
  });
  assert.equal(addTo(search, 'locations', 'london'), null);
  assert.equal(addTo(search, 'roles', '   '), null);
  assert.equal(addTo(search, 'industries', 'x'.repeat(61)), null);
  assert.equal(
    addTo({ ...search, data: { ...data, roles: ['a', 'b', 'c', 'd', 'e'] } }, 'roles', 'f'),
    null,
  );
  assert.equal(removeFrom(search, 'roles', 'Staff Product Manager'), null);
  assert.deepEqual(sent(removeFrom(search, 'excludeCompanies', 'Quayside')), {
    excludeCompanies: ['Brightbank'],
  });

  const edit = addTo(search, 'industries', 'payments');

  assert.equal(edit.request.name, 'object.update');
  assert.equal(edit.request.input.ref, SEARCH_ID);
  assert.deepEqual(edit.optimistic[0].patch.data.industries, ['fintech', 'payments']);
});

test('work modes never all turn off, and the floor changes in its own currency', () => {
  assert.deepEqual(sent(toggleWorkMode(search, 'onsite')), {
    workModes: ['remote', 'hybrid', 'onsite'],
  });
  assert.deepEqual(sent(toggleWorkMode(search, 'hybrid')), { workModes: ['remote'] });

  const remoteOnly = { ...search, data: { ...data, workModes: ['remote'] } };

  assert.equal(toggleWorkMode(remoteOnly, 'remote'), null);
  assert.deepEqual(sent(salaryFloorAction(search, '£130,000')), {
    salaryFloor: { amount: 130_000, currency: 'GBP' },
  });
  assert.deepEqual(sent(salaryFloorAction(search, '135k')).salaryFloor.amount, 135_000);
  assert.equal(salaryFloorAction(search, 'lots'), null);
  assert.equal(salaryFloorAction(search, '120000'), null);
  assert.equal(salaryFloorAction({ ...search, data: { ...searchData } }, '100000'), null);
});

test('forgetting a pass removes it at once and asks the server to', () => {
  const action = forgetPassAction(search, passes[0].at);

  assert.deepEqual(action.request, { name: 'jobs.forgetPass', input: { at: passes[0].at } });
  assert.deepEqual(action.optimistic[0].patch.data.passReasons, [passes[1]]);
});
