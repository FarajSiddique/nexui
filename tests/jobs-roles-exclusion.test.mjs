import assert from 'node:assert/strict';
import test from 'node:test';

import { companyKey, isExcluded } from '../apps/api/src/lib/jobs/roles.ts';

const search = (...excludeCompanies) => ({ excludeCompanies });

test('a company key ignores case, spacing, punctuation and one legal suffix', () => {
  assert.equal(companyKey('Jane Street'), companyKey('Janestreet'));
  assert.equal(companyKey('Jane Street'), companyKey('jane-street'));
  assert.equal(companyKey('Ledgerly'), companyKey('Ledgerly Ltd'));
  assert.equal(companyKey('Acme, Inc.'), companyKey('Acme'));
  assert.notEqual(companyKey('Meta'), companyKey('Metabase'));
});

test('the never-show list matches a company however it is spelt, or its board token', () => {
  assert.equal(isExcluded(search('Jane Street'), 'Janestreet'), true);
  assert.equal(isExcluded(search('Ledgerly'), 'Ledgerly Ltd'), true);
  assert.equal(isExcluded(search('Acme, Inc.'), 'ACME'), true);
  assert.equal(isExcluded(search('Meta'), 'Metabase'), false);
  assert.equal(isExcluded(search('Jane Street'), 'Trading Arm', 'janestreet'), true);
  assert.equal(isExcluded(search('Meta'), 'Metabase', 'metabase'), false);
});
