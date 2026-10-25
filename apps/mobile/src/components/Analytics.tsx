/**
 * Odds and analytics: market vs model chart (hand-drawn react-native-svg, no chart library),
 * the 4th-down bot and team EPA. Each is hidden when its server flag is off.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { FourthDownCall, OddsTick, PlayEvent, TeamInfo } from '@gridcast/types';
import { headline, playLabel, swing } from '@web/lib/plays';
import { colors, fonts, radius } from '@/theme';
import { Display, Label, Section, Segmented, T, TeamDot } from './ui';

type Teams = { home: TeamInfo; away: TeamInfo };

export type ChartPoint = { i: number; model?: number; market?: number; swing: number };

/** One point per play: model WP after it, and the last market price at or before it (0-100). */
export function chartPoints(plays: PlayEvent[], odds: OddsTick[]): ChartPoint[] {
  const ml = odds.filter((o) => o.market === 'moneyline');
  let k = 0;
  let market: number | undefined;
  return plays.map((p, i) => {
    while (k < ml.length && ml[k]!.ts <= p.ts) market = ml[k++]!.homeProb;
    return {
      i,
      ...(p.wpAfter !== undefined ? { model: p.wpAfter * 100 } : {}),
      ...(market !== undefined ? { market: market * 100 } : {}),
      swing: swing(p),
    };
  });
}

export function OddsChart({
  plays,
  odds,
  teams,
  onSelect,
}: {
  plays: PlayEvent[];
  odds: OddsTick[];
  teams: Teams;
  onSelect?: (index: number) => void;
}) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | undefined>();
  const data = useMemo(() => chartPoints(plays, odds), [plays, odds]);
  if (data.length < 2) return <T muted>The chart fills in as plays come in.</T>;
  const H = 200;
  const padL = 26;
  const padR = 6;
  const padT = 8;
  const padB = 8;
  const n = data.length;
  const x = (i: number) => padL + (i / (n - 1)) * Math.max(1, w - padL - padR);
  const y = (v: number) => padT + (1 - v / 100) * (H - padT - padB);
  const model = data
    .filter((d) => d.model !== undefined)
    .map((d, j) => `${j ? 'L' : 'M'}${x(d.i).toFixed(1)},${y(d.model!).toFixed(1)}`)
    .join('');
  // Market is a step line (prices hold until the next trade).
  let market = '';
  let prev: number | undefined;
  for (const d of data) {
    if (d.market === undefined) continue;
    market +=
      prev === undefined
        ? `M${x(d.i).toFixed(1)},${y(d.market).toFixed(1)}`
        : `H${x(d.i).toFixed(1)}V${y(d.market).toFixed(1)}`;
    prev = d.market;
  }
  const spikes = data.filter((d) => Math.abs(d.swing) >= 5 && d.model !== undefined);
  const hasMarket = market.length > 0;
  const selPlay = sel !== undefined ? plays[sel] : undefined;
  const selPoint = sel !== undefined ? data[sel] : undefined;
  const pick = (px: number) => {
    const i = Math.max(
      0,
      Math.min(n - 1, Math.round(((px - padL) / Math.max(1, w - padL - padR)) * (n - 1))),
    );
    setSel(i);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={{ width: 14, height: 2, backgroundColor: teams.home.color }} />
          <T size={11} muted>
            {teams.home.abbr} win probability (model)
          </T>
        </View>
        {hasMarket && (
          <View style={s.legendItem}>
            <View
              style={{
                width: 14,
                height: 0,
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.text,
              }}
            />
            <T size={11} muted>
              Market (Kalshi)
            </T>
          </View>
        )}
        <View style={s.legendItem}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.text }} />
          <T size={11} muted>
            Swing 5+ pts
          </T>
        </View>
      </View>
      <View
        style={{ height: H }}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        accessible
        accessibilityLabel={`Win probability chart, ${n} plays`}
      >
        {w > 0 && (
          <Svg width={w} height={H}>
            {[0, 25, 50, 75, 100].map((v) => (
              <Line
                key={v}
                x1={padL}
                x2={w - padR}
                y1={y(v)}
                y2={y(v)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            {[0, 50, 100].map((v) => (
              <SvgText
                key={`t${v}`}
                x={padL - 6}
                y={y(v) + 4}
                fill={colors.muted}
                fontSize={10}
                fontFamily={fonts.regular}
                textAnchor="end"
              >
                {String(v)}
              </SvgText>
            ))}
            <Path d={model} stroke={teams.home.color} strokeWidth={2} fill="none" />
            {hasMarket && (
              <Path
                d={market}
                stroke="#FFFFFF"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="none"
              />
            )}
            {spikes.map((d) => (
              <Circle key={d.i} cx={x(d.i)} cy={y(d.model!)} r={4} fill="#FFFFFF" stroke="#000" />
            ))}
            {selPoint && (
              <Line
                x1={x(selPoint.i)}
                x2={x(selPoint.i)}
                y1={padT}
                y2={H - padB}
                stroke={colors.muted}
                strokeWidth={1}
              />
            )}
          </Svg>
        )}
      </View>
      {selPlay && selPoint && (
        <Pressable
          onPress={() => onSelect?.(sel!)}
          style={s.tip}
          accessibilityRole="button"
          accessibilityHint="Replays this play"
        >
          <T size={12} muted num>
            {playLabel(selPlay)} · {headline(selPlay)}
          </T>
          <T size={12} num>
            {teams.home.abbr} WP{' '}
            {selPoint.model !== undefined ? `${selPoint.model.toFixed(1)}%` : '--'}
            {selPoint.market !== undefined ? `  ·  Market ${selPoint.market.toFixed(1)}%` : ''}
          </T>
          {onSelect && (
            <T size={11} weight="semibold">
              Tap to replay
            </T>
          )}
        </Pressable>
      )}
    </View>
  );
}

function epaStats(plays: PlayEvent[], team: string) {
  const mine = plays.filter(
    (p) =>
      p.pre.possession === team &&
      p.epa !== undefined &&
      ['run', 'pass', 'sack'].includes(p.parsed.type),
  );
  const sum = (xs: PlayEvent[]) => xs.reduce((a, p) => a + (p.epa ?? 0), 0);
  const per = (xs: PlayEvent[]) => (xs.length ? sum(xs) / xs.length : undefined);
  return {
    plays: mine.length,
    perPlay: per(mine),
    pass: per(mine.filter((p) => p.parsed.type !== 'run')),
    run: per(mine.filter((p) => p.parsed.type === 'run')),
    success: mine.length ? mine.filter((p) => (p.epa ?? 0) > 0).length / mine.length : undefined,
  };
}

const fmt = (n: number | undefined) =>
  n === undefined ? '--' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
const tone = (n: number | undefined) =>
  n === undefined ? colors.text : n > 0 ? colors.positive : n < 0 ? colors.negative : colors.text;

export function TeamEpa({ plays, teams }: { plays: PlayEvent[]; teams: Teams }) {
  const cols = ['Plays', 'EPA/play', 'Pass', 'Run', 'Success'];
  return (
    <View style={{ gap: 6 }}>
      <View style={s.tr}>
        <T size={10} muted upper style={s.tdTeam}>
          Team
        </T>
        {cols.map((c) => (
          <T key={c} size={10} muted upper style={s.td}>
            {c}
          </T>
        ))}
      </View>
      {[teams.away, teams.home].map((t) => {
        const st = epaStats(plays, t.abbr);
        return (
          <View key={t.abbr} style={s.tr}>
            <View style={[s.tdTeam, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              <TeamDot color={t.color} />
              <T size={13} weight="semibold">
                {t.abbr}
              </T>
            </View>
            <T size={13} num style={s.td}>
              {st.plays}
            </T>
            <T size={13} num color={tone(st.perPlay)} style={s.td}>
              {fmt(st.perPlay)}
            </T>
            <T size={13} num color={tone(st.pass)} style={s.td}>
              {fmt(st.pass)}
            </T>
            <T size={13} num color={tone(st.run)} style={s.td}>
              {fmt(st.run)}
            </T>
            <T size={13} num style={s.td}>
              {st.success === undefined ? '--' : `${Math.round(st.success * 100)}%`}
            </T>
          </View>
        );
      })}
      <T size={11} muted>
        Expected points added per scrimmage play, from an nflverse model.
      </T>
    </View>
  );
}

const NAME = { go: 'Go for it', punt: 'Punt', fg: 'Field goal' } as const;

function Options({ call }: { call: FourthDownCall }) {
  const keys = (['go', 'fg', 'punt'] as const).filter((k) => call.options[k] !== undefined);
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
      {keys.map((k) => (
        <View
          key={k}
          style={[s.option, call.recommend === k && { borderColor: colors.text, borderWidth: 1 }]}
        >
          <T size={10} muted upper>
            {NAME[k]}
          </T>
          <Display size={20}>
            {call.options[k]! > 0 ? '+' : ''}
            {call.options[k]!.toFixed(1)}
          </Display>
          <T size={10} muted num>
            {k === 'go'
              ? `${Math.round(call.goProb * 100)}% to convert`
              : k === 'fg' && call.fgProb !== undefined
                ? `${Math.round(call.fgProb * 100)}% make`
                : 'expected pts'}
          </T>
        </View>
      ))}
    </View>
  );
}

function History({ call }: { call: FourthDownCall }) {
  const h = call.history;
  if (!h) return null;
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <View style={[s.option, { marginTop: 8 }]}>
      <T size={10} muted upper>
        Historical twins · {h.seasons}
      </T>
      <T size={13} style={{ marginTop: 2 }}>
        In this spot ({h.situation}), teams went for it {p(h.goRate)} of the time
        {h.convRate !== undefined ? ` and converted ${p(h.convRate)}` : ''}.
      </T>
      <T size={11} muted num>
        Field goal {p(h.fgRate)} · punt {p(h.puntRate)} · n = {h.n.toLocaleString('en-US')} fourth
        downs
      </T>
    </View>
  );
}

export function FourthDownPanel({ plays, teams }: { plays: PlayEvent[]; teams: Teams }) {
  const last = plays[plays.length - 1];
  const upcoming = last?.nextFourthDown;
  const graded = [...plays].reverse().find((p) => p.fourthDown?.call);
  const name = (abbr: string) =>
    abbr === teams.home.abbr ? teams.home.shortName : teams.away.shortName;
  if (!upcoming && !graded) return <T muted>No fourth down yet.</T>;
  return (
    <View style={{ gap: 16 }}>
      {upcoming && last && (
        <View>
          <Label>
            Up next: {name(last.state.possession)} 4th & {last.state.distance}
          </Label>
          <T style={{ marginTop: 4 }}>
            Bot says <T weight="semibold">{NAME[upcoming.recommend]}</T>
          </T>
          <Options call={upcoming} />
          <History call={upcoming} />
        </View>
      )}
      {graded?.fourthDown && (
        <View>
          <Label>
            Last 4th down · {playLabel(graded)} · {name(graded.pre.possession)}
          </Label>
          <T style={{ marginTop: 4 }}>
            Coach chose <T weight="semibold">{NAME[graded.fourthDown.call!]}</T>.{' '}
            {graded.fourthDown.call === graded.fourthDown.recommend ||
            (graded.fourthDown.delta ?? 0) < 0.1 ? (
              <T color={colors.positive}>Agreed.</T>
            ) : (
              <T color={colors.negative}>
                Bot disagrees: -{graded.fourthDown.delta?.toFixed(1)} expected points.
              </T>
            )}
          </T>
          <Options call={graded.fourthDown} />
          <History call={graded.fourthDown} />
        </View>
      )}
      <T size={11} muted>
        Values are expected points for the offense, from an nflverse model. Historical twins: every
        4th down in nflverse play-by-play since 2016.
      </T>
    </View>
  );
}

type Tab = 'odds' | 'fourth' | 'epa';

export function AnalyticsPanel({
  plays,
  odds,
  teams,
  features,
  onSelect,
}: {
  plays: PlayEvent[];
  odds: OddsTick[];
  teams: Teams;
  features: Record<string, boolean>;
  onSelect: (index: number) => void;
}) {
  const tabs = (
    [
      ['odds', 'Market vs model', features.oddsChart],
      ['fourth', '4th-down bot', features.fourthDown],
      ['epa', 'Team EPA', features.epa],
    ] as [Tab, string, boolean | undefined][]
  ).filter(([, , on]) => on);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'odds');
  if (!tabs.length) return <T muted>No analytics for this game.</T>;
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0]![0];
  return (
    <Section>
      <Segmented
        accessibilityLabel="Analytics"
        options={tabs.map(([value, label]) => ({ value, label }))}
        value={active}
        onChange={setTab}
        style={{ alignSelf: 'flex-start' }}
      />
      {active === 'odds' && (
        <OddsChart plays={plays} odds={odds} teams={teams} onSelect={onSelect} />
      )}
      {active === 'fourth' && <FourthDownPanel plays={plays} teams={teams} />}
      {active === 'epa' && <TeamEpa plays={plays} teams={teams} />}
    </Section>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tip: { backgroundColor: colors.raised, borderRadius: radius.md, padding: 10, gap: 2 },
  tr: { flexDirection: 'row', alignItems: 'center' },
  tdTeam: { width: 56 },
  td: { flex: 1, textAlign: 'right' },
  option: { flex: 1, backgroundColor: colors.raised, borderRadius: radius.md, padding: 8, gap: 2 },
});
