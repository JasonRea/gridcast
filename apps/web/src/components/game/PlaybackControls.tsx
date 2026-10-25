import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ANIM_SPEEDS = [0.5, 1, 2];
const REPLAY_SPEEDS = [1, 2, 4, 8];

export function PlaybackControls({
  paused,
  onPause,
  animSpeed,
  onAnimSpeed,
  onReplay,
  onPrev,
  onNext,
  onBig,
  onFourth,
  replay,
  streamSpeed,
  onStreamSpeed,
  muted,
  onMute,
}: {
  paused: boolean;
  onPause: () => void;
  animSpeed: number;
  onAnimSpeed: (s: number) => void;
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onBig: () => void;
  /** Jumps the replay to the first play of the 4th quarter. */
  onFourth?: () => void;
  replay: boolean;
  streamSpeed: number;
  onStreamSpeed: (s: number) => void;
  /** Undefined when there is nothing to hear (TTS and sound flags off). */
  muted?: boolean;
  onMute?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="icon"
        variant="secondary"
        onClick={onPrev}
        aria-label="Previous play (left arrow)"
      >
        <SkipBack />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        onClick={onPause}
        aria-label={paused ? 'Play (space)' : 'Pause (space)'}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
      <Button size="icon" variant="secondary" onClick={onNext} aria-label="Next play (right arrow)">
        <SkipForward />
      </Button>
      <Button size="icon" variant="secondary" onClick={onReplay} aria-label="Replay this play">
        <RotateCcw />
      </Button>
      {muted !== undefined && onMute && (
        <Button
          size={muted ? 'icon' : 'sm'}
          variant={muted ? 'secondary' : 'default'}
          onClick={onMute}
          aria-label={muted ? 'Unmute announcers (M)' : 'Mute (M)'}
        >
          {muted ? <VolumeX /> : <Volume2 />}
          {!muted && 'On air'}
        </Button>
      )}
      <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Animation
      </span>
      <div className="flex rounded-md bg-secondary p-0.5" role="group" aria-label="Animation speed">
        {ANIM_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onAnimSpeed(s)}
            className={cn(
              'h-8 rounded px-2.5 text-xs font-semibold num',
              s === animSpeed
                ? 'bg-white text-black'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s}x
          </button>
        ))}
      </div>
      {replay && (
        <>
          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Game speed
          </span>
          <div
            className="flex rounded-md bg-secondary p-0.5"
            role="group"
            aria-label="Replay speed"
          >
            {REPLAY_SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => onStreamSpeed(s)}
                className={cn(
                  'h-8 rounded px-2.5 text-xs font-semibold num',
                  s === streamSpeed
                    ? 'bg-white text-black'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="How fast the game's plays arrive"
              >
                {s}x
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={onBig}
            aria-label="Jump to next big play (B)"
          >
            <Zap /> Big play
          </Button>
          {onFourth && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onFourth}
              aria-label="Jump to the start of the 4th quarter"
            >
              Q4
            </Button>
          )}
        </>
      )}
    </div>
  );
}
