/**
 * Access mode: hear and feel the field. Driven by the same animation that moves the ball:
 * - stereo pan follows the ball across the field (left end zone = left ear)
 * - pitch rises as the offense gets closer to the end zone it attacks
 * - a quiet steady tone sits at the first-down line, a tick marks every 5 yards gained
 * - each outcome has its own sound (snap, tackle, incomplete, first down, turnover, score,
 *   touchdown roar) and, on Android, its own vibration pattern
 * Everything is synthesized with Web Audio. The touchdown roar uses an ElevenLabs sound effect
 * from the server when one is configured, else a synthesized crowd.
 */
import type { PlayEvent } from '@gridcast/types';
import type { BallSample } from '@/field/Field';
import { absX, dirOf, FIELD_W, SCALE } from '@/field/geometry';
import { API_BASE } from './api';

export type Outcome =
  'td' | 'turnover' | 'first_down' | 'incomplete' | 'tackle' | 'score' | 'miss' | 'flag' | 'none';

/** What a play sounds like when it ends. */
export function outcomeOf(play: PlayEvent): Outcome {
  const p = play.parsed;
  if (p.result === 'interception' || p.result === 'fumble') return 'turnover';
  if (p.result === 'td') return 'td';
  if (p.type === 'fg' || p.type === 'pat') return p.result === 'good' ? 'score' : 'miss';
  if (p.type === 'penalty') return 'flag';
  if (p.result === 'incomplete') return p.type === 'spike' ? 'none' : 'incomplete';
  if (p.firstDown && (p.type === 'run' || p.type === 'pass')) return 'first_down';
  if (p.type === 'run' || p.type === 'pass' || p.type === 'sack' || p.type === 'kneel')
    return 'tackle';
  return 'none';
}

/** Android vibration patterns (ms on/off). iPhone Safari ignores vibrate; sound covers it. */
export const HAPTICS: Partial<Record<Outcome, number[]>> = {
  td: [400, 150, 400],
  turnover: [90, 70, 90, 70, 90],
  first_down: [120, 90, 120],
  score: [250],
};

/** -1 (left end line) to +1 (right end line). */
export function panFor(x: number): number {
  return Math.max(-1, Math.min(1, (x / FIELD_W) * 2 - 1));
}

/** Yards from the ball to the end zone the offense attacks (0-100). */
export function yardsToGoal(x: number, offense: string, homeAbbr: string): number {
  const yd = x / SCALE;
  const fromOwnGoal = dirOf(offense, { homeAbbr }) === 1 ? yd - 10 : 110 - yd;
  return Math.max(0, Math.min(100, 100 - fromOwnGoal));
}

/** 220 Hz at the offense's own goal line, two octaves higher (880 Hz) at the goal it attacks. */
export function pitchFor(ytg: number): number {
  return 220 * 2 ** ((100 - Math.max(0, Math.min(100, ytg))) / 50);
}

/** New 5-yard marks of gain passed when the ball moves from `prev` to `cur` (yards gained). */
export function fiveYardTicks(prevGain: number, curGain: number): number {
  if (curGain <= prevGain) return 0;
  return Math.max(0, Math.floor(curGain / 5) - Math.floor(Math.max(0, prevGain) / 5));
}

type Voice = { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode };

export class AccessAudio {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private ball: Voice | undefined;
  private fdLine: Voice | undefined;
  private startGain = 0;
  private lastGain = 0;
  private roar: AudioBuffer | null | undefined;
  enabled = false;

  /** Must run from a user gesture (browsers block audio until then). */
  async enable(): Promise<void> {
    this.enabled = true;
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume().catch(() => undefined);
    void this.loadRoar();
  }

  disable(): void {
    this.enabled = false;
    this.stopVoices();
  }

  /** Feed from the field animation. */
  onBall(s: BallSample): void {
    if (!this.enabled || !this.ctx) return;
    const ytg = yardsToGoal(s.x, s.offense, s.homeAbbr);
    const gain = 100 - ytg;
    if (s.phase === 'start') {
      this.stopVoices();
      this.startGain = gain;
      this.lastGain = 0;
      this.snap(panFor(s.x));
      if (['run', 'pass', 'sack'].includes(s.play.parsed.type)) {
        this.ball = this.voice('triangle', pitchFor(ytg), 0.09, panFor(s.x));
        const pre = s.play.pre;
        if (pre.down && pre.distance !== undefined && pre.yardLine + pre.distance < 100) {
          const fx = absX(pre.possession, pre.yardLine + pre.distance, { homeAbbr: s.homeAbbr });
          this.fdLine = this.voice('sine', 330, 0.025, panFor(fx));
        }
      }
      return;
    }
    if (s.phase === 'move') {
      const t = this.ctx.currentTime;
      if (this.ball) {
        this.ball.osc.frequency.setTargetAtTime(pitchFor(ytg), t, 0.03);
        this.ball.pan.pan.setTargetAtTime(panFor(s.x), t, 0.03);
      }
      const gained = gain - this.startGain;
      const ticks = fiveYardTicks(this.lastGain, gained);
      if (ticks > 0 && this.ball) this.tick(panFor(s.x));
      this.lastGain = Math.max(this.lastGain, gained);
      return;
    }
    this.stopVoices();
    this.outcome(outcomeOf(s.play), panFor(s.x));
  }

  private outcome(o: Outcome, pan: number): void {
    const pattern = HAPTICS[o];
    if (pattern && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Some browsers throw without a recent user gesture; sound still plays.
      }
    }
    switch (o) {
      case 'td':
        this.playRoar(pan);
        this.notes([523, 659, 784, 1047], 0.12, 'triangle', pan, 0.12);
        break;
      case 'turnover':
        this.notes([523, 415, 330], 0.14, 'square', pan, 0.05);
        break;
      case 'first_down':
        this.tackle(pan);
        this.notes([660, 880], 0.12, 'sine', pan, 0.1, 0.15);
        break;
      case 'incomplete':
        this.glide(500, 250, 0.25, pan);
        break;
      case 'tackle':
        this.tackle(pan);
        break;
      case 'score':
        this.notes([784, 1568], 0.35, 'sine', pan, 0.1);
        break;
      case 'miss':
        this.glide(400, 180, 0.4, pan);
        break;
      case 'flag':
        this.notes([2000], 0.15, 'sine', pan, 0.05);
        break;
      default:
    }
  }

  // ---- synthesis ----

  private voice(type: OscillatorType, freq: number, level: number, pan: number): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const p = ctx.createStereoPanner();
    osc.type = type;
    osc.frequency.value = freq;
    p.pan.value = pan;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.08);
    osc.connect(gain).connect(p).connect(this.master!);
    osc.start();
    return { osc, gain, pan: p };
  }

  private release(v: Voice | undefined): void {
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.05);
    v.osc.stop(t + 0.3);
  }

  private stopVoices(): void {
    this.release(this.ball);
    this.release(this.fdLine);
    this.ball = undefined;
    this.fdLine = undefined;
  }

  private env(level: number, dur: number, pan: number, at = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(p).connect(this.master!);
    return g;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    pan: number,
    level: number,
    at = 0,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.env(level, dur, pan, at));
    o.start(ctx.currentTime + at);
    o.stop(ctx.currentTime + at + dur + 0.05);
  }

  private notes(
    freqs: number[],
    dur: number,
    type: OscillatorType,
    pan: number,
    level: number,
    delay = 0,
  ) {
    freqs.forEach((f, i) => this.tone(f, dur, type, pan, level, delay + i * dur * 0.9));
  }

  private glide(from: number, to: number, dur: number, pan: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
    o.connect(this.env(0.08, dur, pan));
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  private noise(dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private snap(pan: number) {
    const ctx = this.ctx!;
    const src = this.noise(0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    src.connect(bp).connect(this.env(0.35, 0.06, pan));
    src.start();
  }

  private tick(pan: number) {
    this.tone(1500, 0.03, 'square', pan, 0.05);
  }

  private tackle(pan: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.2);
    o.connect(this.env(0.35, 0.22, pan));
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  private async loadRoar(): Promise<void> {
    if (this.roar !== undefined || !this.ctx) return;
    this.roar = null;
    try {
      const res = await fetch(`${API_BASE}/api/sfx/touchdown`);
      if (res.status !== 200) return;
      this.roar = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.roar = null;
    }
  }

  private playRoar(pan: number) {
    const ctx = this.ctx!;
    if (this.roar) {
      const src = ctx.createBufferSource();
      src.buffer = this.roar;
      const g = ctx.createGain();
      g.gain.value = 0.8;
      src.connect(g).connect(this.master!);
      src.start();
      return;
    }
    // Synthesized crowd: band-limited noise that swells and fades.
    const dur = 2.6;
    const src = this.noise(dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.5;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(p).connect(this.master!);
    src.start();
  }
}

/**
 * One sentence for screen readers when a play finishes: the announcer's call (or the feed
 * text), then the score and the new situation.
 */
export function describePlay(
  play: PlayEvent,
  pbp: string | undefined,
  teams: { home: { abbr: string; shortName: string }; away: { abbr: string; shortName: string } },
): string {
  const call = pbp ?? play.raw.text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');
  const s = play.state;
  const score = `${teams.away.shortName} ${s.away}, ${teams.home.shortName} ${s.home}.`;
  const ord = ['', 'First', 'Second', 'Third', 'Fourth'][s.down ?? 0];
  const goal = s.distance !== undefined && s.yardLine + s.distance >= 100;
  const next =
    ord && s.down ? ` ${ord} and ${goal ? 'goal' : (s.distance ?? '')}, ${s.possession} ball.` : '';
  return `${call} ${score}${next}`.replace(/\s+/g, ' ').trim();
}
