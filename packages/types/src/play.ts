import { z } from 'zod';

export const PlayTypeSchema = z.enum([
  'run',
  'pass',
  'sack',
  'punt',
  'kickoff',
  'fg',
  'pat',
  'penalty',
  'kneel',
  'spike',
  'other',
]);
export type PlayType = z.infer<typeof PlayTypeSchema>;

export const PlayResultSchema = z.enum([
  'complete',
  'incomplete',
  'interception',
  'fumble',
  'td',
  'good',
  'no_good',
  'touchback',
  'normal',
]);
export type PlayResult = z.infer<typeof PlayResultSchema>;

export const DirectionSchema = z.enum(['left', 'middle', 'right']);
export type Direction = z.infer<typeof DirectionSchema>;

export const DepthSchema = z.enum(['short', 'deep']);
export type Depth = z.infer<typeof DepthSchema>;

export const GapSchema = z.enum(['end', 'tackle', 'guard', 'middle']);
export type Gap = z.infer<typeof GapSchema>;

export const PlayerRoleSchema = z.enum([
  'passer',
  'rusher',
  'receiver',
  'tackler',
  'kicker',
  'returner',
]);
export type PlayerRole = z.infer<typeof PlayerRoleSchema>;

export const FormationSchema = z.enum([
  'shotgun',
  'under_center',
  'pistol',
  'empty',
  'punt',
  'kickoff',
  'fg',
  'victory',
]);
export type Formation = z.infer<typeof FormationSchema>;

export const PlayPlayerSchema = z.object({
  role: PlayerRoleSchema,
  /** Name as written in the play text, e.g. "A.Rodgers". */
  name: z.string(),
  /** Team abbreviation (ESPN style, e.g. "PIT"). Empty string when unknown. */
  team: z.string(),
  /** Jersey number when the text includes it (nflverse style "8-A.Rodgers"). */
  jersey: z.number().int().optional(),
});
export type PlayPlayer = z.infer<typeof PlayPlayerSchema>;

export const PenaltyInfoSchema = z.object({
  name: z.string(),
  team: z.string(),
  yards: z.number(),
  accepted: z.boolean(),
  /** "No Play": the down is replayed and the play's own result is wiped. */
  noPlay: z.boolean(),
  /** Both teams fouled; penalties cancel and the down is replayed. */
  offsetting: z.boolean().optional(),
  player: z.string().optional(),
});
export type PenaltyInfo = z.infer<typeof PenaltyInfoSchema>;

export const ParsedPlaySchema = z.object({
  type: PlayTypeSchema,
  result: PlayResultSchema,
  direction: DirectionSchema.optional(),
  depth: DepthSchema.optional(),
  gap: GapSchema.optional(),
  /** Net yards gained by the offense on the play (penalty yards excluded). */
  yards: z.number(),
  airYards: z.number().optional(),
  /** 0-100, yards from the offense's own goal line at the snap. */
  startYd: z.number(),
  /** 0-100, yards from the offense's own goal line where the ball ends up. */
  endYd: z.number(),
  players: z.array(PlayPlayerSchema),
  formation: FormationSchema.optional(),
  penalty: PenaltyInfoSchema.optional(),
  /** Parser self-check, 0-1. Below 0.6 the field uses the generic animation. */
  confidence: z.number().min(0).max(1),

  // Optional extras the field, cards and commentary use.
  noHuddle: z.boolean().optional(),
  scramble: z.boolean().optional(),
  firstDown: z.boolean().optional(),
  /** True when the other team has the ball after the play (turnover, kick). */
  possessionChange: z.boolean().optional(),
  points: z.number().optional(),
  kickYards: z.number().optional(),
  returnYards: z.number().optional(),
  fairCatch: z.boolean().optional(),
  outOfBounds: z.boolean().optional(),
  twoPoint: z.boolean().optional(),
  injured: z.array(z.string()).optional(),
  review: z.boolean().optional(),
});
export type ParsedPlay = z.infer<typeof ParsedPlaySchema>;

/** Input to the deterministic parser: play text plus ESPN structured fields. */
export const ParserInputSchema = z.object({
  text: z.string(),
  /** ESPN play type text, e.g. "Pass Reception", "Rush", "Sack". */
  espnType: z.string().optional(),
  down: z.number().optional(),
  distance: z.number().optional(),
  /** Yards to the end zone at the snap (ESPN start.yardsToEndzone, nflverse yardline_100). */
  yardsToEndzone: z.number().optional(),
  /** Yards to the end zone after the play when ESPN provides it. */
  endYardsToEndzone: z.number().optional(),
  statYardage: z.number().optional(),
  scoringPlay: z.boolean().optional(),
  quarter: z.number().optional(),
  clock: z.string().optional(),
  /** Offense team abbreviation. */
  offense: z.string().optional(),
  /** Defense team abbreviation. */
  defense: z.string().optional(),
});
export type ParserInput = z.infer<typeof ParserInputSchema>;
