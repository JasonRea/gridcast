import type { TeamInfo } from '@gridcast/types';
import { cn } from '@/lib/utils';

/** Team color chip + abbreviation. Team color is the only strong hue in the UI. */
export function TeamMark({
  team,
  className,
  size = 'md',
}: {
  team: TeamInfo;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dot = size === 'lg' ? 'size-4' : size === 'sm' ? 'size-2.5' : 'size-3';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn('shrink-0 rounded-full', dot)}
        style={{ background: team.color }}
        aria-hidden
      />
      <span className="font-semibold tracking-wide">{team.abbr}</span>
    </span>
  );
}
