/**
 * Sound design (P1, FLAG_SOUND): a low crowd bed that swells with win-probability swings and a
 * short whistle on stoppages. Synthesized with Web Audio, so there are no audio assets to ship.
 * Starts only after the user unmutes (browsers block autoplay anyway).
 */
export class Crowd {
  private ctx: AudioContext | undefined;
  private bed: GainNode | undefined;

  private ensure(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    const ctx = new Ctx();
    // Two seconds of brown noise, looped and band-passed into a stadium murmur.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 500;
    band.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start();
    this.ctx = ctx;
    this.bed = gain;
    return ctx;
  }

  setOn(on: boolean) {
    if (on) void this.ensure()?.resume();
    else void this.ctx?.suspend();
  }

  /** Swell scaled to the swing (0-100 win-probability points). */
  swell(points: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bed || ctx.state !== 'running') return;
    const peak = Math.min(0.35, 0.05 + Math.abs(points) / 60);
    const g = this.bed.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + 0.4);
    g.exponentialRampToValueAtTime(0.04, t + 4);
  }

  whistle() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.frequency.value = 2900;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(osc.frequency);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.03);
    gain.gain.setValueAtTime(0.06, t + 0.35);
    gain.gain.linearRampToValueAtTime(0, t + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.5);
    lfo.stop(t + 0.5);
  }
}
