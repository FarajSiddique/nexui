import assert from 'node:assert/strict';
import test from 'node:test';

import { KIND_CARDS } from '../packages/types/src/kinds/cards.ts';
import { KIND_REGISTRY } from '../packages/types/src/kinds/registry.ts';

const FIELD = /^(title|status|position|data\.[A-Za-z][A-Za-z0-9]{0,39})$/;

test('every registered kind has a card, and cards read only query fields', () => {
  assert.deepEqual(Object.keys(KIND_CARDS).sort(), Object.keys(KIND_REGISTRY).sort());

  for (const [kind, card] of Object.entries(KIND_CARDS)) {
    assert.match(card.title, FIELD, kind);

    for (const line of card.subtitle) {
      assert.match(line.field, FIELD, kind);
    }
  }
});
