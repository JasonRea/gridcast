/**
 * Where the Gridcast server lives. Build-time default from EXPO_PUBLIC_API_BASE (else
 * production), overridable at runtime from the hidden settings screen (long-press the logo),
 * e.g. a laptop's LAN IP during development.
 */
export const PRODUCTION_API = 'https://gridcast-028f.fly.dev';

function clean(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

const envBase =
  typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_API_BASE : (undefined as undefined);

export const DEFAULT_API_BASE = clean(envBase || PRODUCTION_API);

let base = DEFAULT_API_BASE;
const listeners = new Set<(b: string) => void>();

export function apiBase(): string {
  return base;
}

/** Empty string resets to the build default. */
export function setApiBase(url: string): void {
  const next = url.trim() ? clean(url) : DEFAULT_API_BASE;
  if (next === base) return;
  base = next;
  for (const l of listeners) l(base);
}

export function onApiBaseChange(l: (b: string) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** "http://192.168.1.20:8787" style check for the settings field. */
export function isValidBase(url: string): boolean {
  return /^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(url.trim());
}
