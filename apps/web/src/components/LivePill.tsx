import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

/** "LIVE · 12s": seconds since the last upstream update; amber when over 60 s stale. */
export function LivePill({
  source,
  lastUpdate,
  speed,
}: {
  source: 'live' | 'replay';
  lastUpdate?: number;
  speed?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (source === 'replay') {
    return (
      <Badge variant="muted" aria-label="Replay">
        Replay{speed ? ` ${speed}x` : ''}
      </Badge>
    );
  }
  const age = lastUpdate ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : undefined;
  const stale = age === undefined || age > 60;
  return (
    <Badge variant={stale ? 'stale' : 'live'} aria-live="polite">
      <span className={`size-1.5 rounded-full ${stale ? 'bg-stale' : 'bg-live animate-pulse'}`} />
      Live{age !== undefined ? ` · ${age < 100 ? `${age}s` : `${Math.round(age / 60)}m`}` : ''}
    </Badge>
  );
}
