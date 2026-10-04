// Spec section I: every color is a token with a light and a dark value, text pairs pass WCAG
// AA in both themes, and no file but theme.ts holds a raw color.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { palettes } from '../apps/mobile/src/lib/theme.ts';

const expected = {
  light: {
    paper: '#F2F0F6',
    card: '#FFFFFF',
    ink: '#1E1A2B',
    muted: '#5B5670',
    faint: '#6B6582',
    soft: '#F6F4FA',
    line: '#E4E0EC',
    accent: '#FFE45C',
    accentInk: '#1E1A2B',
    success: '#1D7A52',
    danger: '#B3322C',
    scrim: 'rgba(30, 26, 43, 0.38)',
    shade: 'rgba(30, 26, 43, 0.10)',
    aiMark: '#FFE45C',
    aiChip: '#FFE45C',
    aiChipInk: '#1E1A2B',
    userMark: '#1E1A2B',
    mapLand: '#FFFFFF',
    mapSea: '#E3DFED',
    mapRoute: '#1E1A2B',
    mapPin: '#1E1A2B',
    mapPinInk: '#FFFFFF',
    skyTrack: '#D6CEF2',
    skyOrb: '#FFE45C',
    skyGlow: 'rgba(255, 228, 92, 0.22)',
    skyDetail: '#FFFFFF',
    skyCrater: 'rgba(30, 26, 43, 0.14)',
  },
  dark: {
    paper: '#15131B',
    card: '#211E2A',
    ink: '#F2EFF8',
    muted: '#B6B0C6',
    faint: '#A09AB2',
    soft: '#2A2635',
    line: '#363142',
    accent: '#FFE45C',
    accentInk: '#1E1A2B',
    success: '#5FD49B',
    danger: '#FF8A80',
    scrim: 'rgba(0, 0, 0, 0.58)',
    shade: 'rgba(0, 0, 0, 0.40)',
    aiMark: 'rgba(255, 228, 92, 0.28)',
    aiChip: 'rgba(255, 228, 92, 0.16)',
    aiChipInk: '#FFE45C',
    userMark: '#F2EFF8',
    mapLand: '#2A2635',
    mapSea: '#1A1722',
    mapRoute: '#FFE45C',
    mapPin: '#F2EFF8',
    mapPinInk: '#15131B',
    skyTrack: '#14112A',
    skyOrb: '#ECE8F5',
    skyGlow: 'rgba(236, 232, 245, 0.06)',
    skyDetail: '#F2EFF8',
    skyCrater: 'rgba(30, 26, 43, 0.14)',
  },
};

test('both schemes carry exactly the specified tokens', () => {
  assert.deepEqual(palettes.light, expected.light);
  assert.deepEqual(palettes.dark, expected.dark);
  assert.deepEqual(Object.keys(palettes.light).sort(), Object.keys(palettes.dark).sort());
});

function parse(color) {
  if (color.startsWith('#')) {
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).concat(1);
  }

  const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);

  return [r, g, b, a];
}

// Composites a (possibly translucent) color over an opaque base.
function over(color, base) {
  const [r, g, b, a] = parse(color);
  const [br, bg, bb] = parse(base);

  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
}

const textPairs = [
  ...['ink', 'muted', 'faint'].flatMap((fg) => ['paper', 'card', 'soft'].map((bg) => [fg, bg])),
  ['accentInk', 'accent'],
  ['aiChipInk', 'aiChip'],
  ['ink', 'aiMark'],
  ['success', 'card'],
  ['success', 'soft'],
  ['danger', 'card'],
  ['danger', 'soft'],
  ['ink', 'line'],
  ['card', 'userMark'],
];

for (const scheme of ['light', 'dark']) {
  test(`text pairs pass WCAG AA in ${scheme}`, () => {
    const p = palettes[scheme];

    for (const [fg, bg] of textPairs) {
      const ratio = contrast(over(p[fg], p.card), over(p[bg], p.card));

      assert.ok(ratio >= 4.5, `${scheme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no mobile file but theme.ts holds a raw color', () => {
  const root = 'apps/mobile/src';
  const raw = /#[0-9A-Fa-f]{3,8}\b|rgba?\(|['"](white|black)['"]/;
  const offenders = sourceFiles(root)
    .filter((path) => relative(root, path) !== join('lib', 'theme.ts'))
    .filter((path) => raw.test(readFileSync(path, 'utf8')));

  assert.deepEqual(offenders, []);
});
