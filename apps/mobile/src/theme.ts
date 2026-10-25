/** Design tokens, copied exactly from apps/web/src/index.css (`@theme`) and PRD "Design system". */
export const colors = {
  background: '#000000',
  surface: '#0e0e0e',
  raised: '#1a1a1a',
  border: '#242424',
  text: '#ffffff',
  muted: '#8a8a8a',
  live: '#ff3b30',
  stale: '#ffb020',
  firstDown: '#ffd60a',
  scrimmage: '#0a84ff',
  positive: '#30d158',
  negative: '#ff453a',
} as const;

export const radius = { sm: 4, md: 6, sheet: 8 } as const;

export const space = (n: number) => n * 4;

/** Font family names as registered with expo-font in app/_layout.tsx. */
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  display: 'BarlowCondensed_700Bold',
  displaySemi: 'BarlowCondensed_600SemiBold',
} as const;

/** Tabular numerals for scores, clocks and stats. */
export const tabular = { fontVariant: ['tabular-nums' as const] };
