/** Upcoming game (port of Preview.tsx). The screen polls and switches to the field at kickoff. */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GameDetail, TeamInfo } from '@gridcast/types';
import { kickoffLabel } from '@web/lib/format';
import { colors } from '@/theme';
import { WpBar } from './Scorebug';
import { Display, Label, Section, T, TeamDot } from './ui';

export function countdown(ms: number): string {
  if (ms <= 0) return 'Kickoff';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return h > 24
    ? `${Math.floor(h / 24)}d ${h % 24}h`
    : `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section>
      <Label>{title}</Label>
      {children}
    </Section>
  );
}

function teamOf(abbr: string, d: GameDetail): TeamInfo {
  return abbr === d.home.abbr ? d.home : d.away;
}

export function Preview({ detail }: { detail: GameDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const kickoff = Date.parse(detail.kickoff);
  const p = detail.features.preview ? detail.preview : undefined;
  const pregameWp = detail.kalshiHomeProb ?? p?.predictorHome;
  const facts = [
    kickoffLabel(detail.kickoff),
    detail.venue,
    detail.tv,
    detail.spread ? `Line ${detail.spread}` : undefined,
    detail.total !== undefined ? `O/U ${detail.total}` : undefined,
  ].filter(Boolean);
  return (
    <View style={{ gap: 12 }}>
      <Section style={{ alignItems: 'center', paddingVertical: 28, gap: 16 }}>
        <View style={s.teams}>
          {[detail.away, detail.home].map((t, i) => (
            <View key={t.abbr} style={s.teams}>
              {i === 1 && (
                <T size={18} muted>
                  at
                </T>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TeamDot color={t.color} size={14} />
                <Display size={30}>{t.abbr}</Display>
              </View>
            </View>
          ))}
        </View>
        <Display size={56} accessibilityLabel={`Kickoff in ${countdown(kickoff - now)}`}>
          {countdown(kickoff - now)}
        </Display>
        <T size={13} muted num style={{ textAlign: 'center' }}>
          {facts.join('  ·  ')}
        </T>
        {pregameWp !== undefined && (
          <View style={{ alignSelf: 'stretch' }}>
            <WpBar
              home={detail.home}
              away={detail.away}
              homeProb={pregameWp}
              {...(detail.kalshiHomeProb !== undefined
                ? { kalshiHome: detail.kalshiHomeProb }
                : {})}
            />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 24 }}>
          {[detail.away, detail.home].map((t) =>
            t.record ? (
              <T key={t.abbr} size={13} muted>
                {t.abbr} {t.record}
              </T>
            ) : null,
          )}
        </View>
        <T size={13} muted style={{ textAlign: 'center' }}>
          This screen switches to the live field at kickoff.
        </T>
      </Section>
      {p && p.storylines.length > 0 && (
        <Panel title="Storylines">
          {p.storylines.map((line) => (
            <T key={line}>{line}</T>
          ))}
        </Panel>
      )}
      {p && p.leaders.length > 0 && (
        <Panel title="Team leaders">
          {p.leaders.map((l) => (
            <View key={`${l.team}${l.category}`} style={s.leader}>
              <TeamDot color={teamOf(l.team, detail).color} />
              <T muted style={{ width: 96 }} numberOfLines={1}>
                {l.category}
              </T>
              <T weight="medium" style={{ flex: 1 }} numberOfLines={1}>
                {l.name}
              </T>
              <T muted num>
                {l.value}
              </T>
            </View>
          ))}
        </Panel>
      )}
      {p && p.injuries.some((i) => i.players.length) && (
        <Panel title="Injuries">
          {p.injuries.map((i) => (
            <View key={i.team} style={{ gap: 4 }}>
              <T weight="semibold">{i.team}</T>
              {i.players.map((pl) => (
                <View key={pl.name} style={s.leader}>
                  <T style={{ flex: 1 }}>
                    {pl.name}
                    {pl.position ? <T muted> {pl.position}</T> : null}
                  </T>
                  <T muted>{pl.status}</T>
                </View>
              ))}
            </View>
          ))}
        </Panel>
      )}
      {p && p.comparison.length > 0 && (
        <Panel title="Stat comparison">
          <View style={s.leader}>
            <T size={11} muted style={{ flex: 1 }}>
              {detail.away.abbr}
            </T>
            <T size={11} muted style={{ flex: 1, textAlign: 'right' }}>
              {detail.home.abbr}
            </T>
          </View>
          {p.comparison.map((c) => (
            <View key={c.label} style={s.leader}>
              <T num style={{ flex: 1 }}>
                {c.away}
              </T>
              <T muted style={{ flex: 2, textAlign: 'center' }}>
                {c.label}
              </T>
              <T num style={{ flex: 1, textAlign: 'right' }}>
                {c.home}
              </T>
            </View>
          ))}
        </Panel>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  teams: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  leader: { flexDirection: 'row', alignItems: 'center', gap: 8, borderColor: colors.border },
});
