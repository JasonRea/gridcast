/** Shapes returned by the Gridcast server API. The web app only talks to these. */
import { z } from 'zod';
import { GameStateSchema } from './state.ts';
import { PreviewSchema } from './analytics.ts';
import { LoggedEventSchema } from './events.ts';

export const GameStatusSchema = z.enum(['pre', 'live', 'final']);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const TeamInfoSchema = z.object({
  id: z.string(),
  abbr: z.string(),
  name: z.string(),
  shortName: z.string(),
  /** Display color used for player fills and accents. */
  color: z.string(),
  /** Jersey number text color inside player circles. */
  numberColor: z.string(),
  logo: z.string().optional(),
  record: z.string().optional(),
});
export type TeamInfo = z.infer<typeof TeamInfoSchema>;

export const GameCardSchema = z.object({
  id: z.string(),
  status: GameStatusSchema,
  /** ISO kickoff time. */
  kickoff: z.string(),
  season: z.number().optional(),
  week: z.number().optional(),
  home: TeamInfoSchema.extend({ score: z.number().optional() }),
  away: TeamInfoSchema.extend({ score: z.number().optional() }),
  /** "Q3 4:12", "Final", "Final/OT", "Sun 9:30 AM". */
  detail: z.string(),
  possession: z.string().optional(),
  downDistance: z.string().optional(),
  tv: z.string().optional(),
  venue: z.string().optional(),
  /** "PIT -3" */
  spread: z.string().optional(),
  total: z.number().optional(),
  /** ESPN home win probability 0-1. */
  homeWinProb: z.number().optional(),
  /** Kalshi home win price 0-1. */
  kalshiHomeProb: z.number().optional(),
  topPerformer: z.string().optional(),
  featured: z.boolean().optional(),
  demo: z.boolean().optional(),
  /** "fixture" when the server is serving saved data because the live feed failed. */
  dataSource: z.enum(['live', 'fixture']).optional(),
});
export type GameCard = z.infer<typeof GameCardSchema>;

export const ScoreboardResponseSchema = z.object({
  season: z.number(),
  week: z.number(),
  games: z.array(GameCardSchema),
  dataSource: z.enum(['live', 'fixture']),
});
export type ScoreboardResponse = z.infer<typeof ScoreboardResponseSchema>;

export const RosterPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "A.Rodgers", matching play text. */
  shortName: z.string(),
  lastName: z.string(),
  jersey: z.number().optional(),
  position: z.string(),
});
export type RosterPlayer = z.infer<typeof RosterPlayerSchema>;

/** Position key (QB, RB, WR, TE, LT, ..., CB, S, K, P) to players in depth order. */
export const DepthChartSchema = z.record(z.string(), z.array(RosterPlayerSchema));
export type DepthChart = z.infer<typeof DepthChartSchema>;

export const GameDetailSchema = GameCardSchema.extend({
  /** Current source of the event stream for this game. */
  source: z.enum(['live', 'replay']),
  state: GameStateSchema.optional(),
  rosters: z.record(z.string(), z.array(RosterPlayerSchema)).optional(),
  depth: z.record(z.string(), DepthChartSchema).optional(),
  eventCount: z.number(),
  features: z.record(z.string(), z.boolean()),
  preview: PreviewSchema.optional(),
});
export type GameDetail = z.infer<typeof GameDetailSchema>;

export const EventsResponseSchema = z.object({
  gameId: z.string(),
  events: z.array(LoggedEventSchema),
  next: z.number(),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

export const AdminSourceRequestSchema = z.object({
  gameId: z.string().optional(),
  source: z.enum(['live', 'replay']),
  speed: z.number().min(0.25).max(16).optional(),
  /** Log position to start the replay from (defaults to the beginning). */
  from: z.number().int().nonnegative().optional(),
});
export type AdminSourceRequest = z.infer<typeof AdminSourceRequestSchema>;

/**
 * Non-event messages on the SSE stream (`event: control`):
 * - reset: drop local state, events restart from `from`
 * - status: feed freshness heartbeat
 * - delta: partial commentary while Claude is still streaming
 */
export const StreamControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reset'),
    source: z.enum(['live', 'replay']),
    from: z.number(),
  }),
  z.object({
    type: z.literal('status'),
    source: z.enum(['live', 'replay']),
    /** ms epoch of the last successful upstream update (live) or emitted event (replay). */
    lastUpdate: z.number().optional(),
    speed: z.number().optional(),
    done: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('delta'),
    playId: z.string(),
    voice: z.enum(['pbp', 'color']),
    text: z.string(),
  }),
]);
export type StreamControl = z.infer<typeof StreamControlSchema>;

/** Phones in the room (A5): the projector shares its replay position so phones join in step. */
export const RoomRequestSchema = z.object({
  from: z.number().int().nonnegative(),
  speed: z.number().min(0.25).max(16),
});
export type RoomRequest = z.infer<typeof RoomRequestSchema>;

export const RoomResponseSchema = z.object({
  gameId: z.string(),
  source: z.enum(['live', 'replay']),
  /** Log seq to start at (the play the room is on now). Absent for live: join at the end. */
  seq: z.number().int().nonnegative().optional(),
  speed: z.number(),
});
export type RoomResponse = z.infer<typeof RoomResponseSchema>;
