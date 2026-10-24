import { z } from 'zod';

export const GameStateSchema = z.object({
  quarter: z.number().int(),
  /** Game clock "MM:SS" for the current quarter. */
  clock: z.string(),
  down: z.number().int().optional(),
  distance: z.number().optional(),
  /** 0-100, yards from the possession team's own goal line. */
  yardLine: z.number(),
  /** Team abbreviation with the ball. */
  possession: z.string(),
  home: z.number().int(),
  away: z.number().int(),
  timeouts: z.object({ home: z.number().int(), away: z.number().int() }),
});
export type GameState = z.infer<typeof GameStateSchema>;
