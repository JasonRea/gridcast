import { describe, expect, it } from 'vitest';
import { Announcer, type Line, type Speakers } from '../src/audio/announcer';

function fakeSpeakers(opts: { server?: boolean } = {}) {
  const played: string[] = [];
  let active = 0;
  let maxActive = 0;
  const pending: (() => void)[] = [];
  const play = (tag: string) => (line: Line) =>
    new Promise<void>((resolve) => {
      active++;
      maxActive = Math.max(maxActive, active);
      played.push(`${tag}:${line.voice}:${line.text}`);
      pending.push(() => {
        active--;
        resolve();
      });
    });
  const speakers: Speakers = {
    server: async (line) => {
      if (!opts.server) return false;
      await play('server')(line);
      return true;
    },
    local: play('local'),
    stop: () => undefined,
  };
  const finishOne = async () => {
    pending.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { speakers, played, finishOne, maxActive: () => maxActive };
}

const line = (text: string, playIndex: number, voice: Line['voice'] = 'pbp'): Line => ({
  text,
  voice,
  playIndex,
});

describe('Announcer queue', () => {
  it('stays silent while muted', async () => {
    const f = fakeSpeakers();
    const a = new Announcer(false, f.speakers);
    a.say(line('hello', 0));
    await f.finishOne();
    expect(f.played).toEqual([]);
  });

  it('plays lines in order, one at a time', async () => {
    const f = fakeSpeakers();
    const a = new Announcer(false, f.speakers);
    a.setMuted(false);
    a.say(line('one', 0));
    a.say(line('two', 0, 'color'));
    a.say(line('three', 1));
    for (let i = 0; i < 4; i++) await f.finishOne();
    expect(f.played).toEqual(['local:pbp:one', 'local:color:two', 'local:pbp:three']);
    expect(f.maxActive()).toBe(1);
  });

  it('skips lines more than 2 plays stale', async () => {
    const f = fakeSpeakers();
    const a = new Announcer(false, f.speakers);
    a.setMuted(false);
    a.say(line('now', 0));
    a.say(line('old', 1));
    a.say(line('older', 2));
    a.say(line('fresh', 5));
    a.setLatest(5);
    for (let i = 0; i < 4; i++) await f.finishOne();
    expect(f.played).toEqual(['local:pbp:now', 'local:pbp:fresh']);
  });

  it('uses server TTS when enabled and falls back to the device voice', async () => {
    const on = fakeSpeakers({ server: true });
    const a = new Announcer(true, on.speakers);
    a.setMuted(false);
    a.say(line('ok', 0));
    await on.finishOne();
    expect(on.played).toEqual(['server:pbp:ok']);

    const off = fakeSpeakers({ server: false });
    const b = new Announcer(true, off.speakers);
    b.setMuted(false);
    b.say(line('fallback', 0));
    await off.finishOne();
    expect(off.played).toEqual(['local:pbp:fallback']);
  });

  it('muting clears the queue', async () => {
    const f = fakeSpeakers();
    const a = new Announcer(false, f.speakers);
    a.setMuted(false);
    a.say(line('a', 0));
    a.say(line('b', 0));
    a.setMuted(true);
    expect(a.pending()).toEqual([]);
  });
});
