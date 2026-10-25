/**
 * Append-only event log: one JSONL file per game id under data/logs. Every event the pipeline
 * produces (live or rebuilt) goes through here; the playback clock reads from here.
 */
import { EventEmitter } from 'node:events';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { LoggedEventSchema, type GameEvent, type LoggedEvent } from '@gridcast/types';
import { log } from '../util/logger.ts';

export class EventLog extends EventEmitter<{ append: [LoggedEvent]; reset: [] }> {
  private events: LoggedEvent[] = [];
  readonly path: string;
  /** Lines not yet on disk (a write failed, e.g. disk full); retried on the next append. */
  private pending: string[] = [];
  /** Bytes known to be fully written: a failed write is rolled back to here. */
  private size = 0;
  private writeFailures = 0;

  constructor(
    readonly gameId: string,
    dir: string,
    private readonly persist = true,
    /** File operations (tests swap in failing ones to simulate a full disk). */
    private readonly io: { append: typeof appendFileSync; truncate: typeof truncateSync } = {
      append: appendFileSync,
      truncate: truncateSync,
    },
  ) {
    super();
    this.setMaxListeners(0);
    this.path = join(dir, `${gameId.replace(/[^\w-]/g, '_')}.jsonl`);
    if (persist) {
      mkdirSync(dir, { recursive: true });
      this.load();
    }
  }

  private load() {
    if (!existsSync(this.path)) return;
    const text = readFileSync(this.path, 'utf8');
    this.size = statSync(this.path).size;
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = LoggedEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) this.events.push({ ...parsed.data, seq: this.events.length });
        else log.warn('skipping invalid log line', { gameId: this.gameId });
      } catch {
        log.warn('skipping unreadable log line', { gameId: this.gameId });
      }
    }
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly LoggedEvent[] {
    return this.events;
  }

  from(seq: number): LoggedEvent[] {
    return this.events.slice(Math.max(0, seq));
  }

  append(event: GameEvent): LoggedEvent {
    const entry: LoggedEvent = { seq: this.events.length, event };
    this.events.push(entry);
    if (this.persist) {
      this.pending.push(JSON.stringify(entry) + '\n');
      this.flush();
    }
    // Viewers get the event even if the disk write failed: the stream never stalls on disk.
    this.emit('append', entry);
    return entry;
  }

  /** Lines still waiting for the disk. */
  get unsaved(): number {
    return this.pending.length;
  }

  /**
   * Writes pending lines. On failure (disk full) rolls the file back to the last complete line,
   * keeps the lines for the next attempt and never throws: a half-written line would corrupt the
   * log, and an exception would stop the live pipeline.
   */
  flush(): boolean {
    if (!this.persist || !this.pending.length) return true;
    const data = this.pending.join('');
    try {
      this.io.append(this.path, data);
      this.size += Buffer.byteLength(data);
      this.pending = [];
      if (this.writeFailures) {
        log.info('event log writes recovered', { gameId: this.gameId, after: this.writeFailures });
        this.writeFailures = 0;
      }
      return true;
    } catch (e) {
      try {
        this.io.truncate(this.path, this.size);
      } catch {
        // Nothing more to do; load() skips unreadable lines.
      }
      this.writeFailures++;
      if (this.writeFailures === 1 || this.writeFailures % 50 === 0)
        log.error('event log write failed (kept in memory, will retry)', {
          gameId: this.gameId,
          unsaved: this.pending.length,
          error: (e as Error).message,
        });
      return false;
    }
  }

  appendMany(events: GameEvent[]): void {
    for (const e of events) this.append(e);
  }

  /** Replaces the whole log (used when rebuilding a finished game). */
  replace(events: GameEvent[]): void {
    this.events = events.map((event, seq) => ({ seq, event }));
    this.pending = [];
    if (this.persist) {
      const data =
        this.events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
      try {
        writeFileSync(this.path, data);
        this.size = Buffer.byteLength(data);
      } catch (e) {
        // Keep serving from memory; the next append retries the whole log.
        this.size = 0;
        this.pending = this.events.map((x) => JSON.stringify(x) + '\n');
        try {
          truncateSync(this.path, 0);
        } catch {
          // ignore
        }
        log.error('event log rewrite failed (kept in memory, will retry)', {
          gameId: this.gameId,
          error: (e as Error).message,
        });
      }
    }
    this.emit('reset');
  }
}
