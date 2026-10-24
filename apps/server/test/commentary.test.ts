import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EspnSummarySchema,
  type Commentary,
  type EspnSummary,
  type GameEvent,
  type PlayEvent,
  type StoppageEvent,
} from '@gridcast/types';
import { CommentaryCache } from '../src/commentary/cache.ts';
import type { Writer } from '../src/commentary/claude.ts';
import {
  allowedVocabulary,
  buildPlayContext,
  type CommentaryContext,
} from '../src/commentary/context.ts';
import { grounded } from '../src/commentary/grounding.ts';
import { CommentaryService, teamNames } from '../src/commentary/service.ts';
import { templateLines } from '../src/commentary/template.ts';
import { GameSession } from '../src/games/session.ts';
import { EventLog } from '../src/log/eventLog.ts';
import { loadConfig } from '../src/config.ts';
import { DEMO, testConfig, testServer } from './helpers.ts';

const summary = EspnSummarySchema.parse(
  JSON.parse(readFileSync(join(loadConfig().fixturesDir, 'espn/summary_401873002.json'), 'utf8')),
);

/** A fake Claude that writes grounded lines from the context's own facts. */
function fakeWriter(lineFor?: (ctx: CommentaryContext) => string): Writer & { calls: number } {
  const w = {
    calls: 0,
    async write(ctx: CommentaryContext, onDelta?: (v: 'pbp' | 'color', t: string) => void) {
      w.calls++;
      if (ctx.kind === 'stoppage') return { pbp: '', color: 'Big moment in this game.' };
      const line = lineFor?.(ctx) ?? templateLines(ctx).pbp;
      onDelta?.('pbp', line.slice(0, 10));
      return { pbp: line, ...(ctx.notable ? { color: 'That one matters.' } : {}) };
    },
  };
  return w;
}

const lines = (events: GameEvent[]) =>
  events.filter((e): e is Commentary => e.kind === 'commentary');

describe('commentary on the fixture game', () => {
  it('gives every play a play-by-play line and every stoppage a card nugget (templates, no key)', async () => {
    const { registry } = testServer();
    const s = (await registry.get(DEMO))!;
    const events = s.log.all().map((e) => e.event);
    const c = lines(events);
    const plays = events.filter(
      (e): e is PlayEvent => e.kind === 'play' && e.parsed.type !== 'other',
    );
    const stops = events.filter((e): e is StoppageEvent => e.kind === 'stoppage');
    for (const p of plays) expect(c.some((x) => x.playId === p.id && x.voice === 'pbp')).toBe(true);
    for (const st of stops)
      expect(c.some((x) => x.playId === st.id && x.voice === 'color')).toBe(true);
    // Notable plays get a color line.
    const td = events.find((e) => e.kind === 'play' && e.parsed.result === 'td')!;
    expect(c.some((x) => x.playId === (td as { id: string }).id && x.voice === 'color')).toBe(true);
    // Commentary sits right behind its play in the log.
    const idx = events.findIndex((e) => e.kind === 'play' && e.parsed.type === 'run');
    expect(events[idx + 1]).toMatchObject({ kind: 'commentary', voice: 'pbp' });
  });

  it('generates with Claude once, caches by play id, and a replay never calls Claude again', async () => {
    const dataDir = testConfig().dataDir;
    const first = fakeWriter();
    const a = testServer(
      { dataDir, logsDir: join(dataDir, 'logs'), cacheDir: join(dataDir, 'cache') },
      { writer: first },
    );
    const sa = (await a.registry.get(DEMO))!;
    await vi.waitFor(
      () => expect(lines(sa.log.all().map((e) => e.event)).every((x) => !x.template)).toBe(true),
      {
        timeout: 5000,
      },
    );
    expect(first.calls).toBeGreaterThan(150);

    const second = fakeWriter();
    const b = testServer(
      { dataDir, logsDir: join(dataDir, 'logs-2'), cacheDir: join(dataDir, 'cache') },
      { writer: second },
    );
    const sb = (await b.registry.get(DEMO))!;
    expect(lines(sb.log.all().map((e) => e.event)).length).toBeGreaterThan(150);
    await new Promise((r) => setTimeout(r, 50));
    expect(second.calls).toBe(0);
  });

  it('falls back to the template when Claude names someone not in the play or roster', async () => {
    const liar = fakeWriter(() => 'Tom Brady throws a dart for 50 yards!');
    const cfg = testConfig();
    const service = new CommentaryService(
      new CommentaryCache(cfg.cacheDir, cfg.assetsDir, false),
      liar,
    );
    const { events } = {
      events: (await testServer().registry.get(DEMO))!.log.all().map((e) => e.event),
    };
    const s = (await testServer().registry.get(DEMO))!;
    const play = events.find(
      (e) => e.kind === 'play' && e.parsed.type === 'pass' && e.parsed.result === 'complete',
    )!;
    const out = await service.lines(s, play as never, events);
    expect(out.pbp).not.toMatch(/Brady/);
    expect(out.pbp).toBe(templateLines(buildPlayContext(play as never, events, teamNames(s))).pbp);
  });
});

describe('grounding check', () => {
  const ctxAndVocab = async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const events = s.log.all().map((e) => e.event);
    const play = events.find(
      (e) => e.kind === 'play' && e.raw.text.includes('R.Dowdle up the middle to TB 49'),
    )!;
    const ctx = buildPlayContext(play as never, events, teamNames(s));
    return { ctx, vocab: allowedVocabulary(ctx, s.rosters, teamNames(s)) };
  };

  it('accepts a line built from the facts', async () => {
    const { ctx, vocab } = await ctxAndVocab();
    expect(
      grounded('Dowdle bursts up the middle for 13 yards. Steelers on the move!', ctx, vocab),
    ).toEqual({ ok: true });
  });

  it('rejects invented players, invented numbers and injury speculation', async () => {
    const { ctx, vocab } = await ctxAndVocab();
    expect(grounded('Dowdle hands it to Derrick Henry for 13.', ctx, vocab).ok).toBe(false);
    expect(grounded('Dowdle has 147 rushing yards today.', ctx, vocab).ok).toBe(false);
    expect(grounded('Dowdle looks like he tore his ACL.', ctx, vocab).ok).toBe(false);
  });
});

describe('live commentary', () => {
  function partial(n: number): EspnSummary {
    const s = structuredClone(summary);
    s.header.competitions[0]!.status!.type.state = 'in';
    let left = n;
    s.drives!.previous = s.drives!.previous!.flatMap((d) => {
      if (left <= 0) return [];
      const plays = d.plays.slice(0, left);
      left -= plays.length;
      return [{ ...d, plays }];
    });
    return s;
  }

  it('streams deltas and logs commentary as plays land', async () => {
    const writer = fakeWriter();
    const cfg = testConfig();
    const service = new CommentaryService(
      new CommentaryCache(cfg.cacheDir, cfg.assetsDir, false),
      writer,
    );
    const session = new GameSession(
      '401873002',
      new EventLog('x', dirname(cfg.logsDir), false),
      partial(3),
      cfg.logsDir,
    );
    const deltas: string[] = [];
    session.on('delta', (d) => deltas.push(d.type === 'delta' ? d.playId : ''));
    service.attach(session);
    session.ingestSummary(partial(3));
    session.ingestSummary(partial(6));
    await vi.waitFor(() => {
      const evs = session.log.all().map((e) => e.event);
      const plays = evs.filter((e) => e.kind === 'play');
      expect(plays.length).toBeGreaterThanOrEqual(5);
      for (const p of plays)
        expect(lines(evs).some((c) => c.playId === (p as { id: string }).id)).toBe(true);
    });
    expect(deltas.length).toBeGreaterThan(0);
    expect(writer.calls).toBeGreaterThan(0);
  });
});
