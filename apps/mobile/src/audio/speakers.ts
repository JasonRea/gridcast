/**
 * Expo playback for the announcer: server TTS bytes are written to a cache file with
 * expo-file-system and played with expo-audio; the fallback is the device voice (expo-speech).
 * The audio session is set to play with the ringer switch on silent.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { api } from '@/api/client';
import type { Line, Speakers } from './announcer';

let sessionReady: Promise<void> | undefined;
/** Play through the silent switch and duck other apps' audio. Called before any sound. */
export function prepareAudioSession(): Promise<void> {
  sessionReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
  }).catch((err) => {
    sessionReady = undefined;
    console.warn('[gridcast] audio session', err);
  });
  return sessionReady;
}

/** Deeper US English system voices, best first. Names vary by iOS version and installed voices. */
const DEEP_VOICES = [
  /daniel/i,
  /\bguy\b/i,
  /david/i,
  /\bmark\b/i,
  /\balex\b/i,
  /\bfred\b/i,
  /male/i,
];

let voices: Promise<Speech.Voice[]> | undefined;
async function pickVoice(kind: 'pbp' | 'color', lang = 'en'): Promise<string | undefined> {
  voices ??= Speech.getAvailableVoicesAsync().catch(() => []);
  const all = await voices;
  if (lang !== 'en') {
    const local = all.filter((v) => v.language.toLowerCase().startsWith(lang));
    return (kind === 'pbp' ? local[0] : (local[1] ?? local[0]))?.identifier;
  }
  const english = all.filter((v) => v.language.startsWith('en'));
  const us = english.filter((v) => v.language === 'en-US');
  const deep = DEEP_VOICES.map(
    (re) => us.find((v) => re.test(v.name)) ?? english.find((v) => re.test(v.name)),
  ).filter((v): v is Speech.Voice => !!v);
  const pbp = deep[0] ?? us[0] ?? english[0];
  if (kind === 'pbp') return pbp?.identifier;
  return (english.find((v) => v !== pbp) ?? english[0])?.identifier;
}

let player: AudioPlayer | undefined;
let finishCurrent: (() => void) | undefined;
let n = 0;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function playServer(line: Line): Promise<boolean> {
  try {
    await prepareAudioSession();
    const res = await fetch(api.ttsUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: line.text.slice(0, 400), voice: line.voice }),
    });
    if (!res.ok) return false;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return false;
    const file = new File(Paths.cache, `tts-${line.voice}-${hash(line.text)}-${n++ % 8}.mp3`);
    if (file.exists) file.delete();
    file.create({ overwrite: true });
    await file.write(bytes);
    await new Promise<void>((resolve) => {
      const p = createAudioPlayer({ uri: file.uri });
      player = p;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        sub.remove();
        clearTimeout(guard);
        p.remove();
        if (player === p) player = undefined;
        finishCurrent = undefined;
        resolve();
      };
      finishCurrent = done;
      const sub = p.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) done();
      });
      // A line is a sentence or two; never let a stuck player hold the queue.
      const guard = setTimeout(done, 30_000);
      p.play();
    });
    return true;
  } catch (err) {
    console.warn('[gridcast] server TTS failed, using device voice', err);
    return false;
  }
}

async function playLocal(line: Line): Promise<void> {
  await prepareAudioSession();
  const voice = await pickVoice(line.voice, line.lang);
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      finishCurrent = undefined;
      resolve();
    };
    finishCurrent = done;
    Speech.speak(line.text, {
      ...(voice ? { voice } : {}),
      ...(line.lang && line.lang !== 'en' ? { language: line.lang } : { language: 'en-US' }),
      // Play-by-play: lower and unhurried, network style. Color: natural, a touch brighter.
      rate: line.voice === 'pbp' ? 0.95 : 1.0,
      pitch: line.voice === 'pbp' ? 0.85 : 1.0,
      useApplicationAudioSession: true,
      onDone: done,
      onStopped: done,
      onError: done,
    });
  });
}

export const expoSpeakers: Speakers = {
  server: playServer,
  local: playLocal,
  stop: () => {
    player?.pause();
    void Speech.stop();
    finishCurrent?.();
  },
};
