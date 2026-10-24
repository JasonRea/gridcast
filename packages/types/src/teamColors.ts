/**
 * Team display colors. Each team gets one display color for player fills: its primary, unless the
 * primary is near-black and would vanish on the black background, in which case the first
 * visible official color is used. Jersey numbers use the team's black (or darkest color).
 *
 * PIT and NO are hardcoded from the PRD. The other teams are official colors from
 * teamcolorcodes.com, used when ESPN's `color` / `alternateColor` are missing.
 */

export type TeamColors = {
  /** Official colors, primary first. */
  official: readonly string[];
  /** Fill for player circles and accents. */
  display: string;
  /** Jersey number text inside the circle. */
  number: string;
};

/** Hardcoded per the PRD "Team colors" table. */
export const STEELERS: TeamColors = {
  official: ['#101820', '#FFB612'],
  display: '#FFB612',
  number: '#101820',
};

export const SAINTS: TeamColors = {
  official: ['#101820', '#D3BC8D'],
  display: '#D3BC8D',
  number: '#101820',
};

/** Official palettes, primary first (teamcolorcodes.com). */
const OFFICIAL: Record<string, readonly string[]> = {
  ARI: ['#97233F', '#000000', '#FFB612'],
  ATL: ['#A71930', '#000000', '#A5ACAF'],
  BAL: ['#241773', '#000000', '#9E7C0C'],
  BUF: ['#00338D', '#C60C30'],
  CAR: ['#0085CA', '#101820', '#BFC0BF'],
  CHI: ['#0B162A', '#C83803'],
  CIN: ['#FB4F14', '#000000'],
  CLE: ['#311D00', '#FF3C00'],
  DAL: ['#003594', '#041E42', '#869397'],
  DEN: ['#FB4F14', '#002244'],
  DET: ['#0076B6', '#B0B7BC', '#000000'],
  GB: ['#203731', '#FFB612'],
  HOU: ['#03202F', '#A71930'],
  IND: ['#002C5F', '#A2AAAD'],
  JAX: ['#101820', '#D7A22A', '#006778'],
  KC: ['#E31837', '#FFB81C'],
  LV: ['#000000', '#A5ACAF'],
  LAC: ['#0080C6', '#FFC20E'],
  LAR: ['#003594', '#FFA300'],
  MIA: ['#008E97', '#FC4C02'],
  MIN: ['#4F2683', '#FFC62F'],
  NE: ['#002244', '#C60C30', '#B0B7BC'],
  NO: SAINTS.official,
  NYG: ['#0B2265', '#A71930'],
  NYJ: ['#125740', '#000000'],
  PHI: ['#004C54', '#A5ACAF', '#000000'],
  PIT: STEELERS.official,
  SF: ['#AA0000', '#B3995D'],
  SEA: ['#002244', '#69BE28', '#A5ACAF'],
  TB: ['#D50A0A', '#FF7900', '#0A0A08'],
  TEN: ['#0C2340', '#4B92DB', '#C8102E'],
  WSH: ['#5A1414', '#FFB612'],
};

/** nflverse / legacy abbreviations to ESPN's. */
const ABBR_ALIASES: Record<string, string> = {
  LA: 'LAR',
  STL: 'LAR',
  WAS: 'WSH',
  JAC: 'JAX',
  OAK: 'LV',
  SD: 'LAC',
  SL: 'LAR',
  ARZ: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
};

export function normalizeAbbr(abbr: string): string {
  const up = abbr.trim().toUpperCase();
  return ABBR_ALIASES[up] ?? up;
}

export const TEAM_ABBRS: readonly string[] = Object.keys(OFFICIAL);

function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Below this luminance a color counts as near-black on the #000 background. */
export const NEAR_BLACK = 0.05;

function withHash(c: string): string {
  return c.startsWith('#') ? c.toUpperCase() : `#${c.toUpperCase()}`;
}

/** Applies the near-black rule to a palette (primary first). */
export function colorsFromPalette(palette: readonly string[]): TeamColors {
  const official = palette.filter((c) => hexToRgb(c)).map(withHash);
  const display = official.find((c) => luminance(c) >= NEAR_BLACK) ?? '#FFFFFF';
  const darkest = [...official].sort((a, b) => luminance(a) - luminance(b))[0];
  const number = darkest && contrast(darkest, display) >= 4.5 ? darkest : '#000000';
  return { official, display, number };
}

/**
 * Colors for a team. PIT and NO are fixed; other teams use ESPN's `color` / `alternateColor` when
 * given, else the built-in official palette.
 */
export function teamColors(
  abbr: string,
  espn?: { color?: string; alternateColor?: string },
): TeamColors {
  const key = normalizeAbbr(abbr);
  if (key === 'PIT') return STEELERS;
  if (key === 'NO') return SAINTS;
  const builtIn = OFFICIAL[key];
  if (builtIn) return colorsFromPalette(builtIn);
  const fromEspn = [espn?.color, espn?.alternateColor].filter((c): c is string => !!c);
  return colorsFromPalette(fromEspn.length ? fromEspn : ['#FFFFFF']);
}

function colorDistance(a: string, b: string): number {
  const x = hexToRgb(a) ?? [0, 0, 0];
  const y = hexToRgb(b) ?? [0, 0, 0];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * Keeps the two sides on the field distinguishable. If the display colors are too close, the away
 * team switches to its next visible official color (or white).
 */
export function matchupColors(
  home: TeamColors,
  away: TeamColors,
): { home: TeamColors; away: TeamColors } {
  const MIN_DISTANCE = 60;
  if (colorDistance(home.display, away.display) >= MIN_DISTANCE) return { home, away };
  const alt =
    away.official.find(
      (c) => luminance(c) >= NEAR_BLACK && colorDistance(c, home.display) >= MIN_DISTANCE,
    ) ?? '#FFFFFF';
  const number = contrast(away.number, alt) >= 4.5 ? away.number : '#000000';
  return { home, away: { ...away, display: alt, number } };
}
