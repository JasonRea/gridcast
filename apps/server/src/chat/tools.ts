/**
 * Ask-the-game tools. Each reads the same event log the stream plays from, so answers can only
 * use what actually happened. Inputs are validated with zod before running.
 */
import { z } from 'zod';
import type { OddsTick, PlayEvent } from '@gridcast/types';
import type { GameSession } from '../games/session.ts';

const label = (p: PlayEvent) => {
  const q = p.pre.quarter <= 4 ? `Q${p.pre.quarter}` : 'OT';
  const [m, s] = p.pre.clock.split(':');
  return `${q} ${Number(m)}:${(s ?? '00').padStart(2, '0')}`;
};

const text = (p: PlayEvent) => p.raw.text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');

function plays(s: GameSession): PlayEvent[] {
  return s.log.all().flatMap((e) => (e.event.kind === 'play' ? [e.event] : []));
}

function summary(p: PlayEvent) {
  return {
    id: p.id,
    when: label(p),
    offense: p.pre.possession,
    down: p.pre.down ? `${p.pre.down} & ${p.pre.distance}` : undefined,
    text: text(p),
    type: p.parsed.type,
    result: p.parsed.result,
    yards: p.parsed.yards,
    ...(p.epa !== undefined ? { epa: p.epa } : {}),
    ...(p.wpBefore !== undefined && p.wpAfter !== undefined
      ? {
          homeWinProbBefore: Math.round(p.wpBefore * 100),
          homeWinProbAfter: Math.round(p.wpAfter * 100),
        }
      : {}),
    ...(p.fourthDown ? { fourthDownBot: p.fourthDown } : {}),
    score: `${p.state.away}-${p.state.home}`,
  };
}

export const GetPlaysInput = z.object({
  quarter: z.number().int().min(1).max(6).optional(),
  team: z.string().optional(),
  type: z
    .enum(['run', 'pass', 'sack', 'punt', 'kickoff', 'fg', 'pat', 'penalty', 'kneel', 'spike'])
    .optional(),
  result: z
    .enum([
      'complete',
      'incomplete',
      'interception',
      'fumble',
      'td',
      'good',
      'no_good',
      'touchback',
    ])
    .optional(),
  big_only: z.boolean().optional(),
  player: z.string().optional(),
  limit: z.number().int().min(1).max(40).optional(),
});
export const GetPlayerStatsInput = z.object({ name: z.string().min(2) });
const Empty = z.object({}).passthrough();

const nameMatch = (n: string, q: string) => {
  const last = (n.split('.').pop() ?? n).toLowerCase();
  const query = q.toLowerCase().split(/\s+/).pop() ?? q.toLowerCase();
  return last === query || n.toLowerCase().includes(query);
};

export const TOOL_DEFS = [
  {
    name: 'get_game_state',
    description: 'Current score, quarter, clock, possession, down and distance, and team names.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_plays',
    description:
      'Plays so far, newest last, filtered. Returns "matching" (how many plays match: use it for counts) and up to `limit` of them. Each play has "when" (quarter and clock), offense, text, type, result, yards, EPA and home win probability before/after.',
    input_schema: {
      type: 'object' as const,
      properties: {
        quarter: { type: 'integer', description: '1-4, 5 for overtime' },
        team: { type: 'string', description: 'Offense team abbreviation, e.g. PIT' },
        type: { type: 'string', enum: GetPlaysInput.shape.type.unwrap().options },
        result: {
          type: 'string',
          enum: GetPlaysInput.shape.result.unwrap().options,
          description: 'Outcome, e.g. interception, fumble (lost), td, good / no_good for kicks',
        },
        big_only: {
          type: 'boolean',
          description:
            'Only scores, turnovers, 20+ yard plays, 3rd/4th downs and big win-probability swings',
        },
        player: { type: 'string', description: 'Last name of a player involved' },
        limit: { type: 'integer', description: 'Max plays to return (default 15, max 40)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_team_stats',
    description:
      'Totals for both teams so far: plays, yards, touchdowns, field goals, turnovers (interceptions thrown, fumbles lost), sacks taken, penalties, 3rd and 4th down conversions. Use for "how many" questions.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_player_stats',
    description:
      'Passing, rushing, receiving and tackle totals for one player in this game, by last name.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_odds_history',
    description:
      'Prediction market (Kalshi) win probability for the home team over the game, in percent. Information only, never betting advice.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_wp_history',
    description: 'Home win probability after each play, and the 8 plays that moved it most.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]['name'];

export function runTool(s: GameSession, name: string, input: unknown): unknown {
  const all = plays(s);
  switch (name) {
    case 'get_game_state': {
      Empty.parse(input ?? {});
      const st = s.state;
      return {
        away: {
          abbr: s.card.away.abbr,
          name: s.card.away.name,
          score: st?.away ?? s.card.away.score,
        },
        home: {
          abbr: s.card.home.abbr,
          name: s.card.home.name,
          score: st?.home ?? s.card.home.score,
        },
        status: s.status,
        ...(st
          ? {
              quarter: st.quarter,
              clock: st.clock,
              possession: st.possession,
              ...(st.down ? { down: st.down, distance: st.distance } : {}),
              yardsFromOwnGoal: st.yardLine,
              timeouts: st.timeouts,
            }
          : {}),
        playsSoFar: all.length,
      };
    }
    case 'get_plays': {
      const f = GetPlaysInput.parse(input ?? {});
      const team = f.team?.toUpperCase();
      const out = all.filter(
        (p) =>
          (f.quarter === undefined || p.pre.quarter === f.quarter) &&
          (!team || p.pre.possession === team) &&
          (!f.type || p.parsed.type === f.type) &&
          (!f.result || p.parsed.result === f.result) &&
          (!f.big_only || p.big) &&
          (!f.player || p.parsed.players.some((x) => nameMatch(x.name, f.player!))),
      );
      return { matching: out.length, plays: out.slice(-(f.limit ?? 15)).map(summary) };
    }
    case 'get_team_stats': {
      Empty.parse(input ?? {});
      const team = () => ({
        plays: 0,
        yards: 0,
        touchdowns: 0,
        fieldGoals: 0,
        interceptionsThrown: 0,
        fumblesLost: 0,
        sacksTaken: 0,
        penalties: 0,
        penaltyYards: 0,
        thirdDowns: { att: 0, conv: 0 },
        fourthDowns: { att: 0, conv: 0 },
      });
      const t: Record<string, ReturnType<typeof team>> = {
        [s.card.away.abbr]: team(),
        [s.card.home.abbr]: team(),
      };
      for (const p of all) {
        const pp = p.parsed;
        const off = t[p.pre.possession];
        if (!off) continue;
        const scrimmage = ['run', 'pass', 'sack'].includes(pp.type);
        if (scrimmage) {
          off.plays++;
          if (pp.result !== 'interception') off.yards += pp.yards;
        }
        if (pp.result === 'td' && scrimmage) off.touchdowns++;
        if (pp.type === 'fg' && pp.result === 'good') off.fieldGoals++;
        if (pp.result === 'interception') off.interceptionsThrown++;
        if (pp.result === 'fumble') off.fumblesLost++;
        if (pp.type === 'sack') off.sacksTaken++;
        if (pp.penalty?.accepted) {
          const pen = t[pp.penalty.team];
          if (pen) {
            pen.penalties++;
            pen.penaltyYards += pp.penalty.yards;
          }
        }
        if (scrimmage && (p.pre.down === 3 || p.pre.down === 4)) {
          const d = p.pre.down === 3 ? off.thirdDowns : off.fourthDowns;
          d.att++;
          if (pp.firstDown || pp.result === 'td') d.conv++;
        }
      }
      return t;
    }
    case 'get_player_stats': {
      const { name } = GetPlayerStatsInput.parse(input);
      const stat = {
        passing: { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacked: 0 },
        rushing: { att: 0, yds: 0, td: 0 },
        receiving: { targets: 0, rec: 0, yds: 0, td: 0 },
        tackles: 0,
      };
      let team: string | undefined;
      for (const p of all) {
        const pp = p.parsed;
        const has = (role: string) =>
          pp.players.some((x) => x.role === role && nameMatch(x.name, name));
        if (has('passer') && pp.type === 'pass') {
          team = p.pre.possession;
          stat.passing.att++;
          if (['complete', 'td'].includes(pp.result)) {
            stat.passing.comp++;
            stat.passing.yds += pp.yards;
          }
          if (pp.result === 'td') stat.passing.td++;
          if (pp.result === 'interception') stat.passing.int++;
        }
        if (has('passer') && pp.type === 'sack') stat.passing.sacked++;
        if (has('rusher') && pp.type === 'run') {
          team = p.pre.possession;
          stat.rushing.att++;
          stat.rushing.yds += pp.yards;
          if (pp.result === 'td') stat.rushing.td++;
        }
        if (has('receiver') && pp.type === 'pass') {
          team = p.pre.possession;
          stat.receiving.targets++;
          if (['complete', 'td'].includes(pp.result)) {
            stat.receiving.rec++;
            stat.receiving.yds += pp.yards;
          }
          if (pp.result === 'td') stat.receiving.td++;
        }
        if (has('tackler')) stat.tackles++;
      }
      return { name, ...(team ? { team } : {}), ...stat };
    }
    case 'get_odds_history': {
      Empty.parse(input ?? {});
      const ticks = s.log
        .all()
        .flatMap((e) => (e.event.kind === 'odds' ? [e.event as OddsTick] : []));
      const step = Math.max(1, Math.ceil(ticks.length / 50));
      return ticks
        .filter((_, i) => i % step === 0)
        .map((t) => ({
          at: new Date(t.ts).toISOString(),
          homeWinPct: Math.round(t.homeProb * 100),
        }));
    }
    case 'get_wp_history': {
      Empty.parse(input ?? {});
      const withWp = all.filter((p) => p.wpAfter !== undefined);
      const step = Math.max(1, Math.ceil(withWp.length / 60));
      const swings = withWp
        .filter((p) => p.wpBefore !== undefined)
        .sort((a, b) => Math.abs(b.wpAfter! - b.wpBefore!) - Math.abs(a.wpAfter! - a.wpBefore!))
        .slice(0, 8)
        .map(summary);
      return {
        home: s.card.home.abbr,
        series: withWp
          .filter((_, i) => i % step === 0)
          .map((p) => ({ when: label(p), homeWinProb: Math.round(p.wpAfter! * 100) })),
        biggestSwings: swings,
      };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
