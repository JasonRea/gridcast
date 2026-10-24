import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/lib/api';

type Status = {
  gameId: string;
  source: 'live' | 'replay';
  status: string;
  speed: number;
  events: number;
  lastUpdate: number | null;
};

const KEY = 'gridcast.adminToken';

function readToken(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Demo kill switch: flip the featured game between the live feed and the recorded replay. */
export function Admin() {
  const [token, setToken] = useState(readToken);
  const [gameId, setGameId] = useState('');
  const [speed, setSpeed] = useState(4);
  const [from, setFrom] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  async function refresh() {
    setError('');
    const q = gameId ? `?gameId=${gameId}` : '';
    const res = await fetch(`${API_BASE}/api/admin/source${q}`, { headers });
    if (!res.ok)
      return setError(
        `${res.status}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`,
      );
    setStatus((await res.json()) as Status);
  }

  async function flip(source: 'live' | 'replay') {
    setError('');
    const res = await fetch(`${API_BASE}/api/admin/source`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(gameId ? { gameId } : {}),
        source,
        ...(source === 'replay' ? { speed, from } : {}),
      }),
    });
    if (!res.ok)
      setError(
        `${res.status}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`,
      );
    await refresh();
  }

  useEffect(() => {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* private mode */
    }
  }, [token]);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="display text-3xl">Kill switch</h1>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Admin token</span>
        <input
          className="h-10 rounded-md bg-secondary px-3"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Game id (blank = featured)</span>
        <input
          className="h-10 rounded-md bg-secondary px-3 num"
          value={gameId}
          onChange={(e) => setGameId(e.target.value.trim())}
        />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Replay speed</span>
          <input
            className="h-10 rounded-md bg-secondary px-3 num"
            type="number"
            min={1}
            max={16}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From event #</span>
          <input
            className="h-10 rounded-md bg-secondary px-3 num"
            type="number"
            min={0}
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="flex gap-3">
        <Button className="flex-1" size="lg" onClick={() => void flip('live')}>
          Go live
        </Button>
        <Button
          className="flex-1"
          size="lg"
          variant="secondary"
          onClick={() => void flip('replay')}
        >
          Switch to replay
        </Button>
      </div>
      <Button variant="ghost" onClick={() => void refresh()}>
        Refresh status
      </Button>
      {error && <p className="text-sm text-negative">{error}</p>}
      {status && (
        <pre className="rounded-md bg-card p-3 text-xs text-muted-foreground num">
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </main>
  );
}
