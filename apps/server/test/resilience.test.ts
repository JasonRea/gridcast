/**
 * Oct 25 live game: the 1 GB volume filled in the 4th quarter. Writes failed, live viewers
 * stopped getting plays, the saved log was cut mid-line and a finished game kept being polled.
 */
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  EspnSummarySchema,
  type EspnSummary,
  type GameEvent,
  type LoggedEvent,
} from '@gridcast/types';
import { loadConfig } from '../src/config.ts';
import { LivePoller } from '../src/live/poller.ts';
import { EventLog } from '../src/log/eventLog.ts';
import { createServices } from '../src/services.ts';
import { DEMO, testConfig } from './helpers.ts';

const odds = (n: number): GameEvent => ({
  kind: 'odds',
  ts: n,
  source: 'kalshi',
  market: 'moneyline',
  homeProb: n / 100,
});

describe('event log on a full disk', () => {
  it('keeps streaming, never leaves a half line, and saves everything once space is back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-log-'));
    let full = false;
    const io = {
      append: ((path: string, data: string) => {
        if (full) {
          // A real ENOSPC can land after part of the data is written.
          appendFileSync(path, data.slice(0, 7));
          throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
            code: 'ENOSPC',
          });
        }
        appendFileSync(path, data);
      }) as typeof appendFileSync,
      truncate: truncateSync,
    };
    const log = new EventLog('g', dir, true, io);
    const seen: LoggedEvent[] = [];
    log.on('append', (e) => seen.push(e));
    log.append(odds(1));
    full = true;
    expect(() => log.append(odds(2))).not.toThrow();
    log.append(odds(3));
    // Viewers got every event; the file holds only complete lines.
    expect(seen.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(log.unsaved).toBe(2);
    const onDisk = readFileSync(log.path, 'utf8');
    expect(onDisk.endsWith('\n')).toBe(true);
    expect(onDisk.trim().split('\n')).toHaveLength(1);
    // Space is back: the next write (or a poller retry) saves the backlog in order.
    full = false;
    expect(log.flush()).toBe(true);
    const reloaded = new EventLog('g', dir);
    expect(reloaded.all().map((e) => (e.event as { ts: number }).ts)).toEqual([1, 2, 3]);
  });
});

const final = EspnSummarySchema.parse(
  JSON.parse(readFileSync(join(loadConfig().fixturesDir, 'espn/summary_401873002.json'), 'utf8')),
);
function withState(state: 'pre' | 'in' | 'post'): EspnSummary {
  const s = structuredClone(final);
  const comp = s.header.competitions[0]!;
  comp.status!.type = { ...comp.status!.type, state, completed: state === 'post' };
  if (state === 'pre') s.drives = { previous: [] };
  return s;
}

function setup(first: EspnSummary) {
  let summary = first;
  let calls = 0;
  const fetcher = async (url: string) => {
    if (!url.includes('/summary?event=')) return new Response('nope', { status: 404 });
    calls++;
    return Response.json(summary);
  };
  const config = { ...testConfig(), offline: false, featuredGameId: DEMO };
  const services = createServices(config, { fetcher, writer: null });
  let t = 1_000_000;
  const recordDir = join(config.dataDir, 'rec');
  const poller = new LivePoller(services.espn, services.registry, {
    featuredGameId: DEMO,
    intervalMs: 10_000,
    recordDir,
    now: () => t,
  });
  const files = () => {
    try {
      return readdirSync(join(recordDir, DEMO));
    } catch {
      return [];
    }
  };
  return {
    poller,
    files,
    recordDir,
    calls: () => calls,
    serve: (s: EspnSummary) => (summary = s),
    advance: (ms: number) => (t += ms),
  };
}

describe('recorder', () => {
  it('records nothing before kickoff', async () => {
    const r = setup(withState('pre'));
    await r.poller.tick();
    await r.poller.tick();
    expect(r.calls()).toBeGreaterThanOrEqual(2);
    expect(r.files()).toEqual([]);
  });

  it('records a changed response once, gzipped; identical responses are skipped', async () => {
    const r = setup(withState('in'));
    await r.poller.tick();
    r.advance(10_000);
    await r.poller.tick();
    const files = r.files();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/-summary\.json\.gz$/);
    const body = JSON.parse(
      gunzipSync(readFileSync(join(r.recordDir, DEMO, files[0]!))).toString(),
    ) as EspnSummary;
    expect(body.header.id).toBe(DEMO);
  });
});

describe('after the final whistle', () => {
  it('polls a finished featured game for 10 minutes, then stops', async () => {
    const r = setup(withState('in'));
    await r.poller.tick();
    r.serve(withState('post'));
    r.advance(10_000);
    await r.poller.tick(); // sees it final
    const atFinal = r.calls();
    r.advance(9 * 60_000);
    await r.poller.tick();
    expect(r.calls()).toBe(atFinal + 1);
    r.advance(2 * 60_000);
    await r.poller.tick();
    await r.poller.tick();
    expect(r.calls()).toBe(atFinal + 1);
  });
});
