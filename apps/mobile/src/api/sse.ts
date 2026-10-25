/**
 * Server-Sent Events over fetch. React Native has no EventSource, so this reads a streaming
 * response body (Expo installs `expo/fetch` as the global fetch, which streams on iOS) and parses
 * frames per the WHATWG spec: `event:`, `data:` (multi-line joined with "\n"), `id:`, `retry:`,
 * `:` comments ignored. Works for GET streams and for SSE over POST (chat).
 */

export type SSEFrame = {
  /** Event name; "message" when the frame has no `event:` field. */
  event: string;
  data: string;
  /** Last event id seen so far on this stream (sticky, like EventSource). */
  id: string | undefined;
  /** `retry:` value in ms, when the frame set one. */
  retry?: number;
};

/** Incremental parser: feed decoded text chunks in any split, get complete frames back. */
export class SSEParser {
  private buf = '';
  private event = '';
  private data: string[] = [];
  private hasData = false;
  private retry: number | undefined;
  /** Sticky across frames, as in EventSource. */
  lastId: string | undefined;

  feed(chunk: string): SSEFrame[] {
    this.buf += chunk;
    const out: SSEFrame[] = [];
    // Lines end with \n, \r\n or \r. Keep a trailing \r: its \n may be in the next chunk.
    for (;;) {
      const m = /\r\n|\n|\r(?!$)/.exec(this.buf);
      if (!m) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const frame = this.line(line);
      if (frame) out.push(frame);
    }
    return out;
  }

  /** Call when the stream ends: a last frame without its blank line still counts. */
  flush(): SSEFrame[] {
    const out: SSEFrame[] = [];
    if (this.buf) {
      const f = this.line(this.buf.replace(/\r$/, ''));
      if (f) out.push(f);
      this.buf = '';
    }
    const f = this.line('');
    if (f) out.push(f);
    return out;
  }

  private line(line: string): SSEFrame | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        this.event = value;
        break;
      case 'data':
        this.data.push(value);
        this.hasData = true;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return undefined;
  }

  private dispatch(): SSEFrame | undefined {
    const frame: SSEFrame | undefined = this.hasData
      ? {
          event: this.event || 'message',
          data: this.data.join('\n'),
          id: this.lastId,
          ...(this.retry !== undefined ? { retry: this.retry } : {}),
        }
      : undefined;
    this.event = '';
    this.data = [];
    this.hasData = false;
    this.retry = undefined;
    return frame;
  }
}

/** The subset of fetch this module needs (global fetch, expo/fetch, or a test double). */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}>;

export type OpenSSEOptions = {
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Defaults to the global fetch (expo/fetch on device). */
  fetch?: FetchLike;
  onOpen?: () => void;
  onFrame: (frame: SSEFrame) => void;
};

export class SSEHttpError extends Error {
  constructor(readonly status: number) {
    super(`SSE HTTP ${status}`);
  }
}

/**
 * Opens one SSE connection and reads it to the end. Resolves when the server closes the
 * stream, rejects on a network error or a non-2xx status. Reconnecting is the caller's job.
 */
export async function openSSE(opts: OpenSSEOptions): Promise<void> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const headers: Record<string, string> = { accept: 'text/event-stream', ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await doFetch(opts.url, {
    method: opts.method ?? 'GET',
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok || !res.body) throw new SSEHttpError(res.status);
  opts.onOpen?.();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  // Abort must also end a read that is already waiting (not every fetch wires the signal in).
  const cancel = () => void reader.cancel().catch(() => undefined);
  opts.signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value)
        for (const f of parser.feed(decoder.decode(value, { stream: true }))) opts.onFrame(f);
    }
    for (const f of parser.feed(decoder.decode())) opts.onFrame(f);
    for (const f of parser.flush()) opts.onFrame(f);
  } finally {
    opts.signal?.removeEventListener('abort', cancel);
  }
}

/** Parses JSON without throwing; undefined on bad input. */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
