/**
 * Connects a game screen to the server (port of apps/web/src/lib/stream.ts): catches up from the
 * event log instantly, then follows the SSE stream. Adds what EventSource gave the web for free,
 * plus what a phone needs:
 * - reconnect with backoff (1 s doubling to 10 s) and `Last-Event-ID` resume
 * - stall detection: the server sends a `status` heartbeat every 5 s, so 15 s of silence means
 *   the connection is dead even if the socket never errored
 * - `sleep()` / `wake()` for app background and foreground (resume from lastSeq + 1)
 * - `control: reset` (kill switch) restarts playback without leaving the screen
 */
import { LoggedEventSchema, StreamControlSchema, type LoggedEvent } from '@gridcast/types';
import { useGame } from '@/store/game';
import { api } from './client';
import { openSSE, safeJson, type FetchLike, type SSEFrame } from './sse';

export type ConnectionState = 'connecting' | 'open' | 'retrying' | 'offline' | 'closed';

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 10_000;
export const STALL_MS = 15_000;
/** After this many failed attempts in a row the screen shows the offline banner. */
const OFFLINE_AFTER = 2;

export function nextBackoff(prev: number | undefined): number {
  return prev === undefined ? BACKOFF_START_MS : Math.min(BACKOFF_MAX_MS, prev * 2);
}

type Store = ReturnType<typeof useGame.getState>;

export class GameStream {
  private log: LoggedEvent[] = [];
  private closed = false;
  /** Bumped on every (re)open; stale loops check it and exit. */
  private gen = 0;
  private ctrl: AbortController | undefined;
  private speed: number | undefined;
  private sleeping = false;

  /** Called whenever playback (re)starts. */
  onStart:
    ((from: number, speed: number | undefined, source: 'live' | 'replay') => void) | undefined;
  onConnection: ((s: ConnectionState) => void) | undefined;

  constructor(
    private readonly gameId: string,
    private readonly initialSource: 'live' | 'replay',
    private readonly deps: {
      store?: () => Store;
      fetch?: FetchLike;
      events?: (id: string) => Promise<LoggedEvent[]>;
      streamUrl?: (id: string, o: { from: number; speed?: number }) => string;
    } = {},
  ) {}

  private get store(): Store {
    return (this.deps.store ?? useGame.getState)();
  }

  /** Full log so far (cached; refreshed when asked). */
  async events(refresh = false): Promise<LoggedEvent[]> {
    if (refresh || !this.log.length) {
      this.log = this.deps.events
        ? await this.deps.events(this.gameId)
        : (await api.events(this.gameId)).events;
    }
    return this.log;
  }

  /**
   * (Re)starts playback. Events before `from` are applied instantly; the stream continues at
   * `from`. Live games default to the end of the log; replays to the start.
   */
  async start(
    opts: { from?: number; speed?: number; source?: 'live' | 'replay' } = {},
  ): Promise<void> {
    this.disconnect();
    this.closed = false;
    const gen = this.gen;
    const all = await this.events(true);
    if (this.closed || gen !== this.gen) return;
    const source = opts.source ?? this.initialSource;
    const from = opts.from ?? (source === 'live' ? all.length : 0);
    const store = this.store;
    store.reset(this.gameId);
    store.applyInstant(all.filter((e) => e.seq < from));
    this.speed = opts.speed;
    this.open(from);
    this.onStart?.(from, opts.speed, source);
  }

  /** Reconnects from the next unreceived event, keeping what is on screen (speed change). */
  resume(speed?: number): void {
    this.disconnect();
    this.speed = speed;
    this.open(this.store.lastSeq + 1);
    this.onStart?.(this.store.lastSeq + 1, speed, this.store.source);
  }

  /** App went to the background: drop the socket, keep the screen. */
  sleep(): void {
    if (this.closed) return;
    this.sleeping = true;
    this.disconnect();
    this.onConnection?.('closed');
  }

  /** App is back: pick up exactly where we left off. */
  wake(): void {
    if (this.closed || !this.sleeping) return;
    this.sleeping = false;
    this.open(this.store.lastSeq + 1);
  }

  close(): void {
    this.closed = true;
    this.disconnect();
    this.onConnection?.('closed');
  }

  private disconnect() {
    this.gen++;
    this.ctrl?.abort();
    this.ctrl = undefined;
    this.store.setConnected(false);
  }

  private open(from: number) {
    const gen = ++this.gen;
    void this.loop(gen, from);
  }

  private async loop(gen: number, firstFrom: number) {
    let backoff: number | undefined;
    let failures = 0;
    let first = true;
    while (!this.closed && gen === this.gen) {
      const ctrl = new AbortController();
      this.ctrl = ctrl;
      let stall: ReturnType<typeof setTimeout> | undefined;
      const kick = () => {
        clearTimeout(stall);
        stall = setTimeout(() => ctrl.abort(), STALL_MS);
      };
      // A resume asks for the next unseen event; the server reads Last-Event-ID first.
      const lastSeq = this.store.lastSeq;
      const from = first ? firstFrom : lastSeq + 1;
      const headers: Record<string, string> = {};
      if (!first && lastSeq >= 0) headers['last-event-id'] = String(lastSeq);
      this.onConnection?.(
        failures >= OFFLINE_AFTER ? 'offline' : first ? 'connecting' : 'retrying',
      );
      let reset = false;
      try {
        kick();
        await openSSE({
          url: (this.deps.streamUrl ?? api.streamUrl)(this.gameId, {
            from,
            ...(this.speed ? { speed: this.speed } : {}),
          }),
          headers,
          signal: ctrl.signal,
          ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
          onOpen: () => {
            if (gen !== this.gen) return;
            backoff = undefined;
            failures = 0;
            this.store.setConnected(true);
            this.onConnection?.('open');
          },
          onFrame: (f) => {
            if (gen !== this.gen) return;
            kick();
            if (this.handle(f)) reset = true;
          },
        });
      } catch {
        // Network error, HTTP error or stall abort: all retried the same way below.
        if (gen !== this.gen || this.closed) return;
      } finally {
        clearTimeout(stall);
      }
      if (gen !== this.gen || this.closed) return;
      if (reset) return;
      first = false;
      failures++;
      this.store.setConnected(false);
      this.onConnection?.(failures >= OFFLINE_AFTER ? 'offline' : 'retrying');
      backoff = nextBackoff(backoff);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  /** Applies one frame. Returns true when it was a reset (the loop must stop). */
  private handle(f: SSEFrame): boolean {
    if (f.event === 'game') {
      const parsed = LoggedEventSchema.safeParse(safeJson(f.data));
      if (parsed.success) this.store.receive(parsed.data);
      else console.warn('[gridcast] skipped bad game event', f.id);
      return false;
    }
    if (f.event === 'control') {
      const parsed = StreamControlSchema.safeParse(safeJson(f.data));
      if (!parsed.success) return false;
      const c = parsed.data;
      this.store.control(c);
      if (c.type === 'reset') {
        // Live restarts at the end of the log; a replay restarts where the server says.
        void this.start({
          source: c.source,
          ...(c.source === 'replay' ? { from: c.from } : {}),
          ...(this.speed ? { speed: this.speed } : {}),
        });
        return true;
      }
    }
    return false;
  }
}
