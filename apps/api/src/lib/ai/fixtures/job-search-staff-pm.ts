import type { RunFixture } from './types.ts';

// Written by hand, not recorded, about a fictional person. Jev answers `job_search` for any goal
// with "staff pm"; the resume read answers this fictional resume; the build run sets the
// criteria. With board lookups off (no NEXUI_CONTACT), its scan finds nothing, so the smoke
// test's counts hold.
export const jobSearchStaffPm: RunFixture = {
  name: 'job-search-staff-pm',
  kind: 'create_intent',
  match: ['staff pm'],
  perception: { template: 'job_search' },
  output: {
    readable: true,
    isResume: true,
    text:
      'Priya Rao\nSenior Product Manager, Ledgerly (2019 to now)\nPayments and risk products ' +
      'for small businesses\nProduct Manager, Tessera (2016 to 2019)',
    profile: {
      headline: 'Payments product manager',
      currentTitle: 'Senior Product Manager',
      currentEmployer: 'Ledgerly',
      location: 'London',
      years: 9,
      skills: ['Payments', 'Risk', 'B2B SaaS'],
      pastRoles: [{ title: 'Product Manager', company: 'Tessera', years: 3 }],
    },
  },
  steps: [
    [
      {
        capability: 'object.update',
        input: {
          ref: 'search',
          data: {
            roles: ['Staff Product Manager'],
            locations: ['London'],
            workModes: ['hybrid', 'remote'],
            industries: ['Fintech'],
          },
        },
      },
    ],
  ],
};
