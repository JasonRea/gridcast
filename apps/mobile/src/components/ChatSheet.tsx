/**
 * Ask the game (port of ChatDrawer.tsx) as an iOS page sheet. POST SSE streaming from
 * /api/games/:id/chat, tool activity ("Checking plays..."), 12 turns of history. Citations like
 * [Q3 4:12] are chips that jump the field to that play. Answers can be read aloud in the color
 * voice. Talk to the booth (voice input) shows only in a dev build with speech recognition.
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessageSchema, type ChatRequest } from '@gridcast/types';
import { api } from '@/api/client';
import { openSSE, safeJson } from '@/api/sse';
import { Announcer } from '@/audio/announcer';
import { expoSpeakers } from '@/audio/speakers';
import { firstCitation, speakableAnswer, splitCitations } from '@/lib/citations';
import { startListening, voiceInputAvailable } from '@/lib/voiceInput';
import { colors, fonts, radius, tabular } from '@/theme';
import { Button, Display, T } from './ui';

type Turn = { role: 'user' | 'assistant'; text: string; status?: string };

const EXAMPLES = [
  'Why did they punt there?',
  "Who's had the best game?",
  'What changed the odds in the 4th quarter?',
];
const MAX_HISTORY = 12;

/** History sent with a question: the last 12 finished turns (ChatRequest allows 12). */
export function historyFor(turns: Turn[]): NonNullable<ChatRequest['history']> {
  return turns
    .filter((t) => t.text)
    .slice(-MAX_HISTORY)
    .map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
}

function Answer({ text, onCite }: { text: string; onCite: (label: string) => void }) {
  return (
    <T size={15} style={{ lineHeight: 22 }}>
      {splitCitations(text).map((part, i) =>
        part.kind === 'cite' ? (
          <T
            key={i}
            size={14}
            weight="semibold"
            num
            onPress={() => onCite(part.label)}
            accessibilityRole="button"
            accessibilityHint="Replays this play on the field"
            style={s.cite}
          >
            {' '}
            {part.label}{' '}
          </T>
        ) : (
          <T key={i} size={15}>
            {part.text}
          </T>
        ),
      )}
    </T>
  );
}

export function ChatSheet({
  gameId,
  open,
  onClose,
  onCite,
  ttsServer,
}: {
  gameId: string;
  open: boolean;
  onClose: () => void;
  onCite: (label: string) => void;
  ttsServer: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const voice = useRef<Announcer | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stopListening = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      abort.current?.abort();
      voice.current?.stop();
      stopListening.current?.();
    },
    [],
  );

  function speak(answer: string) {
    voice.current ??= new Announcer(ttsServer, expoSpeakers);
    voice.current.stop();
    voice.current.setMuted(false);
    // TTS takes 400 characters per line; answers are a few sentences.
    const sentences = speakableAnswer(answer).match(/[^.!?]+[.!?]*/g) ?? [];
    for (const sentence of sentences) {
      const t = sentence.trim().slice(0, 400);
      if (t) voice.current.say({ text: t, voice: 'color', playIndex: Number.MAX_SAFE_INTEGER });
    }
  }

  async function ask(question: string, byVoice = false) {
    const q = question.trim().slice(0, 500);
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    const history = historyFor(turns);
    setTurns((t) => [
      ...t,
      { role: 'user', text: q },
      { role: 'assistant', text: '', status: 'Thinking...' },
    ]);
    const update = (fn: (t: Turn) => Turn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)]);
    let answer = '';
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await openSSE({
        url: api.chatUrl(gameId),
        method: 'POST',
        body: { question: q, ...(history.length ? { history } : {}) } satisfies ChatRequest,
        signal: ctrl.signal,
        onFrame: (f) => {
          const m = ChatMessageSchema.safeParse(safeJson(f.data));
          if (!m.success) return;
          const msg = m.data;
          if (msg.type === 'delta') {
            answer += msg.text;
            update((t) => ({ ...t, text: t.text + msg.text, status: '' }));
          } else if (msg.type === 'tool') {
            update((t) => ({
              ...t,
              status: `Checking ${msg.name.replace(/^get_/, '').replace(/_/g, ' ')}...`,
            }));
          } else if (msg.type === 'error') {
            update((t) => ({ ...t, text: t.text || msg.message, status: '' }));
          }
          scroll.current?.scrollToEnd({ animated: true });
        },
      });
    } catch {
      if (!ctrl.signal.aborted)
        update((t) => ({
          ...t,
          text: t.text || 'The analyst is unavailable right now.',
          status: '',
        }));
    } finally {
      update((t) => ({ ...t, status: '' }));
      setBusy(false);
      abort.current = null;
    }
    if (byVoice && answer) {
      speak(answer);
      const cited = firstCitation(answer);
      if (cited) onCite(cited);
    }
  }

  async function listen() {
    if (listening) {
      stopListening.current?.();
      return;
    }
    voice.current?.stop();
    setListening(true);
    stopListening.current = await startListening(
      (t) => setInput(t),
      (final) => {
        setListening(false);
        stopListening.current = null;
        if (final.trim()) void ask(final, true);
      },
    );
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={s.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <Display size={22}>Ask the game</Display>
          <Button icon="x" variant="ghost" onPress={onClose} accessibilityLabel="Close" />
        </View>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {!turns.length && (
            <View style={{ gap: 10 }}>
              <T muted>
                Ask anything about this game. Answers come from the play-by-play log and cite plays.
              </T>
              {EXAMPLES.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => void ask(e)}
                  style={s.example}
                  accessibilityRole="button"
                >
                  <T>{e}</T>
                </Pressable>
              ))}
            </View>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <View key={i} style={s.user}>
                <T size={15}>{t.text}</T>
              </View>
            ) : (
              <View key={i} style={{ gap: 6 }}>
                {t.status ? (
                  <T size={13} muted>
                    {t.status}
                  </T>
                ) : null}
                {t.text ? (
                  <Answer
                    text={t.text}
                    onCite={(l) => {
                      onClose();
                      onCite(l);
                    }}
                  />
                ) : null}
                {t.text && !t.status && i === turns.length - 1 && !busy ? (
                  <Button
                    icon="volume-2"
                    label="Read aloud"
                    size="sm"
                    style={{ alignSelf: 'flex-start' }}
                    onPress={() => speak(t.text)}
                  />
                ) : null}
              </View>
            ),
          )}
        </ScrollView>
        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {voiceInputAvailable && (
            <Button
              icon={listening ? 'mic-off' : 'mic'}
              variant={listening ? 'primary' : 'secondary'}
              onPress={() => void listen()}
              accessibilityLabel={listening ? 'Stop listening' : 'Talk to the booth: ask out loud'}
            />
          )}
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={listening ? 'Listening...' : 'Ask about this game'}
            placeholderTextColor={colors.muted}
            style={s.input}
            returnKeyType="send"
            onSubmitEditing={() => void ask(input)}
            editable={!busy}
            maxLength={500}
            accessibilityLabel="Question"
          />
          <Pressable
            onPress={() => void ask(input)}
            disabled={busy || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[s.send, (busy || !input.trim()) && { opacity: 0.4 }]}
          >
            <Feather name="send" size={18} color={colors.background} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  example: { backgroundColor: colors.raised, borderRadius: radius.md, padding: 12 },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.raised,
    borderRadius: radius.sheet,
    padding: 10,
  },
  cite: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.sm, ...tabular },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    color: colors.text,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
