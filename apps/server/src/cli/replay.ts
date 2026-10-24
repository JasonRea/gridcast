/**
 * `pnpm replay <gameId> [--speed 4] [--from 0]`: streams a game's recorded event log to the console
 * through the same replay clock the SSE stream uses.
 */
import type { GameEvent } from '@gridcast/types';
import { loadConfig } from '../config.ts';
import { createEspnClient } from '../espn/client.ts';
import { GameRegistry } from '../games/registry.ts';
import { replayClock } from '../replay/clock.ts';

const args = process.argv.slice(2);
const gameId = args.find((a) => !a.startsWith('--')) ?? loadConfig().demoGameId;
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) || dflt : dflt;
};

function line(e: GameEvent): string {
  switch (e.kind) {
    case 'play': {
      const s = e.state;
      return `PLAY  Q${s.quarter} ${s.clock.padStart(5)}  ${e.parsed.type.padEnd(7)} ${String(e.parsed.yards).padStart(3)}y  ${s.possession} | ${e.raw.text.slice(0, 110)}`;
    }
    case 'stoppage':
      return `STOP  ${e.reason.padEnd(11)} ${e.title ?? ''}: ${e.detail.slice(0, 110)}`;
    case 'commentary':
      return `  ${e.voice === 'pbp' ? 'PBP  ' : 'COLOR'} ${e.text}`;
    case 'odds':
      return `ODDS  ${e.source} ${e.market} home ${(e.homeProb * 100).toFixed(1)}%`;
    case 'clip':
      return `CLIP  ${e.url}`;
  }
}

const config = loadConfig();
const registry = new GameRegistry(
  config,
  createEspnClient({ fixturesDir: config.fixturesDir, offline: config.offline }),
);
const session = await registry.get(gameId);
if (!session) {
  console.error(`No game ${gameId} (no ESPN response and no fixture).`);
  process.exit(1);
}
const speed = flag('speed', 4);
console.log(
  `${session.card.away.abbr} @ ${session.card.home.abbr}: ${session.log.length} events at ${speed}x`,
);
const ctrl = new AbortController();
process.on('SIGINT', () => ctrl.abort());
for await (const msg of replayClock(session.log, {
  from: flag('from', 0),
  speed,
  signal: ctrl.signal,
})) {
  if (msg.type === 'event')
    console.log(`${String(msg.entry.seq).padStart(4)} ${line(msg.entry.event)}`);
}
