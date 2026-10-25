/**
 * The field, drawn with react-native-svg (port of apps/web/src/field/Field.tsx). Same
 * coordinates as the web: 1200 x 533 SVG units (tenths of a yard), scaled with viewBox.
 *
 * Animation: `planPlay` (./plan.ts) builds the play's timeline once; `usePlayAnimation` samples
 * it every frame and re-renders only the moving layer. The static surface is memoized.
 */
import { memo, useMemo } from 'react';
import Svg, { Ellipse, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import type { DepthChart, GameState, PlayEvent, RosterPlayer, TeamInfo } from '@gridcast/types';
import { absX, CENTER_Y, FIELD_H, FIELD_W, SCALE, type Orientation } from '@web/field/geometry';
import { buildLineup, type FieldPlayer } from '@web/field/lineup';
import { fonts } from '@/theme';
import { BALL, BALL_BODY, BANNER, FLAG, flashKey, MARKER } from './plan';
import type { TargetState } from './timeline';
import { usePlayAnimation } from './usePlayAnimation';

export type FieldProps = {
  home: TeamInfo;
  away: TeamInfo;
  depth: Record<string, DepthChart>;
  rosters: Record<string, RosterPlayer[]>;
  play: PlayEvent | undefined;
  state: GameState | undefined;
  replayToken: number;
  speed: number;
  paused: boolean;
  instant: boolean;
  onDone: (playId: string) => void;
  /** 'involved': only players in the play get a name label (portrait); 'all': everyone. */
  labels?: 'all' | 'involved';
  /** Radio mode: keep the play clock running (it paces the queue) but draw nothing. */
  headless?: boolean;
};

const YARD_NUMBERS = [10, 20, 30, 40, 50, 40, 30, 20, 10];
const DISPLAY = fonts.display;
const UI = fonts.semibold;

const FieldSurface = memo(function FieldSurface({
  home,
  away,
}: {
  home: TeamInfo;
  away: TeamInfo;
}) {
  const lines = [];
  for (let yd = 15; yd <= 105; yd += 5) {
    const x = yd * SCALE;
    lines.push(
      <Line
        key={`l${yd}`}
        x1={x}
        x2={x}
        y1={0}
        y2={FIELD_H}
        stroke="#fff"
        strokeOpacity={yd % 10 === 0 ? 0.25 : 0.14}
        strokeWidth={yd === 60 ? 2.5 : 1.5}
      />,
    );
  }
  const hashes = [];
  for (let yd = 11; yd < 110; yd++) {
    if (yd % 5 === 0) continue;
    const x = yd * SCALE;
    for (const y of [10, 233, 300, FIELD_H - 10]) {
      hashes.push(
        <Line
          key={`h${yd}-${y}`}
          x1={x}
          x2={x}
          y1={y - 5}
          y2={y + 5}
          stroke="#fff"
          strokeOpacity={0.18}
          strokeWidth={1.5}
        />,
      );
    }
  }
  return (
    <G>
      <Rect x={0} y={0} width={FIELD_W} height={FIELD_H} fill="#000" />
      {/* End zones tinted with team color at 20%. Home defends the left end zone. */}
      <Rect x={0} y={0} width={10 * SCALE} height={FIELD_H} fill={home.color} fillOpacity={0.2} />
      <Rect
        x={110 * SCALE}
        y={0}
        width={10 * SCALE}
        height={FIELD_H}
        fill={away.color}
        fillOpacity={0.2}
      />
      <SvgText
        x={50}
        y={CENTER_Y + 15}
        fill={home.color}
        fillOpacity={0.55}
        fontSize={44}
        fontFamily={DISPLAY}
        textAnchor="middle"
        letterSpacing={6}
        transform={`rotate(-90 50 ${CENTER_Y})`}
      >
        {home.shortName.toUpperCase()}
      </SvgText>
      <SvgText
        x={FIELD_W - 50}
        y={CENTER_Y + 15}
        fill={away.color}
        fillOpacity={0.55}
        fontSize={44}
        fontFamily={DISPLAY}
        textAnchor="middle"
        letterSpacing={6}
        transform={`rotate(90 ${FIELD_W - 50} ${CENTER_Y})`}
      >
        {away.shortName.toUpperCase()}
      </SvgText>
      <Rect
        x={10 * SCALE}
        y={0}
        width={100 * SCALE}
        height={FIELD_H}
        fill="none"
        stroke="#fff"
        strokeOpacity={0.35}
        strokeWidth={3}
      />
      {lines}
      {hashes}
      {YARD_NUMBERS.map((n, i) => {
        const x = (20 + i * 10) * SCALE;
        return (
          <G key={`n${i}`}>
            <SvgText
              x={x}
              y={52}
              fill="#fff"
              fillOpacity={0.4}
              fontFamily={DISPLAY}
              fontSize={30}
              textAnchor="middle"
            >
              {String(n)}
            </SvgText>
            <SvgText
              x={x}
              y={FIELD_H - 30}
              fill="#fff"
              fillOpacity={0.4}
              fontFamily={DISPLAY}
              fontSize={30}
              textAnchor="middle"
              transform={`rotate(180 ${x} ${FIELD_H - 40})`}
            >
              {String(n)}
            </SvgText>
          </G>
        );
      })}
      {[0, FIELD_W].map((x) => (
        <Line
          key={`gp${x}`}
          x1={x}
          x2={x}
          y1={CENTER_Y - 28}
          y2={CENTER_Y + 28}
          stroke="#FFD60A"
          strokeOpacity={0.6}
          strokeWidth={3}
        />
      ))}
    </G>
  );
});

function Player({
  p,
  s,
  fill,
  text,
  label,
}: {
  p: FieldPlayer;
  s: TargetState | undefined;
  fill: string;
  text: string;
  label: boolean;
}) {
  const x = s?.x ?? p.pos.x;
  const y = s?.y ?? p.pos.y;
  const scale = s?.scale ?? 1;
  return (
    <G
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`}
      opacity={s?.opacity ?? (p.involved ? 1 : 0.55)}
    >
      <Ellipse rx={11} ry={11} fill={fill} />
      {p.jersey !== undefined && (
        <SvgText y={4} fill={text} fontSize={11} fontFamily={fonts.bold} textAnchor="middle">
          {String(p.jersey)}
        </SvgText>
      )}
      {label && p.name ? (
        <SvgText
          y={27}
          fill="#fff"
          fillOpacity={p.involved ? 0.95 : 0.6}
          fontSize={p.involved ? 12 : 9}
          fontFamily={p.involved ? UI : fonts.regular}
          textAnchor="middle"
        >
          {p.name}
        </SvgText>
      ) : null}
    </G>
  );
}

/** Text with a black outline: a stroked copy underneath (react-native-svg has no paint-order). */
function OutlinedText(props: {
  x: number;
  y: number;
  text: string;
  fill: string;
  size: number;
  family: string;
  stroke: number;
  opacity: number;
  scale?: number;
}) {
  const { x, y, text, fill, size, family, stroke, opacity, scale = 1 } = props;
  if (!text || opacity <= 0.01) return null;
  return (
    <G opacity={opacity} transform={`translate(${x} ${y}) scale(${scale})`}>
      <SvgText
        fill="#000"
        stroke="#000"
        strokeWidth={stroke}
        strokeLinejoin="round"
        fontSize={size}
        fontFamily={family}
        textAnchor="middle"
        letterSpacing={2}
      >
        {text}
      </SvgText>
      <SvgText
        fill={fill}
        fontSize={size}
        fontFamily={family}
        textAnchor="middle"
        letterSpacing={2}
      >
        {text}
      </SvgText>
    </G>
  );
}

export function FieldView(props: FieldProps) {
  const { home, away, depth, rosters, play, state, labels = 'all' } = props;
  const o: Orientation = useMemo(() => ({ homeAbbr: home.abbr }), [home.abbr]);
  const lineup = useMemo(
    () =>
      play
        ? buildLineup({ play, teams: { home: home.abbr, away: away.abbr }, depth, rosters })
        : undefined,
    [play, home.abbr, away.abbr, depth, rosters],
  );
  const frame = usePlayAnimation({
    play,
    lineup,
    o,
    home,
    away,
    replayToken: props.replayToken,
    speed: props.speed,
    paused: props.paused,
    instant: props.instant,
    onDone: props.onDone,
  });

  if (props.headless) return null;

  const colorOf = (team: string) => {
    const t = team === home.abbr ? home : away;
    return { fill: t.color, text: t.numberColor };
  };

  // Lines: while a play animates show the snap situation, after it the new one.
  const lineState = play ? play.pre : state;
  const losX = lineState ? absX(lineState.possession, lineState.yardLine, o) : undefined;
  const fdYd =
    lineState?.down &&
    lineState.distance !== undefined &&
    lineState.yardLine + lineState.distance < 100
      ? lineState.yardLine + lineState.distance
      : undefined;
  const fdX = lineState && fdYd !== undefined ? absX(lineState.possession, fdYd, o) : undefined;
  const redZone = !!lineState && lineState.yardLine >= 80 && play?.parsed.type !== 'kickoff';
  const rzFrom = lineState ? absX(lineState.possession, 80, o) : 0;
  const rzTo = lineState ? absX(lineState.possession, 100, o) : 0;

  const ball = frame[BALL];
  const body = frame[BALL_BODY];
  const flag = frame[FLAG];
  const banner = frame[BANNER];
  const marker = frame[MARKER];

  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={`-6 -6 ${FIELD_W + 12} ${FIELD_H + 12}`}
      preserveAspectRatio="xMidYMid meet"
      accessibilityLabel={play ? play.raw.text : 'Football field'}
    >
      <FieldSurface home={home} away={away} />
      {[home, away].map((t) => (
        <Rect
          key={`flash-${t.abbr}`}
          x={t.abbr === home.abbr ? 0 : 110 * SCALE}
          y={0}
          width={10 * SCALE}
          height={FIELD_H}
          fill={t.color}
          opacity={frame[flashKey(t.abbr)]?.opacity ?? 0}
        />
      ))}
      {redZone && (
        <Rect
          x={Math.min(rzFrom, rzTo)}
          y={0}
          width={Math.abs(rzTo - rzFrom)}
          height={FIELD_H}
          fill="#FF3B30"
          fillOpacity={0.07}
        />
      )}
      {losX !== undefined && (
        <Line x1={losX} x2={losX} y1={0} y2={FIELD_H} stroke="#0A84FF" strokeWidth={3.5} />
      )}
      {fdX !== undefined && (
        <Line x1={fdX} x2={fdX} y1={0} y2={FIELD_H} stroke="#FFD60A" strokeWidth={3.5} />
      )}
      {lineup?.players.map((p) => {
        const c = colorOf(p.team);
        return (
          <Player
            key={p.key}
            p={p}
            s={frame[p.key]}
            fill={c.fill}
            text={c.text}
            label={labels === 'all' || p.involved}
          />
        );
      })}
      {play && ball && (
        <G
          transform={`translate(${ball.x.toFixed(1)} ${ball.y.toFixed(1)}) scale(${ball.scale.toFixed(3)})`}
          opacity={ball.opacity}
        >
          <Ellipse
            rx={6.5}
            ry={4.2}
            fill={body?.fill ?? '#F5F5F5'}
            stroke="#000"
            strokeWidth={1.2}
          />
        </G>
      )}
      {flag && flag.opacity > 0.01 && (
        <G
          transform={`translate(${flag.x.toFixed(1)} ${flag.y.toFixed(1)})`}
          opacity={flag.opacity}
        >
          <Rect x={-6} y={-6} width={12} height={12} rx={2} fill="#FFD60A" transform="rotate(12)" />
        </G>
      )}
      {marker && (
        <OutlinedText
          x={marker.x}
          y={marker.y}
          text={marker.text ?? ''}
          fill="#fff"
          size={16}
          family={UI}
          stroke={4}
          opacity={marker.opacity}
        />
      )}
      {banner && (
        <OutlinedText
          x={FIELD_W / 2}
          y={86}
          text={banner.text ?? ''}
          fill={banner.fill ?? '#fff'}
          size={64}
          family={DISPLAY}
          stroke={8}
          opacity={banner.opacity}
          scale={banner.scale}
        />
      )}
    </Svg>
  );
}
