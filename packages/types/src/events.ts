import { z } from 'zod';
import { ClipSchema } from './clip.ts';
import { CommentarySchema } from './commentary.ts';
import { EspnPlaySchema } from './espn.ts';
import { OddsTickSchema } from './odds.ts';
import { ParsedPlaySchema, PenaltyInfoSchema } from './play.ts';
import { GameStateSchema } from './state.ts';

export const PlayEventSchema = z.object({
  kind: z.literal('play'),
  /** ESPN play id. */
  id: z.string(),
  /** Wall-clock ms when the play happened (or was first seen in the feed). */
  ts: z.number(),
  raw: EspnPlaySchema,
  parsed: ParsedPlaySchema,
  /** Game state after the play. */
  state: GameStateSchema,
  /** Game state at the snap (scorebug and LOS before the play animates). */
  pre: GameStateSchema,
  driveId: z.string().optional(),
  /** Notable by the PRD rule (score, turnover, 20+ yards, 3rd/4th down result, big swing). */
  big: z.boolean().optional(),
  epa: z.number().optional(),
  /** Home win probability 0-1 before and after the play. */
  wpBefore: z.number().optional(),
  wpAfter: z.number().optional(),
  trackingMatchId: z.string().optional(),
});
export type PlayEvent = z.infer<typeof PlayEventSchema>;

export const StoppageReasonSchema = z.enum([
  'timeout',
  'injury',
  'review',
  'penalty',
  'quarter_end',
  'two_minute',
  'halftime',
]);
export type StoppageReason = z.infer<typeof StoppageReasonSchema>;

export const StoppageEventSchema = z.object({
  kind: z.literal('stoppage'),
  id: z.string(),
  ts: z.number(),
  reason: StoppageReasonSchema,
  /** Plain-English card body, written by deterministic templates from feed facts. */
  detail: z.string(),
  state: GameStateSchema,
  /** Short card heading, e.g. "Timeout Steelers". */
  title: z.string().optional(),
  team: z.string().optional(),
  /** Play the stoppage came from, when it was attached to one. */
  playId: z.string().optional(),
  penalty: PenaltyInfoSchema.optional(),
});
export type StoppageEvent = z.infer<typeof StoppageEventSchema>;

export const GameEventSchema = z.discriminatedUnion('kind', [
  PlayEventSchema,
  StoppageEventSchema,
  OddsTickSchema,
  CommentarySchema,
  ClipSchema,
]);
export type GameEvent = z.infer<typeof GameEventSchema>;
export type GameEventKind = GameEvent['kind'];

/** One line of a game's JSONL event log: the event plus its position in the log. */
export const LoggedEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  event: GameEventSchema,
});
export type LoggedEvent = z.infer<typeof LoggedEventSchema>;
