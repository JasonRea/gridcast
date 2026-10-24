/** Tiny structured logger. Upstream failures are logged and skipped, never thrown to callers. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const quiet = process.env.NODE_ENV === 'test' || process.env.VITEST;

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (quiet && level !== 'error') return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) =>
    process.env.DEBUG && write('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};
