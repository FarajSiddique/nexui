import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSnapshotRow } from '../apps/api/src/lib/graph/mappers.ts';
import { KIND_BEHAVIOUR } from '../apps/api/src/lib/kinds/behaviour.ts';
import { deriveForTemplate } from '../apps/api/src/lib/templates/derive.ts';
import { TEMPLATES, templateFor } from '../apps/api/src/lib/templates/registry.ts';
import { travelWorkspace } from '../apps/api/src/lib/travel/seed.ts';
import { KIND_REGISTRY, templateSchema } from '../packages/types/src/index.ts';
import { idSequence, intentRow, LATER, snapshotRow, TRIP_ID } from './support/graph.mjs';

test('every template has one definition, under its own name', () => {
  assert.deepEqual(Object.keys(TEMPLATES), templateSchema.options);

  for (const [name, template] of Object.entries(TEMPLATES)) {
    assert.equal(template.name, name);
  }

  assert.equal(templateFor(null), null);
});

test('a template’s kinds are registered, and its anchor is editable but never created', () => {
  for (const template of Object.values(TEMPLATES)) {
    for (const kind of template.kinds) {
      assert.ok(Object.hasOwn(KIND_REGISTRY, kind), `${template.name}: ${kind}`);
    }

    assert.ok(template.kinds.includes(template.anchorKind), template.name);
    assert.equal(KIND_BEHAVIOUR[template.anchorKind].editable, true, template.name);
    assert.equal(KIND_BEHAVIOUR[template.anchorKind].creatable, false, template.name);
  }
});

test('a template’s capabilities create only its own kinds, and each name once', () => {
  for (const template of Object.values(TEMPLATES)) {
    const names = template.capabilities.map((capability) => capability.name);
    const create = template.capabilities.find((capability) => capability.name === 'object.create');

    assert.equal(new Set(names).size, names.length, template.name);

    for (const kind of create.input.toJSONSchema().properties.kind.enum) {
      assert.ok(template.kinds.includes(kind), `${template.name} creates ${kind}`);
      assert.equal(KIND_BEHAVIOUR[kind].creatable, true, kind);
    }
  }
});

test('a trip’s seed is its anchor and its workspace', () => {
  const ops = TEMPLATES.travel.seed('Plan Japan', idSequence());

  assert.deepEqual(
    ops.map((op) => op.op),
    ['insert_object', 'set_workspace'],
  );
  assert.equal(ops[0].kind, TEMPLATES.travel.anchorKind);
});

test('an intent Nexui can’t plan yet derives nothing', () => {
  const row = snapshotRow(travelWorkspace(TRIP_ID), { intent: { ...intentRow, template: null } });
  const snapshot = mapSnapshotRow({ ...row, workspace: null });

  assert.deepEqual(deriveForTemplate(snapshot, snapshot, [], LATER, idSequence()), []);
});
