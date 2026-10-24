/**
 * Connects a game page to the server: catches up from the event log instantly, then follows the
 * SSE stream. Handles kill-switch resets, speed changes and jumps without a page reload.
 */
import { LoggedEventSchema, StreamControlSchema, type LoggedEvent } from '@gridcast/types';
import { useGame } from '@/store/game';
import { api } from './api';

export class GameStream {
  private es: EventSource | undefined;
  private log: LoggedEvent[] = [];
  private closed = false;

  constructor(
    private readonly gameId: string,
    private readonly initialSource: 'live' | 'replay',
  ) {}

  /** Full log so far (cached; refreshed when asked). */
  async events(refresh = false): Promise<LoggedEvent[]> {
    if (refresh || !this.log.length) {
      const res = await api.events(this.gameId);
      this.log = res.events;
    }
    return this.log;
  }

  /**
   * (Re)starts playback. Events before `from` are applied instantly; the stream continues at `from`.
   * Live games default to the end of the log; replays to the start.
   */
  async start(
    opts: { from?: number; speed?: number; source?: 'live' | 'replay' } = {},
  ): Promise<void> {
    this.close(false);
    const store = useGame.getState();
    const all = await this.events(true);
    if (this.closed) return;
    const source = opts.source ?? this.initialSource;
    const from = opts.from ?? (source === 'live' ? all.length : 0);
    store.reset(this.gameId);
    store.applyInstant(all.filter((e) => e.seq < from));
    this.open(from, opts.speed);
  }

  /** Reconnects from the next unreceived event, keeping what is on screen (speed change). */
  resume(speed?: number): void {
    this.close(false);
    this.open(useGame.getState().lastSeq + 1, speed);
  }

  private open(from: number, speed?: number) {
    const es = new EventSource(api.streamUrl(this.gameId, { from, ...(speed ? { speed } : {}) }));
    this.es = es;
    const store = useGame.getState();
    es.onopen = () => store.setConnected(true);
    es.onerror = () => store.setConnected(false);
    es.addEventListener('game', (msg) => {
      const parsed = LoggedEventSchema.safeParse(JSON.parse((msg as MessageEvent<string>).data));
      if (parsed.success) useGame.getState().receive(parsed.data);
    });
    es.addEventListener('control', (msg) => {
      const parsed = StreamControlSchema.safeParse(JSON.parse((msg as MessageEvent<string>).data));
      if (!parsed.success) return;
      const c = parsed.data;
      useGame.getState().control(c);
      if (c.type === 'reset') {
        // Live restarts at the end of the log; a replay restarts where the server says.
        void this.start({ source: c.source, ...(c.source === 'replay' ? { from: c.from } : {}) });
      }
    });
  }

  close(final = true): void {
    if (final) this.closed = true;
    this.es?.close();
    this.es = undefined;
  }
}
