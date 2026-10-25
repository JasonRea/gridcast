/**
 * Per-device settings, persisted in AsyncStorage: API base override, haptics, commentary
 * language, radio mode. Loaded once at startup (app/_layout.tsx) before the first request.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { setApiBase } from '@/api/base';
import type { Lang } from '@/lib/langs';

const KEY = 'gridcast.prefs.v1';

export type Prefs = {
  /** Empty = build default (EXPO_PUBLIC_API_BASE or production). */
  apiBase: string;
  haptics: boolean;
  lang: Lang;
  radio: boolean;
};

const DEFAULTS: Prefs = { apiBase: '', haptics: true, lang: 'en', radio: false };

type PrefsStore = Prefs & {
  loaded: boolean;
  load: () => Promise<void>;
  set: (p: Partial<Prefs>) => void;
};

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
      const next = { ...DEFAULTS, ...saved };
      setApiBase(next.apiBase);
      set({ ...next, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  set: (p) => {
    set(p);
    if (p.apiBase !== undefined) setApiBase(p.apiBase);
    const { apiBase, haptics, lang, radio } = get();
    AsyncStorage.setItem(KEY, JSON.stringify({ apiBase, haptics, lang, radio })).catch(
      () => undefined,
    );
  },
}));
