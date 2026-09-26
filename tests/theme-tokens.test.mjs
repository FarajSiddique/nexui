// Contract for anchored-shell.md, Slice A "Visual tokens": `colors` in
// apps/mobile/src/lib/theme.ts carries the listed tokens with these exact values; `markers`
// stays as it is, and yellow `when` equals `accent` on purpose. Extra legacy names (such as
// `page` while screens move) are not checked here.
import assert from 'node:assert/strict';
import test from 'node:test';

import { colors, markers } from '../apps/mobile/src/lib/theme.ts';

const tokens = {
  paper: '#F2F0F6',
  card: '#FFFFFF',
  ink: '#1E1A2B',
  muted: '#5B5670',
  faint: '#8A859C',
  soft: '#F6F4FA',
  line: '#E4E0EC',
  accent: '#FFE45C',
  accentInk: '#1E1A2B',
  success: '#1D7A52',
  danger: '#B3322C',
  scrim: 'rgba(30, 26, 43, 0.38)',
};

test('every shell color token has the specified value', () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.equal(colors[name], value, `colors.${name}`);
  }
});

test('marker colors are unchanged and the when marker matches the accent', () => {
  assert.deepEqual(markers, {
    when: '#FFE45C',
    range: '#FFE45C',
    attendees: '#FFB3D4',
    location: '#9FEBC3',
    duration: '#A8DBFF',
    priority: '#FFC59A',
  });
  assert.equal(markers.when, colors.accent);
});
