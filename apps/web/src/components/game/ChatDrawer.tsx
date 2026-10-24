import { MessageCircle, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useRef, useState } from 'react';
import { ChatMessageSchema } from '@gridcast/types';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/lib/api';

type Turn = { role: 'user' | 'assistant'; text: string; status?: string };

const CITE = /\[((?:Q[1-4]|OT) \d{1,2}:\d{2})\]/g;

const EXAMPLES = [
  'Why did they punt there?',
  "Who's had the best game?",
  'What changed the odds in the 4th quarter?',
];

/** Renders an answer with [Q3 4:12] citations as buttons that replay the play. */
function Answer({ text, onCite }: { text: string; onCite: (label: string) => void }) {
  const parts = text.split(CITE);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button
            key={i}
            onClick={() => onCite(part)}
            className="mx-0.5 rounded-sm bg-white/10 px-1 font-semibold num hover:bg-white/20"
          >
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/** Ask the game: chat drawer. Claude answers from the game's event log through server tools. */
export function ChatDrawer({
  gameId,
  onCite,
}: {
  gameId: string;
  onCite: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setInput('');
    const history = turns.filter((t) => t.text).map(({ role, text }) => ({ role, text }));
    setTurns((t) => [
      ...t,
      { role: 'user', text: question },
      { role: 'assistant', text: '', status: 'Thinking...' },
    ]);
    const update = (fn: (t: Turn) => Turn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)]);
    try {
      const res = await fetch(`${API_BASE}/api/games/${gameId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame
            .split('\n')
            .find((l) => l.startsWith('data: '))
            ?.slice(6);
          if (!data) continue;
          const m = ChatMessageSchema.safeParse(JSON.parse(data));
          if (!m.success) continue;
          const msg = m.data;
          if (msg.type === 'delta') update((t) => ({ ...t, text: t.text + msg.text, status: '' }));
          else if (msg.type === 'tool')
            update((t) => ({
              ...t,
              status: `Checking ${msg.name.replace(/^get_/, '').replace(/_/g, ' ')}...`,
            }));
          else if (msg.type === 'error')
            update((t) => ({ ...t, text: t.text || msg.message, status: '' }));
        }
        bottom.current?.scrollIntoView({ block: 'end' });
      }
    } catch {
      update((t) => ({ ...t, text: 'The analyst is unavailable right now.', status: '' }));
    } finally {
      update((t) => ({ ...t, status: '' }));
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="fixed right-4 bottom-4 z-30 shadow-none"
        size="lg"
        onClick={() => setOpen(true)}
        aria-label="Ask the game"
      >
        <MessageCircle /> Ask the game
      </Button>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-popover"
            aria-label="Ask the game"
          >
            <header className="flex items-center gap-2 p-4">
              <h2 className="font-semibold">Ask the game</h2>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X />
              </Button>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              {!turns.length && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    Ask about anything that has happened in this game.
                  </p>
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      onClick={() => void ask(q)}
                      className="rounded-md bg-secondary px-3 py-2 text-left text-sm hover:bg-[#242424]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <p key={i} className="self-end rounded-md bg-secondary px-3 py-2 text-sm">
                    {t.text}
                  </p>
                ) : (
                  <div key={i} className="flex flex-col gap-1">
                    {t.status && <span className="text-xs text-muted-foreground">{t.status}</span>}
                    {t.text && <Answer text={t.text} onCite={onCite} />}
                  </div>
                ),
              )}
              <div ref={bottom} />
            </div>
            <form
              className="flex gap-2 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Why did they punt there?"
                maxLength={500}
                className="h-10 flex-1 rounded-md bg-secondary px-3 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
                <Send />
              </Button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
