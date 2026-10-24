/**
 * Zod schemas for the undocumented ESPN site API. Every object is loose (unknown keys pass
 * through) and almost every field is optional, so a shape change degrades a feature instead of
 * failing the whole response.
 */
import { z } from 'zod';

const numeric = z.union([z.number(), z.string().transform((s) => Number(s))]).pipe(z.number());

export const EspnTeamRefSchema = z.looseObject({
  id: z.string(),
  abbreviation: z.string().optional(),
  displayName: z.string().optional(),
  shortDisplayName: z.string().optional(),
  name: z.string().optional(),
  location: z.string().optional(),
  color: z.string().optional(),
  alternateColor: z.string().optional(),
  logo: z.string().optional(),
  logos: z.array(z.looseObject({ href: z.string() })).optional(),
});
export type EspnTeamRef = z.infer<typeof EspnTeamRefSchema>;

export const EspnSpotSchema = z.looseObject({
  down: z.number().optional(),
  distance: z.number().optional(),
  yardLine: z.number().optional(),
  yardsToEndzone: z.number().optional(),
  downDistanceText: z.string().optional(),
  shortDownDistanceText: z.string().optional(),
  possessionText: z.string().optional(),
  team: z.looseObject({ id: z.string() }).optional(),
});
export type EspnSpot = z.infer<typeof EspnSpotSchema>;

export const EspnPlaySchema = z.looseObject({
  id: z.string(),
  sequenceNumber: z.string().optional(),
  type: z
    .looseObject({
      id: z.string().optional(),
      text: z.string().optional(),
      abbreviation: z.string().optional(),
    })
    .optional(),
  text: z.string().default(''),
  shortText: z.string().optional(),
  awayScore: z.number().optional(),
  homeScore: z.number().optional(),
  period: z.looseObject({ number: z.number() }).optional(),
  clock: z.looseObject({ displayValue: z.string() }).optional(),
  scoringPlay: z.boolean().optional(),
  scoringType: z.looseObject({ name: z.string().optional() }).optional(),
  priority: z.boolean().optional(),
  modified: z.string().optional(),
  wallclock: z.string().optional(),
  start: EspnSpotSchema.optional(),
  end: EspnSpotSchema.optional(),
  statYardage: z.number().optional(),
});
export type EspnPlay = z.infer<typeof EspnPlaySchema>;

export const EspnDriveSchema = z.looseObject({
  id: z.string(),
  description: z.string().optional(),
  team: EspnTeamRefSchema.partial({ id: true }).optional(),
  displayResult: z.string().optional(),
  result: z.string().optional(),
  yards: z.number().optional(),
  isScore: z.boolean().optional(),
  offensivePlays: z.number().optional(),
  plays: z.array(z.unknown()).default([]),
});
export type EspnDrive = z.infer<typeof EspnDriveSchema>;

export const EspnStatusSchema = z.looseObject({
  clock: z.number().optional(),
  displayClock: z.string().optional(),
  period: z.number().optional(),
  type: z.looseObject({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.enum(['pre', 'in', 'post']),
    completed: z.boolean().optional(),
    description: z.string().optional(),
    detail: z.string().optional(),
    shortDetail: z.string().optional(),
  }),
});
export type EspnStatus = z.infer<typeof EspnStatusSchema>;

export const EspnCompetitorSchema = z.looseObject({
  id: z.string(),
  homeAway: z.enum(['home', 'away']),
  team: EspnTeamRefSchema,
  score: numeric.optional(),
  winner: z.boolean().optional(),
  record: z
    .union([
      z.array(z.looseObject({ summary: z.string().optional(), type: z.string().optional() })),
      z.string(),
    ])
    .optional(),
  records: z
    .array(z.looseObject({ summary: z.string().optional(), type: z.string().optional() }))
    .optional(),
  leaders: z.array(z.unknown()).optional(),
});
export type EspnCompetitor = z.infer<typeof EspnCompetitorSchema>;

export const EspnOddsSchema = z.looseObject({
  details: z.string().optional(),
  overUnder: z.number().optional(),
  spread: z.number().optional(),
  provider: z.looseObject({ name: z.string().optional() }).optional(),
});

export const EspnSituationSchema = z.looseObject({
  down: z.number().optional(),
  distance: z.number().optional(),
  yardLine: z.number().optional(),
  possession: z.string().optional(),
  downDistanceText: z.string().optional(),
  shortDownDistanceText: z.string().optional(),
  isRedZone: z.boolean().optional(),
  homeTimeouts: z.number().optional(),
  awayTimeouts: z.number().optional(),
  lastPlay: z
    .looseObject({
      text: z.string().optional(),
      probability: z.looseObject({ homeWinPercentage: z.number().optional() }).optional(),
    })
    .optional(),
});

export const EspnCompetitionSchema = z.looseObject({
  id: z.string(),
  date: z.string().optional(),
  neutralSite: z.boolean().optional(),
  competitors: z.array(EspnCompetitorSchema),
  status: EspnStatusSchema.optional(),
  odds: z.array(EspnOddsSchema).optional(),
  broadcasts: z
    .array(
      z.looseObject({
        names: z.array(z.string()).optional(),
        media: z.looseObject({ shortName: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  situation: EspnSituationSchema.optional(),
  venue: z.looseObject({ fullName: z.string().optional() }).optional(),
});
export type EspnCompetition = z.infer<typeof EspnCompetitionSchema>;

export const EspnWinProbabilitySchema = z.looseObject({
  playId: z.string(),
  homeWinPercentage: z.number(),
  tiePercentage: z.number().optional(),
});

export const EspnSummarySchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  header: z.looseObject({
    id: z.string(),
    season: z.looseObject({ year: z.number(), type: z.number().optional() }).optional(),
    week: z.number().optional(),
    competitions: z.array(EspnCompetitionSchema).min(1),
  }),
  drives: z
    .looseObject({
      previous: z.array(EspnDriveSchema).optional(),
      current: EspnDriveSchema.optional(),
    })
    .optional(),
  winprobability: z.array(EspnWinProbabilitySchema).optional(),
  pickcenter: z.array(EspnOddsSchema).optional(),
  gameInfo: z
    .looseObject({ venue: z.looseObject({ fullName: z.string().optional() }).optional() })
    .optional(),
  injuries: z.array(z.unknown()).optional(),
  leaders: z.array(z.unknown()).optional(),
});
export type EspnSummary = z.infer<typeof EspnSummarySchema>;

export const EspnEventSchema = z.looseObject({
  id: z.string(),
  date: z.string(),
  name: z.string().optional(),
  shortName: z.string().optional(),
  week: z.looseObject({ number: z.number() }).optional(),
  season: z.looseObject({ year: z.number(), type: z.number().optional() }).optional(),
  competitions: z.array(EspnCompetitionSchema).min(1),
  status: EspnStatusSchema.optional(),
});
export type EspnEvent = z.infer<typeof EspnEventSchema>;

/** Scoreboard events are validated one by one so a single bad event is skipped, not fatal. */
export const EspnScoreboardSchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  season: z.looseObject({ year: z.number(), type: z.number().optional() }).optional(),
  week: z.looseObject({ number: z.number() }).optional(),
  events: z.array(z.unknown()),
});
export type EspnScoreboard = z.infer<typeof EspnScoreboardSchema>;

export const EspnAthleteSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  fullName: z.string().optional(),
  shortName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  jersey: z.string().optional(),
  position: z.looseObject({ abbreviation: z.string() }).optional(),
});
export type EspnAthlete = z.infer<typeof EspnAthleteSchema>;

export const EspnRosterSchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  team: EspnTeamRefSchema.partial({ id: true }).optional(),
  athletes: z.array(
    z.looseObject({
      position: z.string().optional(),
      items: z.array(z.unknown()),
    }),
  ),
});
export type EspnRoster = z.infer<typeof EspnRosterSchema>;

export const EspnTeamResponseSchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  team: EspnTeamRefSchema,
});

/** Depth chart: one entry per formation group, each mapping position keys to ordered athletes. */
export const EspnDepthChartSchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  depthchart: z.array(
    z.looseObject({
      name: z.string().optional(),
      positions: z.record(
        z.string(),
        z.looseObject({
          position: z.looseObject({ abbreviation: z.string() }).optional(),
          athletes: z.array(EspnAthleteSchema.partial({ displayName: true })),
        }),
      ),
    }),
  ),
});
export type EspnDepthChart = z.infer<typeof EspnDepthChartSchema>;
