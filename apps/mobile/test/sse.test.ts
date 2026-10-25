import { describe, expect, it } from 'vitest';
import { openSSE, SSEHttpError, SSEParser, type FetchLike, type SSEFrame } from '../src/api/sse';

/** Recorded from the server: a status heartbeat, two game events and a delta. */
const RECORDED = [
  'event: control\ndata: {"type":"status","source":"replay","speed":2}\n\n',
  'event: game\nid: 0\ndata: {"seq":0,"event":{"kind":"commentary","playId":"1","ts":1,"voice":"pbp","text":"Kickoff."}}\n\n',
  'event: control\ndata: {"type":"delta","playId":"1","voice":"color","text":"Here we go"}\n\n',
  'event: game\nid: 1\ndata: {"seq":1}\n\n',
].join('');

function feedAll(chunks: string[]): SSEFrame[] {
  const p = new SSEParser();
  return [...chunks.flatMap((c) => p.feed(c)), ...p.flush()];
}

describe('SSEParser', () => {
  it('parses recorded frames in one chunk', () => {
    const frames = feedAll([RECORDED]);
    expect(frames.map((f) => f.event)).toEqual(['control', 'game', 'control', 'game']);
    expect(frames[1]!.id).toBe('0');
    expect(JSON.parse(frames[1]!.data).event.text).toBe('Kickoff.');
    // id is sticky, like EventSource.
    expect(frames[2]!.id).toBe('0');
    expect(frames[3]!.id).toBe('1');
  });

  it('gives the same frames however the bytes are split', () => {
    const whole = feedAll([RECORDED]);
    for (const size of [1, 2, 3, 7, 13, 50]) {
      const chunks: string[] = [];
      for (let i = 0; i < RECORDED.length; i += size) chunks.push(RECORDED.slice(i, i + size));
      expect(feedAll(chunks)).toEqual(whole);
    }
  });

  it('joins multi-line data with newlines', () => {
    const [f] = feedAll(['data: line one\ndata: line two\ndata:\ndata:  indented\n\n']);
    expect(f!.event).toBe('message');
    expect(f!.data).toBe('line one\nline two\n\n indented');
  });

  it('handles CRLF and lone CR line endings, including a CR at a chunk edge', () => {
    expect(feedAll(['event: a\r\ndata: 1\r\n\r\n'])[0]).toMatchObject({ event: 'a', data: '1' });
    expect(feedAll(['event: b\rdata: 2\r\r'])[0]).toMatchObject({ event: 'b', data: '2' });
    expect(feedAll(['event: c\r', '\ndata: 3\r', '\n\r', '\n'])).toEqual([
      { event: 'c', data: '3', id: undefined },
    ]);
  });

  it('ignores comments and unknown fields, keeps retry', () => {
    const frames = feedAll([': keepalive\n\nfoo: bar\nretry: 3000\ndata: x\n\n']);
    expect(frames).toEqual([{ event: 'message', data: 'x', id: undefined, retry: 3000 }]);
  });

  it('dispatches a last frame with no trailing blank line at end of stream', () => {
    const frames = feedAll(['event: game\nid: 9\ndata: {"seq":9}']);
    expect(frames).toEqual([{ event: 'game', data: '{"seq":9}', id: '9' }]);
  });

  it('skips frames with no data', () => {
    expect(feedAll(['event: ping\n\nid: 4\n\n'])).toEqual([]);
  });
});

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch);
      c.close();
    },
  });
}

describe('openSSE', () => {
  it('reads a streamed body and reports open', async () => {
    let opened = false;
    const seen: SSEFrame[] = [];
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      // Split a multi-byte character across chunks to exercise the streaming decoder.
      const bytes = new TextEncoder().encode('data: café\n\n');
      const cut = bytes.length - 3; // between the two bytes of the accented e
      return {
        ok: true,
        status: 200,
        body: streamOf([bytes.slice(0, cut), bytes.slice(cut), 'data: end']),
      };
    };
    await openSSE({
      url: 'http://x/stream',
      method: 'POST',
      body: { question: 'q' },
      fetch: fake,
      onOpen: () => (opened = true),
      onFrame: (f) => seen.push(f),
    });
    expect(opened).toBe(true);
    expect(seen.map((f) => f.data)).toEqual(['caf\u00e9', 'end']);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers?.['content-type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{"question":"q"}');
  });

  it('throws on HTTP errors', async () => {
    const fake: FetchLike = async () => ({ ok: false, status: 404, body: null });
    await expect(
      openSSE({ url: 'u', fetch: fake, onFrame: () => undefined }),
    ).rejects.toBeInstanceOf(SSEHttpError);
  });
});
