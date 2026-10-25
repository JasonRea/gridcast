/**
 * Talk to the booth: the browser hears the question (Web Speech API), the analyst answers
 * through the server, the color voice reads the answer and the field replays the play it cites.
 */

const QUARTERS = ['', 'first quarter', 'second quarter', 'third quarter', 'fourth quarter'];

/** "[Q3 4:12]" -> "at 4:12 of the third quarter"; "[OT 3:15]" -> "at 3:15 of overtime". */
export function speakableAnswer(text: string): string {
  return text
    .replace(
      /\[(Q([1-4])|OT) (\d{1,2}:\d{2})\]/g,
      (_, _p: string, q: string | undefined, clock: string) =>
        `at ${clock} of ${q ? `the ${QUARTERS[Number(q)]}` : 'overtime'}`,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** First play an answer cites, as a label like "Q3 4:12". */
export function firstCitation(text: string): string | undefined {
  return /\[((?:Q[1-4]|OT) \d{1,2}:\d{2})\]/.exec(text)?.[1];
}

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
export type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

/** The browser's speech recognizer, if it has one (Chrome, Edge, Safari). */
export function createRecognition(): Recognition | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return undefined;
  const r = new Ctor();
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = false;
  return r;
}
