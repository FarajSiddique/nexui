/**
 * Nexui's color tokens, one set per color scheme, and the font faces. Components never use raw
 * colors: they read a palette through `useColors()` or `createThemedStyles()` in
 * `use-theme.ts`. `tests/theme-tokens.test.mjs` checks both sets and their contrast.
 */
const light = {
  paper: '#F2F0F6', // screen background
  card: '#FFFFFF', // cards, sheets, tab bar
  ink: '#1E1A2B',
  muted: '#5B5670',
  faint: '#6B6582',
  soft: '#F6F4FA', // steppers, inputs, secondary buttons
  line: '#E4E0EC',
  accent: '#FFE45C', // primary buttons, +, the unallocated metric
  accentInk: '#1E1A2B', // text on accent, in both schemes
  success: '#1D7A52',
  danger: '#B3322C',
  scrim: 'rgba(30, 26, 43, 0.38)',
  shade: 'rgba(30, 26, 43, 0.10)',
  aiMark: '#FFE45C', // highlighter behind text Nexui wrote
  aiChip: '#FFE45C', // "Nexui" tag
  aiChipInk: '#1E1A2B',
  userMark: '#1E1A2B', // "You" avatar, route stop numbers
  mapLand: '#FFFFFF',
  mapSea: '#E3DFED',
  mapRoute: '#1E1A2B',
  mapPin: '#1E1A2B',
  mapPinInk: '#FFFFFF',
  skyTrack: '#D6CEF2', // Appearance switch: the day sky, or the night sky in dark
  skyOrb: '#FFE45C', // the sun, or the moon in dark
  skyGlow: 'rgba(255, 228, 92, 0.22)',
  skyDetail: '#FFFFFF', // clouds, or stars in dark
  skyCrater: 'rgba(30, 26, 43, 0.14)',
} as const;

export type TokenName = keyof typeof light;
export type Palette = Record<TokenName, string>;
export type Scheme = 'light' | 'dark';

const dark: Palette = {
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
  aiMark: 'rgba(255, 228, 92, 0.28)', // a wash: light text stays readable on it
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
};

export const palettes: Record<Scheme, Palette> = { light, dark };

// Custom faces carry their weight in the family name, so styles omit fontWeight.
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  heading: 'BricolageGrotesque_700Bold',
  input: 'BricolageGrotesque_500Medium',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
} as const;
