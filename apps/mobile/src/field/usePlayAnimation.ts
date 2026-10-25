/**
 * Drives a play's timeline. One requestAnimationFrame loop per play: time advances by
 * frame delta x speed (paused freezes it), the plan is sampled, and the field re-renders. When
 * the timeline ends it calls `onDone(playId)` once, which advances the store queue exactly like
 * the web's GSAP `onComplete`. `instant` (catch-up, scrubbing) jumps straight to the last frame.
 *
 * Why not Reanimated worklets: animating react-native-svg group transforms from the UI thread
 * is not reliable across Expo Go / Fabric versions, and 22 players + ball at 3-6 s per play is
 * well within a JS-thread render budget. See DECISIONS.md.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlayEvent, TeamInfo } from '@gridcast/types';
import type { Orientation } from '@web/field/geometry';
import type { buildLineup } from '@web/field/lineup';
import { planPlay, type PlayPlan } from './plan';
import type { TargetState } from './timeline';

type Frame = Record<string, TargetState>;

export function usePlayAnimation(opts: {
  play: PlayEvent | undefined;
  lineup: ReturnType<typeof buildLineup> | undefined;
  o: Orientation;
  home: TeamInfo;
  away: TeamInfo;
  replayToken: number;
  speed: number;
  paused: boolean;
  instant: boolean;
  onDone: (playId: string) => void;
}): Frame {
  const { play, lineup, o, home, away, replayToken } = opts;
  const [frame, setFrame] = useState<Frame>({});
  const last = useRef<Frame>({});
  const speed = useRef(opts.speed);
  speed.current = opts.speed;
  const paused = useRef(opts.paused);
  paused.current = opts.paused;
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;
  const instant = useRef(opts.instant);
  instant.current = opts.instant;

  useLayoutEffect(() => {
    if (!play || !lineup) return;
    const offTeam = lineup.frame.offense === home.abbr ? home : away;
    const defTeam = lineup.frame.offense === home.abbr ? away : home;
    let plan: PlayPlan;
    try {
      plan = planPlay({
        play,
        frame: lineup.frame,
        players: lineup.players,
        o,
        colors: { offense: offTeam.color, defense: defTeam.color, ball: '#F5F5F5' },
        names: { offense: offTeam.shortName, defense: defTeam.shortName },
        teams: [home.abbr, away.abbr],
        start: last.current,
      });
    } catch (err) {
      // A play the planner can't draw must never stall the queue.
      console.warn('[gridcast] field plan failed', play.id, err);
      onDone.current(play.id);
      return;
    }
    const total = plan.timeline.duration;
    const show = (t: number) => {
      const f = plan.timeline.sample(t);
      last.current = { ...last.current, ...f };
      setFrame(f);
    };

    if (instant.current) {
      show(total);
      onDone.current(play.id);
      return;
    }

    let raf = 0;
    let elapsed = 0;
    let prev: number | undefined;
    let finished = false;
    const tick = (now: number) => {
      const dt = prev === undefined ? 0 : (now - prev) / 1000;
      prev = now;
      if (paused.current) {
        // Frozen frame: keep the loop alive without re-rendering.
        raf = requestAnimationFrame(tick);
        return;
      }
      // Clamp long gaps (app backgrounded mid-play) so the play doesn't skip to the end.
      elapsed += Math.min(dt, 0.1) * speed.current;
      if (elapsed >= total) {
        show(total);
        if (!finished) {
          finished = true;
          onDone.current(play.id);
        }
        return;
      }
      show(elapsed);
      raf = requestAnimationFrame(tick);
    };
    show(0);
    raf = requestAnimationFrame(tick);
    // Stop without reverting: the next play lines up from wherever this one left everyone.
    return () => cancelAnimationFrame(raf);
    // replayToken re-runs the same play on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, replayToken]);

  // Forget positions when the game changes.
  useEffect(() => {
    last.current = {};
  }, [home.abbr, away.abbr]);

  return frame;
}
