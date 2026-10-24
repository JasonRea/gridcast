import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { DepthChart, GameState, PlayEvent, RosterPlayer, TeamInfo } from '@gridcast/types';
import { buildTimeline } from './animate';
import { absX, CENTER_Y, FIELD_H, FIELD_W, SCALE, type Orientation } from './geometry';
import { buildLineup, type FieldPlayer } from './lineup';

gsap.registerPlugin(MotionPathPlugin);

export type BallSample = {
  phase: 'start' | 'move' | 'end';
  play: PlayEvent;
  /** Team on offense for this animation (the frame's offense). */
  offense: string;
  homeAbbr: string;
  x: number;
  y: number;
};

export type FieldProps = {
  home: TeamInfo;
  away: TeamInfo;
  depth: Record<string, DepthChart>;
  rosters: Record<string, RosterPlayer[]>;
  /** Play to animate (or show at rest). */
  play: PlayEvent | undefined;
  /** Situation to draw lines for when there is no play yet. */
  state: GameState | undefined;
  /** Bump to replay the current play. */
  replayToken: number;
  speed: number;
  paused: boolean;
  /** Skip straight to the end of the play (catch-up, jumps). */
  instant: boolean;
  onDone: (playId: string) => void;
  /** Ball position (SVG units) as the play animates: Access mode turns it into sound. */
  onBall?: (sample: BallSample) => void;
};

const YARD_NUMBERS = [10, 20, 30, 40, 50, 40, 30, 20, 10];

function FieldSurface({ home, away }: { home: TeamInfo; away: TeamInfo }) {
  const lines = [];
  for (let yd = 15; yd <= 105; yd += 5) {
    const x = yd * SCALE;
    lines.push(
      <line
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
        <line
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
    <g>
      <rect x={0} y={0} width={FIELD_W} height={FIELD_H} fill="#000" />
      {/* End zones tinted with team color at 20%. Home defends the left end zone. */}
      <rect x={0} y={0} width={10 * SCALE} height={FIELD_H} fill={home.color} fillOpacity={0.2} />
      <rect
        x={110 * SCALE}
        y={0}
        width={10 * SCALE}
        height={FIELD_H}
        fill={away.color}
        fillOpacity={0.2}
      />
      <text
        x={50}
        y={CENTER_Y}
        fill={home.color}
        fillOpacity={0.55}
        fontSize={44}
        fontFamily="Barlow Condensed, Geist, ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(-90 50 ${CENTER_Y})`}
        letterSpacing={6}
      >
        {home.shortName.toUpperCase()}
      </text>
      <text
        x={FIELD_W - 50}
        y={CENTER_Y}
        fill={away.color}
        fillOpacity={0.55}
        fontSize={44}
        fontFamily="Barlow Condensed, Geist, ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(90 ${FIELD_W - 50} ${CENTER_Y})`}
        letterSpacing={6}
      >
        {away.shortName.toUpperCase()}
      </text>
      <rect
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
          <g
            key={`n${i}`}
            fill="#fff"
            fillOpacity={0.4}
            fontFamily="Barlow Condensed, Geist, ui-sans-serif, system-ui, sans-serif"
            fontWeight={700}
            fontSize={30}
            textAnchor="middle"
          >
            <text x={x} y={52}>
              {n}
            </text>
            <text x={x} y={FIELD_H - 30} transform={`rotate(180 ${x} ${FIELD_H - 40})`}>
              {n}
            </text>
          </g>
        );
      })}
      {/* Goal posts at the end lines. */}
      {[0, FIELD_W].map((x) => (
        <g key={`gp${x}`} stroke="#FFD60A" strokeOpacity={0.6} strokeWidth={3}>
          <line x1={x} x2={x} y1={CENTER_Y - 28} y2={CENTER_Y + 28} />
        </g>
      ))}
    </g>
  );
}

function Player({
  p,
  colors,
  refCb,
}: {
  p: FieldPlayer;
  colors: { fill: string; text: string };
  refCb: (el: SVGGElement | null) => void;
}) {
  return (
    <g ref={refCb} data-key={p.key} style={{ opacity: p.involved ? 1 : 0.55 }}>
      <circle r={11} fill={colors.fill} />
      <text
        y={0.5}
        fill={colors.text}
        fontSize={11}
        fontWeight={700}
        fontFamily="Geist, ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        className="num"
      >
        {p.jersey ?? ''}
      </text>
      {p.name && (
        <text
          y={23}
          fill="#fff"
          fillOpacity={p.involved ? 0.95 : 0.6}
          fontSize={p.involved ? 11 : 9}
          fontFamily="Geist, ui-sans-serif, system-ui, sans-serif"
          fontWeight={p.involved ? 600 : 400}
          textAnchor="middle"
        >
          {p.name}
        </text>
      )}
    </g>
  );
}

export function Field(props: FieldProps) {
  const { home, away, depth, rosters, play, state, replayToken, speed, paused, instant, onDone } =
    props;
  const o: Orientation = useMemo(() => ({ homeAbbr: home.abbr }), [home.abbr]);
  const refs = useRef(new Map<string, SVGGElement>());
  const ballRef = useRef<SVGGElement>(null);
  const ballBodyRef = useRef<SVGEllipseElement>(null);
  const flagRef = useRef<SVGGElement>(null);
  const bannerRef = useRef<SVGTextElement>(null);
  const markerRef = useRef<SVGTextElement>(null);
  const flashRefs = useRef(new Map<string, SVGRectElement>());
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const ballCbRef = useRef(props.onBall);
  ballCbRef.current = props.onBall;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const placed = useRef(new WeakSet<SVGGElement>());

  const lineup = useMemo(
    () =>
      play
        ? buildLineup({ play, teams: { home: home.abbr, away: away.abbr }, depth, rosters })
        : undefined,
    [play, home.abbr, away.abbr, depth, rosters],
  );

  const colorOf = (team: string) => {
    const t = team === home.abbr ? home : away;
    return { fill: t.color, text: t.numberColor };
  };

  useLayoutEffect(() => {
    if (
      !play ||
      !lineup ||
      !ballRef.current ||
      !ballBodyRef.current ||
      !flagRef.current ||
      !bannerRef.current ||
      !markerRef.current
    )
      return;
    const offTeam = lineup.frame.offense === home.abbr ? home : away;
    const defTeam = lineup.frame.offense === home.abbr ? away : home;
    // Newly mounted players start on their spot instead of flying in from the corner.
    for (const p of lineup.players) {
      const el = refs.current.get(p.key);
      if (el && !placed.current.has(el)) {
        gsap.set(el, { x: p.pos.x, y: p.pos.y });
        placed.current.add(el);
      }
    }
    const tl = buildTimeline({
      play,
      frame: lineup.frame,
      players: lineup.players,
      o,
      colors: { offense: offTeam.color, defense: defTeam.color, ball: '#F5F5F5' },
      names: { offense: offTeam.shortName, defense: defTeam.shortName },
      targets: {
        player: (k) => refs.current.get(k) ?? null,
        ball: ballRef.current,
        ballBody: ballBodyRef.current,
        flag: flagRef.current,
        banner: bannerRef.current,
        marker: markerRef.current,
        flash: (team) => flashRefs.current.get(team) ?? null,
      },
    });
    const ballEl = ballRef.current;
    const sample = (phase: BallSample['phase']) =>
      ballCbRef.current?.({
        phase,
        play,
        offense: lineup.frame.offense,
        homeAbbr: home.abbr,
        x: Number(gsap.getProperty(ballEl, 'x')) || 0,
        y: Number(gsap.getProperty(ballEl, 'y')) || 0,
      });
    tl.eventCallback('onStart', () => sample('start'));
    tl.eventCallback('onUpdate', () => sample('move'));
    tl.eventCallback('onComplete', () => {
      sample('end');
      doneRef.current(play.id);
    });
    tlRef.current = tl;
    tl.timeScale(speedRef.current);
    if (instant) tl.progress(1);
    else if (pausedRef.current) tl.pause(0);
    else tl.play(0);
    // Kill without reverting: the next play lines up from wherever this one left everyone.
    return () => {
      tl.kill();
      tlRef.current = null;
    };
    // replayToken re-runs the same play on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, replayToken]);

  useEffect(() => {
    tlRef.current?.timeScale(speed);
  }, [speed, lineup, replayToken]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (paused) tl.pause();
    else if (tl.progress() < 1) tl.resume();
  }, [paused]);

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
  const redZone = lineState && lineState.yardLine >= 80 && play?.parsed.type !== 'kickoff';
  const rzFrom = lineState ? absX(lineState.possession, 80, o) : 0;
  const rzTo = lineState ? absX(lineState.possession, 100, o) : 0;

  return (
    <svg
      viewBox={`-6 -6 ${FIELD_W + 12} ${FIELD_H + 12}`}
      className="block h-full w-full select-none"
      role="img"
      aria-label={play ? play.raw.text : 'Football field'}
    >
      <FieldSurface home={home} away={away} />
      {[home, away].map((t) => (
        <rect
          key={`flash-${t.abbr}`}
          ref={(el) => {
            if (el) flashRefs.current.set(t.abbr, el);
          }}
          x={t.abbr === home.abbr ? 0 : 110 * SCALE}
          y={0}
          width={10 * SCALE}
          height={FIELD_H}
          fill={t.color}
          opacity={0}
        />
      ))}
      {redZone && (
        <rect
          x={Math.min(rzFrom, rzTo)}
          y={0}
          width={Math.abs(rzTo - rzFrom)}
          height={FIELD_H}
          fill="#FF3B30"
          fillOpacity={0.07}
        />
      )}
      {losX !== undefined && (
        <line
          x1={losX}
          x2={losX}
          y1={0}
          y2={FIELD_H}
          stroke="#0A84FF"
          strokeWidth={3.5}
          style={{ transition: 'all 600ms ease' }}
        />
      )}
      {fdX !== undefined && (
        <line
          x1={fdX}
          x2={fdX}
          y1={0}
          y2={FIELD_H}
          stroke="#FFD60A"
          strokeWidth={3.5}
          style={{ transition: 'all 600ms ease' }}
        />
      )}
      {lineup?.players.map((p) => (
        <Player
          key={p.key}
          p={p}
          colors={colorOf(p.team)}
          refCb={(el) => {
            if (el) refs.current.set(p.key, el);
            else refs.current.delete(p.key);
          }}
        />
      ))}
      <g ref={ballRef} style={{ opacity: play ? 1 : 0 }}>
        <ellipse
          ref={ballBodyRef}
          rx={6.5}
          ry={4.2}
          fill="#F5F5F5"
          stroke="#000"
          strokeWidth={1.2}
        />
      </g>
      <g ref={flagRef} opacity={0}>
        <rect x={-6} y={-6} width={12} height={12} rx={2} fill="#FFD60A" transform="rotate(12)" />
      </g>
      <text
        ref={markerRef}
        opacity={0}
        fill="#fff"
        fontSize={16}
        fontWeight={600}
        fontFamily="Geist, ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
        paintOrder="stroke"
        stroke="#000"
        strokeWidth={4}
      />
      <text
        ref={bannerRef}
        x={FIELD_W / 2}
        y={86}
        opacity={0}
        fill="#fff"
        fontSize={64}
        fontFamily="Barlow Condensed, Geist, ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        textAnchor="middle"
        letterSpacing={2}
        paintOrder="stroke"
        stroke="#000"
        strokeWidth={8}
      />
    </svg>
  );
}
