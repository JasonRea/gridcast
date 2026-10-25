/**
 * Hidden settings (long-press the GRIDCAST logo): API base override for development (a laptop's
 * LAN IP), haptics, commentary language, about.
 */
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { apiBase, DEFAULT_API_BASE, isValidBase } from '@/api/base';
import { Button, Display, Label, Section, Segmented, T } from '@/components/ui';
import { LANGS } from '@/lib/langs';
import { usePrefs } from '@/prefs';
import { colors, fonts, radius } from '@/theme';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(prefs.apiBase);
  const [check, setCheck] = useState<string | undefined>();
  const valid = !draft.trim() || isValidBase(draft);

  const save = () => {
    if (!valid) return;
    prefs.set({ apiBase: draft.trim() });
    setCheck(undefined);
    void qc.invalidateQueries();
  };
  const test = async () => {
    setCheck('Checking...');
    try {
      const h = await api.health();
      setCheck(
        h.ok
          ? `Connected${h.offline ? ' (offline mode: fixtures)' : ''}`
          : 'Server answered but is not ok',
      );
    } catch (e) {
      setCheck(`Can't reach ${apiBase()}: ${e instanceof Error ? e.message : 'error'}`);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.head}>
        <Display size={30}>Settings</Display>
        <Button
          icon="x"
          variant="ghost"
          onPress={() => router.back()}
          accessibilityLabel="Close settings"
        />
      </View>

      <Section>
        <Label>Server</Label>
        <T size={13} muted>
          Leave empty to use the build default ({DEFAULT_API_BASE}). On a laptop, use its LAN IP,
          e.g. http://192.168.1.20:8787 (the phone's localhost is the phone).
        </T>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={DEFAULT_API_BASE}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={save}
          style={[s.input, !valid && { borderColor: colors.negative, borderWidth: 1 }]}
          accessibilityLabel="API base URL"
        />
        {!valid && (
          <T size={12} color={colors.negative}>
            Use a full URL starting with http:// or https://
          </T>
        )}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Save" variant="primary" onPress={save} disabled={!valid} />
          <Button label="Test connection" icon="activity" onPress={() => void test()} />
          <Button
            label="Reset"
            variant="ghost"
            onPress={() => {
              setDraft('');
              prefs.set({ apiBase: '' });
              void qc.invalidateQueries();
            }}
          />
        </View>
        <T size={12} muted>
          Using: {apiBase()}
        </T>
        {check && <T size={12}>{check}</T>}
      </Section>

      <Section>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <T weight="semibold">Haptics</T>
            <T size={12} muted>
              Touchdowns, turnovers, scores and first downs.
            </T>
          </View>
          <Switch
            value={prefs.haptics}
            onValueChange={(v) => prefs.set({ haptics: v })}
            accessibilityLabel="Haptics"
          />
        </View>
      </Section>

      <Section>
        <Label>Commentary language</Label>
        <T size={12} muted>
          Used when the server has translation turned on.
        </T>
        <Segmented
          options={LANGS.map((l) => ({ value: l.code, label: l.label }))}
          value={prefs.lang}
          onChange={(v) => prefs.set({ lang: v })}
          accessibilityLabel="Commentary language"
          style={{ alignSelf: 'flex-start' }}
        />
      </Section>

      <Section>
        <Label>About</Label>
        <T size={13} muted>
          Gridcast {Constants.expoConfig?.version ?? ''} · Expo SDK{' '}
          {Constants.expoConfig?.sdkVersion ?? ''}
        </T>
        <T size={13} muted>
          Odds shown for information only. Not betting advice.
        </T>
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    color: colors.text,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
});
