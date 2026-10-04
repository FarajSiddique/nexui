import assert from 'node:assert/strict';
import test from 'node:test';

import { planDeletes } from '../apps/mobile/src/data/plan-deletes.ts';

const attempt = (id, status, submittedAt) => ({ id, status, submittedAt });

test('a plan being deleted is hidden, and one whose delete failed is offered again', () => {
  assert.deepEqual(planDeletes([attempt('a', 'pending', 1), attempt('b', 'error', 2)]), {
    deleting: ['a'],
    failed: ['b'],
  });
});

test('one plan’s failure outlasts another plan’s success', () => {
  assert.deepEqual(planDeletes([attempt('a', 'error', 1), attempt('b', 'success', 2)]), {
    deleting: [],
    failed: ['a'],
  });
});

test('only a plan’s latest delete counts, so a retry replaces its failure', () => {
  assert.deepEqual(planDeletes([attempt('a', 'error', 1), attempt('a', 'pending', 2)]), {
    deleting: ['a'],
    failed: [],
  });
  assert.deepEqual(planDeletes([attempt('a', 'pending', 3), attempt('a', 'error', 1)]), {
    deleting: ['a'],
    failed: [],
  });
  assert.deepEqual(planDeletes([attempt('a', 'error', 1), attempt('a', 'success', 2)]), {
    deleting: [],
    failed: [],
  });
});

test('no deletes means nothing hidden and nothing to retry', () => {
  assert.deepEqual(planDeletes([]), { deleting: [], failed: [] });
});
