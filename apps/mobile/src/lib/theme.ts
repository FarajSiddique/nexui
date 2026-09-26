import type { HighlightField } from '@nexui/types';

export const colors = {
  paper: '#F2F0F6', // screen background
  card: '#FFFFFF', // cards, sheets, tab bar
  ink: '#1E1A2B',
  muted: '#5B5670',
  faint: '#8A859C',
  soft: '#F6F4FA', // chips, avatar circles, input fill inside white sheets
  line: '#E4E0EC',
  accent: '#FFE45C', // main buttons, active tab, suggestion edge
  accentInk: '#1E1A2B', // text on accent
  success: '#1D7A52',
  danger: '#B3322C',
  scrim: 'rgba(30, 26, 43, 0.38)',
} as const;

// One marker color per kind of detail, used on the input and on the draft alike.
export const markers: Record<HighlightField, string> = {
  when: '#FFE45C',
  range: '#FFE45C',
  attendees: '#FFB3D4',
  location: '#9FEBC3',
  duration: '#A8DBFF',
  priority: '#FFC59A',
};

// Custom faces carry their weight in the family name, so styles omit fontWeight.
export const fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  heading: 'BricolageGrotesque_700Bold',
  input: 'BricolageGrotesque_500Medium',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
} as const;
