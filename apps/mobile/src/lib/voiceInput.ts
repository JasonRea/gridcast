/**
 * Talk to the booth (P2): speech-to-text through the `expo-speech-recognition` native module.
 * That module isn't in Expo Go, so this only reports `available` in a development build that
 * includes it (`npx expo install expo-speech-recognition`, then `eas build --profile
 * development`). In Expo Go the mic button never shows and nothing here touches native code.
 */
import { requireOptionalNativeModule } from 'expo';

type Result = { results: { transcript: string }[]; isFinal: boolean };
type Sub = { remove: () => void };
type SpeechRecognitionModule = {
  start: (opts: { lang: string; interimResults: boolean; continuous: boolean }) => void;
  stop: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (
    event: 'result' | 'end' | 'error',
    cb: (e: Result & { error?: string }) => void,
  ) => Sub;
};

const native = requireOptionalNativeModule<SpeechRecognitionModule>('ExpoSpeechRecognition');

export const voiceInputAvailable = !!native;

/**
 * Listens once. `onText` gets interim and final text, `onEnd` the final transcript (empty when
 * nothing was heard or permission was denied). Returns a function that stops listening.
 */
export async function startListening(
  onText: (text: string) => void,
  onEnd: (finalText: string) => void,
): Promise<() => void> {
  if (!native) {
    onEnd('');
    return () => undefined;
  }
  const perm = await native.requestPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) {
    onEnd('');
    return () => undefined;
  }
  let finalText = '';
  let ended = false;
  const subs: Sub[] = [];
  const finish = () => {
    if (ended) return;
    ended = true;
    subs.forEach((x) => x.remove());
    onEnd(finalText);
  };
  subs.push(
    native.addListener('result', (e) => {
      const t = e.results[0]?.transcript ?? '';
      if (e.isFinal) finalText = t;
      onText(t);
    }),
    native.addListener('end', finish),
    native.addListener('error', finish),
  );
  native.start({ lang: 'en-US', interimResults: true, continuous: false });
  return () => native.stop();
}
