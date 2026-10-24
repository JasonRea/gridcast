/**
 * Normalizer: raw ESPN plays -> GameEvents (play + stoppage), enriched with the parser, win
 * probability and the "big play" flag. Stateful so it works the same way for a whole finished
 * game (replay build) and for plays trickling in from the live poller.
 */
import { parsePlay } from '@gridcast/parser';
import {
  EspnPlaySchema,
  normalizeAbbr,
  type EspnPlay,
  type EspnSummary,
  type GameEvent,
  type GameState,
  type ParsedPlay,
  type PlayEvent,
  type StoppageEvent,
} from '@gridcast/types';
import { log } from '../util/logger.ts';
import {
  downText,
  penaltyText,
  periodName,
  situation,
  timeoutReason,
  type Names,
} from './stoppageText.ts';

export type TeamRef = { id: string; abbr: string; name: string };

export type GameMeta = {
  gameId: string;
  home: TeamRef;
  away: TeamRef;
  /** ms epoch used when the feed has no wallclock. */
  startTs: number;
};

export function metaFromSummary(s: EspnSummary): GameMeta | undefined {
  const comp = s.header.competitions[0];
  if (!comp) return undefined;
  const ref = (side: 'home' | 'away'): TeamRef | undefined => {
    const c = comp.competitors.find((x) => x.homeAway === side);
    if (!c) return undefined;
    return {
      id: c.team.id,
      abbr: normalizeAbbr(c.team.abbreviation ?? c.team.id),
      name: c.team.shortDisplayName ?? c.team.name ?? c.team.abbreviation ?? c.team.id,
    };
  };
  const home = ref('home');
  const away = ref('away');
  if (!home || !away) return undefined;
  const startTs = comp.date ? Date.parse(comp.date) : Date.now();
  return {
    gameId: s.header.id,
    home,
    away,
    startTs: Number.isFinite(startTs) ? startTs : Date.now(),
  };
}

/** All plays in feed order, deduplicated, each validated on its own (bad ones skipped). */
export function playsFromSummary(s: EspnSummary): { play: EspnPlay; driveId?: string }[] {
  const out: { play: EspnPlay; driveId?: string }[] = [];
  const seen = new Set<string>();
  const drives = [...(s.drives?.previous ?? []), ...(s.drives?.current ? [s.drives.current] : [])];
  for (const d of drives) {
    for (const p of d.plays) {
      const parsed = EspnPlaySchema.safeParse(p);
      if (!parsed.success) {
        log.warn('skipping malformed ESPN play', { drive: d.id });
        continue;
      }
      if (seen.has(parsed.data.id)) continue;
      seen.add(parsed.data.id);
      out.push({ play: parsed.data, driveId: d.id });
    }
  }
  return out;
}

export function winProbMap(s: EspnSummary): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of s.winprobability ?? []) m.set(w.playId, w.homeWinPercentage);
  return m;
}

const NOT_SNAP = new Set(['21', '2', '65', '66', '75', '79', '0']);

function isTimeout(p: EspnPlay): boolean {
  return /timeout/i.test(p.type?.text ?? '') || /^\s*timeout #?\d/i.test(p.text);
}

function clockSeconds(clock: string): number {
  const [m, s] = clock.split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

export class GameNormalizer {
  private readonly names: Names;
  private score = { home: 0, away: 0 };
  /** Timeouts used per half: key = half index (1, 2, 3 = OT). */
  private used = new Map<string, number>();
  private last: GameState | undefined;
  private lastTs: number;
  private lastWp: number | undefined;
  private lastInjury = false;
  private twoMinuteDone = new Set<number>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly meta: GameMeta,
    /** Optional per-play enrichment (EPA, 4th-down bot). */
    private readonly enrich: (p: PlayEvent) => PlayEvent = (p) => p,
  ) {
    this.names = {
      home: meta.home.name,
      away: meta.away.name,
      homeAbbr: meta.home.abbr,
      awayAbbr: meta.away.abbr,
    };
    this.lastTs = meta.startTs;
  }

  get state(): GameState | undefined {
    return this.last;
  }

  hasSeen(playId: string): boolean {
    return this.seen.has(playId);
  }

  private abbrFor(teamId: string | undefined): string | undefined {
    if (!teamId) return undefined;
    if (teamId === this.meta.home.id) return this.meta.home.abbr;
    if (teamId === this.meta.away.id) return this.meta.away.abbr;
    return undefined;
  }

  private half(q: number): number {
    return q <= 2 ? 1 : q <= 4 ? 2 : 3;
  }

  private timeouts(q: number): { home: number; away: number } {
    const h = this.half(q);
    const max = h === 3 ? 2 : 3;
    return {
      home: Math.max(0, max - (this.used.get(`${h}:${this.meta.home.abbr}`) ?? 0)),
      away: Math.max(0, max - (this.used.get(`${h}:${this.meta.away.abbr}`) ?? 0)),
    };
  }

  private other(abbr: string): string {
    return abbr === this.meta.home.abbr ? this.meta.away.abbr : this.meta.home.abbr;
  }

  /** Processes one ESPN play. `wp` is ESPN's home win probability after the play (0-1). */
  ingest(play: EspnPlay, opts: { wp?: number; driveId?: string } = {}): GameEvent[] {
    if (this.seen.has(play.id)) return [];
    this.seen.add(play.id);

    const ts = play.wallclock ? Date.parse(play.wallclock) : NaN;
    const at = Number.isFinite(ts) ? Math.max(ts, this.lastTs) : this.lastTs + 30_000;
    this.lastTs = at;

    const quarter = play.period?.number ?? this.last?.quarter ?? 1;
    const clock = play.clock?.displayValue ?? this.last?.clock ?? '15:00';
    const offense =
      this.abbrFor(play.start?.team?.id) ?? this.last?.possession ?? this.meta.away.abbr;
    const defense = this.other(offense);
    const typeId = play.type?.id ?? '';
    const typeText = play.type?.text ?? '';
    const out: GameEvent[] = [];

    const pre: GameState = {
      quarter,
      clock,
      ...(play.start?.down ? { down: play.start.down } : {}),
      ...(play.start?.distance !== undefined && play.start?.down
        ? { distance: play.start.distance }
        : {}),
      yardLine:
        play.start?.yardsToEndzone !== undefined
          ? 100 - play.start.yardsToEndzone
          : (this.last?.yardLine ?? 25),
      possession: offense,
      home: this.score.home,
      away: this.score.away,
      timeouts: this.timeouts(quarter),
    };

    // Synthetic two-minute warning when the clock crosses 2:00 in Q2/Q4 without an explicit one.
    if (
      this.last &&
      (quarter === 2 || quarter === 4) &&
      this.last.quarter === quarter &&
      clockSeconds(this.last.clock) > 120 &&
      clockSeconds(clock) <= 120 &&
      !this.twoMinuteDone.has(quarter) &&
      !/two-minute/i.test(typeText)
    ) {
      this.twoMinuteDone.add(quarter);
      out.push(
        this.periodStoppage('two_minute', `${play.id}-2mw`, at - 1, {
          ...this.last,
          clock: '2:00',
        }),
      );
    }

    // Feed bookkeeping rows become stoppages, not plays.
    if (isTimeout(play)) {
      const m = /timeout #(\d) by ([A-Z]{2,3})/i.exec(play.text);
      const team = m?.[2] ? normalizeAbbr(m[2]) : (this.abbrFor(play.start?.team?.id) ?? offense);
      const h = this.half(quarter);
      const n = m?.[1] ? Number(m[1]) : (this.used.get(`${h}:${team}`) ?? 0) + 1;
      this.used.set(`${h}:${team}`, n);
      const state: GameState = {
        ...(this.last ?? pre),
        quarter,
        clock,
        timeouts: this.timeouts(quarter),
      };
      const teamName = team === this.names.homeAbbr ? this.names.home : this.names.away;
      const left = state.timeouts;
      out.push({
        kind: 'stoppage',
        id: play.id,
        ts: at,
        reason: 'timeout',
        team,
        title: `Timeout ${teamName}`,
        detail: `${teamName} use timeout #${n}. Timeouts left: ${this.names.awayAbbr} ${left.away}, ${this.names.homeAbbr} ${left.home}. ${timeoutReason(state, team, this.names, this.lastInjury)}`,
        state,
      } satisfies StoppageEvent);
      this.last = state;
      return out;
    }
    if (/two-minute/i.test(typeText) || typeId === '75') {
      this.twoMinuteDone.add(quarter);
      out.push(
        this.periodStoppage('two_minute', play.id, at, {
          ...(this.last ?? pre),
          quarter,
          clock: '2:00',
        }),
      );
      return out;
    }
    if (
      /end (?:of )?(?:period|half|game|quarter|regulation)/i.test(typeText) ||
      /^end (quarter|game)/i.test(play.text) ||
      NOT_SNAP.has(typeId)
    ) {
      const isHalf = /half/i.test(typeText) || (quarter === 2 && !/game/i.test(typeText));
      const isGame = /game/i.test(typeText) || /end game/i.test(play.text);
      const st: GameState = { ...(this.last ?? pre), quarter, clock: '0:00' };
      out.push(this.periodStoppage(isHalf ? 'halftime' : 'quarter_end', play.id, at, st, isGame));
      if (isHalf) this.lastInjury = false;
      return out;
    }

    // A real snap (or a no-play penalty).
    const parsed: ParsedPlay = parsePlay({
      text: play.text,
      ...(typeText ? { espnType: typeText } : {}),
      ...(play.start?.down ? { down: play.start.down } : {}),
      ...(play.start?.distance !== undefined ? { distance: play.start.distance } : {}),
      ...(play.start?.yardsToEndzone !== undefined
        ? { yardsToEndzone: play.start.yardsToEndzone }
        : {}),
      ...(play.end?.yardsToEndzone !== undefined
        ? { endYardsToEndzone: play.end.yardsToEndzone }
        : {}),
      ...(play.statYardage !== undefined ? { statYardage: play.statYardage } : {}),
      ...(play.scoringPlay !== undefined ? { scoringPlay: play.scoringPlay } : {}),
      quarter,
      clock,
      offense,
      defense,
    });

    if (play.homeScore !== undefined) this.score.home = play.homeScore;
    if (play.awayScore !== undefined) this.score.away = play.awayScore;

    const endTeam = this.abbrFor(play.end?.team?.id);
    let state: GameState;
    if (endTeam && play.end?.yardsToEndzone !== undefined) {
      state = {
        quarter,
        clock,
        ...(play.end.down ? { down: play.end.down } : {}),
        ...(play.end.down && play.end.distance !== undefined
          ? { distance: play.end.distance }
          : {}),
        yardLine: 100 - play.end.yardsToEndzone,
        possession: endTeam,
        home: this.score.home,
        away: this.score.away,
        timeouts: this.timeouts(quarter),
      };
    } else {
      const flip = !!parsed.possessionChange;
      const possession = flip ? defense : offense;
      const yardLine = flip ? 100 - parsed.endYd : parsed.endYd;
      let down: number | undefined;
      let distance: number | undefined;
      if (
        !parsed.points &&
        parsed.type !== 'kickoff' &&
        parsed.type !== 'pat' &&
        !flip &&
        pre.down
      ) {
        const gained = parsed.endYd - parsed.startYd;
        if (parsed.firstDown || (pre.distance !== undefined && gained >= pre.distance)) {
          down = 1;
          distance = Math.min(10, 100 - yardLine);
        } else if (parsed.type === 'penalty' && parsed.penalty?.noPlay) {
          down = pre.down;
          distance = Math.max(1, (pre.distance ?? 10) - gained);
        } else {
          down = pre.down + 1;
          distance = Math.max(1, (pre.distance ?? 10) - gained);
        }
      } else if (flip && parsed.type !== 'punt' && parsed.type !== 'kickoff') {
        down = 1;
        distance = 10;
      }
      state = {
        quarter,
        clock,
        ...(down && down <= 4 ? { down } : {}),
        ...(down && down <= 4 && distance !== undefined ? { distance } : {}),
        yardLine,
        possession,
        home: this.score.home,
        away: this.score.away,
        timeouts: this.timeouts(quarter),
      };
    }

    const wpAfter = opts.wp;
    const wpBefore = this.lastWp;
    if (wpAfter !== undefined) this.lastWp = wpAfter;

    const turnover = parsed.result === 'interception' || parsed.result === 'fumble';
    const lateDown =
      (pre.down === 3 || pre.down === 4) && ['run', 'pass', 'sack'].includes(parsed.type);
    const swing =
      wpBefore !== undefined && wpAfter !== undefined && Math.abs(wpAfter - wpBefore) >= 0.05;
    const big =
      !!parsed.points ||
      turnover ||
      Math.abs(parsed.yards) >= 20 ||
      lateDown ||
      swing ||
      (parsed.type === 'fg' && parsed.result === 'no_good');

    const ev: PlayEvent = {
      kind: 'play',
      id: play.id,
      ts: at,
      raw: play,
      parsed,
      state,
      pre,
      ...(opts.driveId ? { driveId: opts.driveId } : {}),
      ...(big ? { big } : {}),
      ...(wpBefore !== undefined ? { wpBefore } : {}),
      ...(wpAfter !== undefined ? { wpAfter } : {}),
    };
    out.push(this.enrich(ev));

    // Stoppages that come from inside a play.
    if (parsed.penalty && (parsed.penalty.accepted || parsed.penalty.offsetting)) {
      out.push({
        kind: 'stoppage',
        id: `${play.id}-pen`,
        ts: at + 1,
        reason: 'penalty',
        team: parsed.penalty.team,
        playId: play.id,
        penalty: parsed.penalty,
        title: `Flag: ${parsed.penalty.name}`,
        detail: penaltyText(parsed.penalty, state, this.names),
        state,
      });
    }
    if (parsed.review) {
      const what = /(?:reviewed|challenged) the (.+?) ruling/i.exec(play.text)?.[1];
      const outcome = /REVERSED/.test(play.text)
        ? 'The call was reversed.'
        : /upheld|stands/i.test(play.text)
          ? 'The call on the field stands.'
          : '';
      out.push({
        kind: 'stoppage',
        id: `${play.id}-rev`,
        ts: at + 2,
        reason: 'review',
        playId: play.id,
        title: 'Replay review',
        detail:
          `Under review: ${what ?? 'the ruling on the field'}. If overturned, the play is re-spotted by what replay shows. ${outcome}`.trim(),
        state,
      });
    }
    this.lastInjury = false;
    for (const name of parsed.injured ?? []) {
      this.lastInjury = true;
      const team =
        parsed.players.find((p) => p.name === name)?.team ||
        (play.text.indexOf(name) > play.text.search(/\(/) ? defense : offense);
      const teamName = team === this.names.homeAbbr ? this.names.home : this.names.away;
      out.push({
        kind: 'stoppage',
        id: `${play.id}-inj-${name}`,
        ts: at + 3,
        reason: 'injury',
        team,
        playId: play.id,
        title: 'Injury',
        detail: `${name} (${teamName}) is down after the play. Play is stopped while trainers attend.`,
        state,
      });
    }

    this.last = state;
    return out;
  }

  private periodStoppage(
    reason: 'quarter_end' | 'two_minute' | 'halftime',
    id: string,
    ts: number,
    st: GameState,
    gameOver = false,
  ): StoppageEvent {
    const title =
      reason === 'two_minute'
        ? 'Two-minute warning'
        : reason === 'halftime'
          ? 'Halftime'
          : gameOver
            ? 'Final'
            : `End of ${periodName(st.quarter)}`;
    const dd = downText(st);
    const detail = gameOver
      ? `Final: ${this.names.awayAbbr} ${st.away}, ${this.names.homeAbbr} ${st.home}.`
      : `${situation(st, this.names)}${reason === 'two_minute' && dd ? '' : ''}`;
    return { kind: 'stoppage', id, ts, reason, title, detail, state: st };
  }
}

/** Builds the full event list for a summary (finished game or a live snapshot). */
export function normalizeSummary(
  s: EspnSummary,
): { meta: GameMeta; events: GameEvent[] } | undefined {
  const meta = metaFromSummary(s);
  if (!meta) return undefined;
  const n = new GameNormalizer(meta);
  const wp = winProbMap(s);
  const events: GameEvent[] = [];
  for (const { play, driveId } of playsFromSummary(s)) {
    const w = wp.get(play.id);
    events.push(
      ...n.ingest(play, { ...(w !== undefined ? { wp: w } : {}), ...(driveId ? { driveId } : {}) }),
    );
  }
  return { meta, events };
}
