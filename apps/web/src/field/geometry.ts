/**
 * Field coordinates. SVG user units are tenths of a yard: the field is 1200 x 533.
 * x runs 0..120 yards left to right (end zones 0-10 and 110-120). The home team defends the left
 * end zone and drives right; the away team drives left.
 */
export const SCALE = 10;
export const FIELD_W = 120 * SCALE;
export const FIELD_H = 53.3 * SCALE;
export const CENTER_Y = FIELD_H / 2;

export type Pt = { x: number; y: number };

export type Orientation = {
  /** Team abbreviation driving right (+x). */
  homeAbbr: string;
};

/** +1 when this team drives toward +x. */
export function dirOf(team: string, o: Orientation): 1 | -1 {
  return team === o.homeAbbr ? 1 : -1;
}

/** Absolute x (SVG units) of a spot `yd` yards from `team`'s own goal line. */
export function absX(team: string, yd: number, o: Orientation): number {
  const clamped = Math.max(-10, Math.min(110, yd));
  return (dirOf(team, o) === 1 ? 10 + clamped : 110 - clamped) * SCALE;
}

/**
 * A point relative to the line of scrimmage, in the offense's frame: `dx` yards downfield
 * (negative = backfield), `dy` yards to the offense's right (negative = left).
 */
export function rel(
  team: string,
  losYd: number,
  dx: number,
  dy: number,
  o: Orientation,
  ballY = CENTER_Y,
): Pt {
  const d = dirOf(team, o);
  const x = absX(team, losYd, o) + d * dx * SCALE;
  // Driving right (+x), the offense's right hand points down the screen (+y).
  const y = ballY + d * dy * SCALE;
  return { x, y: Math.max(8, Math.min(FIELD_H - 8, y)) };
}

export function lateralFor(direction: 'left' | 'middle' | 'right' | undefined, wide = 8): number {
  return direction === 'left' ? -wide : direction === 'right' ? wide : 0;
}
