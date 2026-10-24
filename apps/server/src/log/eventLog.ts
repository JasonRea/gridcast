/**
 * Append-only event log: one JSONL file per game id under data/logs. Every event the pipeline
 * produces (live or rebuilt) goes through here; the playback clock reads from here.
 */
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoggedEventSchema, type GameEvent, type LoggedEvent } from '@gridcast/types';
import { log } from '../util/logger.ts';

export class EventLog extends EventEmitter<{ append: [LoggedEvent]; reset: [] }> {
  private events: LoggedEvent[] = [];
  readonly path: string;

  constructor(
    readonly gameId: string,
    dir: string,
    private readonly persist = true,
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
    const lines = readFileSync(this.path, 'utf8').split('\n');
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
    if (this.persist) appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.emit('append', entry);
    return entry;
  }

  appendMany(events: GameEvent[]): void {
    for (const e of events) this.append(e);
  }

  /** Replaces the whole log (used when rebuilding a finished game). */
  replace(events: GameEvent[]): void {
    this.events = events.map((event, seq) => ({ seq, event }));
    if (this.persist) {
      writeFileSync(
        this.path,
        this.events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''),
      );
    }
    this.emit('reset');
  }
}
