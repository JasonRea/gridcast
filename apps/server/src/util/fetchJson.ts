import type { z } from 'zod';
import { log } from './logger.ts';

export type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * GET + zod validation that never throws. A network error, non-2xx status or a shape change
 * is logged and returned as `{ ok: false }` so pollers keep running.
 */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  schema: S,
  opts: { timeoutMs?: number; fetcher?: Fetcher; headers?: Record<string, string> } = {},
): Promise<FetchResult<z.infer<S>>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await (opts.fetcher ?? fetch)(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'gridcast/0.1', ...opts.headers },
    });
    if (!res.ok) {
      log.warn('upstream non-2xx', { url, status: res.status });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body: unknown = await res.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn('upstream shape mismatch', { url, issues: parsed.error.issues.slice(0, 3) });
      return { ok: false, error: 'schema' };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    log.warn('upstream fetch failed', { url, error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
