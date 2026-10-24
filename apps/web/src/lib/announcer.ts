/**
 * Two-voice announcer queue. Lines play one at a time so voices never talk over each other.
 * Uses the server's ElevenLabs proxy when available, else the browser's speechSynthesis.
 * Lines more than 2 plays behind the latest play are skipped.
 */
import { API_BASE } from './api';

export type Line = { text: string; voice: 'pbp' | 'color'; playIndex: number };

export class Announcer {
  private queue: Line[] = [];
  private speaking = false;
  private latest = -1;
  private audio: HTMLAudioElement | undefined;
  muted = true;

  constructor(private readonly useServer: boolean) {}

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
    this.audio?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.speaking = false;
  }

  private async next(): Promise<void> {
    if (this.speaking) return;
    let line = this.queue.shift();
    while (line && line.playIndex < this.latest - 2) line = this.queue.shift();
    if (!line) return;
    this.speaking = true;
    try {
      if (!(this.useServer && (await this.playServer(line)))) await this.playBrowser(line);
    } finally {
      this.speaking = false;
      void this.next();
    }
  }

  private async playServer(line: Line): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: line.text, voice: line.voice }),
      });
      if (!res.ok) return false;
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      this.audio = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  private playBrowser(line: Line): Promise<void> {
    if (typeof speechSynthesis === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(line.text);
      const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      const voice = line.voice === 'pbp' ? english[0] : (english[1] ?? english[0]);
      if (voice) u.voice = voice;
      u.rate = line.voice === 'pbp' ? 1.12 : 0.98;
      u.pitch = line.voice === 'pbp' ? 1.05 : 0.85;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
}
