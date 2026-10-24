/**
 * Commentary pipeline: one play-by-play line per play, a color line for notable plays and a
 * context nugget for every stoppage. Claude when a key is set, templates otherwise. Cached by
 * play id, so a replay never calls Claude.
 */
import type { Commentary, GameEvent, PlayEvent, StoppageEvent } from '@gridcast/types';
import type { GameSession } from '../games/session.ts';
import { log } from '../util/logger.ts';
import type { CommentaryCache } from './cache.ts';
import type { Writer } from './claude.ts';
import {
  allowedVocabulary,
  buildPlayContext,
  buildStoppageContext,
  type CommentaryContext,
  type TeamNames,
} from './context.ts';
import { grounded } from './grounding.ts';
import { templateLines, type LinePair } from './template.ts';

type Target = PlayEvent | StoppageEvent;

const needsLines = (e: GameEvent): e is Target =>
  (e.kind === 'play' && e.parsed.type !== 'other') || e.kind === 'stoppage';

export function teamNames(session: GameSession): { home: TeamNames; away: TeamNames } {
  const t = (x: { abbr: string; shortName: string; name: string }): TeamNames => ({
    abbr: x.abbr,
    name: x.shortName,
    location: x.name.replace(x.shortName, '').trim(),
  });
  return { home: t(session.card.home), away: t(session.card.away) };
}

export class CommentaryService {
  /** Count of Claude calls, for tests and logs. */
  calls = 0;
  private filling = new Set<string>();

  constructor(
    private readonly cache: CommentaryCache,
    private readonly writer: Writer | undefined,
    private readonly onFilled?: (gameId: string) => void,
  ) {}

  get usesClaude(): boolean {
    return !!this.writer;
  }

  private context(
    session: GameSession,
    e: Target,
    history: readonly GameEvent[],
  ): CommentaryContext {
    const teams = teamNames(session);
    return e.kind === 'play'
      ? buildPlayContext(e, history, teams)
      : buildStoppageContext(e, history, teams);
  }

  /** Lines for one event: cache, then Claude (grounded), then template. */
  async lines(
    session: GameSession,
    e: Target,
    history: readonly GameEvent[],
    onDelta?: (voice: 'pbp' | 'color', text: string) => void,
  ): Promise<LinePair> {
    const cached = this.cache.get(session.gameId, e.id);
    if (cached) return cached;
    const ctx = this.context(session, e, history);
    const tmpl = templateLines(ctx);
    if (!this.writer) return tmpl;
    this.calls++;
    const out = await this.writer.write(ctx, onDelta);
    if (!out) return tmpl;
    const vocab = allowedVocabulary(ctx, session.rosters, teamNames(session));
    const pbpOk = e.kind === 'stoppage' || (out.pbp && grounded(out.pbp, ctx, vocab).ok);
    const colorOk = out.color ? grounded(out.color, ctx, vocab).ok : true;
    if (!pbpOk || !colorOk) log.warn('commentary failed grounding, using template', { id: e.id });
    const lines: LinePair = {
      pbp: e.kind === 'stoppage' ? '' : pbpOk ? out.pbp : tmpl.pbp,
      ...(out.color && colorOk ? { color: out.color } : tmpl.color ? { color: tmpl.color } : {}),
    };
    this.cache.set(session.gameId, e.id, { ...lines, source: 'claude' });
    return lines;
  }

  static events(e: Target, lines: LinePair, ts: number, template: boolean): Commentary[] {
    const out: Commentary[] = [];
    if (lines.pbp)
      out.push({
        kind: 'commentary',
        playId: e.id,
        ts,
        voice: 'pbp',
        text: lines.pbp,
        ...(template ? { template } : {}),
      });
    if (lines.color)
      out.push({
        kind: 'commentary',
        playId: e.id,
        ts: ts + 1,
        voice: 'color',
        text: lines.color,
        ...(template ? { template } : {}),
      });
    return out;
  }

  /**
   * Finished games: commentary goes into the log right behind each play, synchronously, from the
   * cache or templates. Missing Claude lines are generated in the background and the log rebuilt.
   */
  enrichRebuild = (session: GameSession, events: GameEvent[]): GameEvent[] => {
    const out: GameEvent[] = [];
    let missing = 0;
    for (const e of events) {
      out.push(e);
      if (!needsLines(e)) continue;
      const cached = this.cache.get(session.gameId, e.id);
      if (!cached && this.writer) missing++;
      const lines = cached ?? templateLines(this.context(session, e, out));
      out.push(
        ...CommentaryService.events(e, lines, e.ts + 600, !cached || cached.source === 'template'),
      );
    }
    if (missing && this.writer) void this.fill(session, events);
    return out;
  };

  private async fill(session: GameSession, events: GameEvent[]) {
    if (this.filling.has(session.gameId)) return;
    this.filling.add(session.gameId);
    log.info('generating commentary', { gameId: session.gameId });
    try {
      const history: GameEvent[] = [];
      for (const e of events) {
        history.push(e);
        if (needsLines(e) && !this.cache.get(session.gameId, e.id))
          await this.lines(session, e, history);
      }
      this.onFilled?.(session.gameId);
    } finally {
      this.filling.delete(session.gameId);
    }
  }

  /** Live (and pre-game) sessions: write commentary as each play lands. */
  attach(session: GameSession): void {
    if (session.status === 'final') return;
    let chain = Promise.resolve();
    const handle = (events: GameEvent[], backlog: boolean) => {
      const targets = events.filter(needsLines);
      targets.forEach((e, i) => {
        // On a mid-game load, only the latest plays get Claude; older ones get templates.
        const useTemplate = backlog && i < targets.length - 3;
        chain = chain.then(async () => {
          const done = (voice: 'pbp' | 'color') =>
            session.has({ kind: 'commentary', playId: e.id, ts: 0, voice, text: '' });
          if (done('pbp') || done('color')) return;
          const history = session.log.all().map((x) => x.event);
          const lines = useTemplate
            ? (this.cache.get(session.gameId, e.id) ??
              templateLines(this.context(session, e, history)))
            : await this.lines(session, e, history, (voice, text) =>
                session.emit('delta', { type: 'delta', playId: e.id, voice, text }),
              );
          session.publish(
            CommentaryService.events(e, lines, Date.now(), !this.writer || useTemplate),
          );
        });
      });
    };
    handle(
      session.log.all().map((x) => x.event),
      true,
    );
    session.on('events', (evs) => handle(evs, false));
  }
}
