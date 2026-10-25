/**
 * Two-voice announcer queue (port of apps/web/src/lib/announcer.ts). Lines play one at a time so
 * voices never talk over each other. Lines more than 2 plays behind the latest play are skipped.
 * Playback is injected: server TTS (ElevenLabs via our /api/tts) when the `ttsServer` flag is
 * on, else the device voice. See ./speakers.ts for the Expo implementations.
 */

export type Line = {
  text: string;
  voice: 'pbp' | 'color';
  playIndex: number;
  /** Base language of the text ("en", "fr", ...). */
  lang?: string;
};

export type Speakers = {
  /** Plays a line with server TTS. Resolves false when the server can't (flag off, error). */
  server: (line: Line) => Promise<boolean>;
  /** Device text-to-speech. Resolves when the line has finished (or failed). */
  local: (line: Line) => Promise<void>;
  /** Stops whatever is playing right now. */
  stop: () => void;
};

/** How many plays behind the latest a queued line may be before it's dropped. */
export const MAX_STALE_PLAYS = 2;

export class Announcer {
  private queue: Line[] = [];
  private speaking = false;
  private latest = -1;
  muted = true;

  constructor(
    private readonly useServer: boolean,
    private readonly speakers: Speakers,
  ) {}

  setLatest(index: number) {
    this.latest = Math.max(this.latest, index);
  }

  say(line: Line) {
    if (this.muted || !line.text) return;
    this.queue.push(line);
    void this.next();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.stop();
  }

  stop() {
    this.queue = [];
    this.speakers.stop();
    this.speaking = false;
  }

  /** Lines waiting to be read (tests and debugging). */
  pending(): readonly Line[] {
    return this.queue;
  }

  private async next(): Promise<void> {
    if (this.speaking) return;
    let line = this.queue.shift();
    while (line && line.playIndex < this.latest - MAX_STALE_PLAYS) line = this.queue.shift();
    if (!line) return;
    this.speaking = true;
    try {
      const done = this.useServer && (await this.speakers.server(line).catch(() => false));
      if (!done) await this.speakers.local(line).catch(() => undefined);
    } finally {
      this.speaking = false;
      void this.next();
    }
  }
}
