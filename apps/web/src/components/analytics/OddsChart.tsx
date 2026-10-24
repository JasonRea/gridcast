import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OddsTick, PlayEvent, TeamInfo } from '@gridcast/types';
import { headline, playLabel, swing } from '@/lib/plays';

type Point = {
  i: number;
  label: string;
  text: string;
  model?: number;
  market?: number;
  swing: number;
};

/** Odds vs model: Kalshi price and ESPN win probability for the home team, one point per play. */
export function OddsChart({
  plays,
  odds,
  teams,
  onSelect,
}: {
  plays: PlayEvent[];
  odds: OddsTick[];
  teams: { home: TeamInfo; away: TeamInfo };
  onSelect?: (index: number) => void;
}) {
  const ml = odds.filter((o) => o.market === 'moneyline');
  let k = 0;
  let market: number | undefined;
  const data: Point[] = plays.map((p, i) => {
    while (k < ml.length && ml[k]!.ts <= p.ts) market = ml[k++]!.homeProb;
    return {
      i,
      label: playLabel(p),
      text: headline(p),
      ...(p.wpAfter !== undefined ? { model: Math.round(p.wpAfter * 1000) / 10 } : {}),
      ...(market !== undefined ? { market: Math.round(market * 1000) / 10 } : {}),
      swing: swing(p),
    };
  });
  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground">The chart fills in as plays come in.</p>;
  }
  const spikes = data.filter((d) => Math.abs(d.swing) >= 5 && d.model !== undefined);
  const hasMarket = data.some((d) => d.market !== undefined);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: teams.home.color }} />{' '}
          {teams.home.abbr} win probability (model)
        </span>
        {hasMarket && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded border-t border-dashed border-white" /> Kalshi price
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-white" /> Swing of 5+ points
        </span>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
            onClick={(s) => {
              const idx = Number(
                (s as { activeTooltipIndex?: number | string } | null)?.activeTooltipIndex,
              );
              if (onSelect && Number.isFinite(idx)) onSelect(idx);
            }}
          >
            <CartesianGrid stroke="#242424" vertical={false} />
            <XAxis dataKey="i" tick={false} axisLine={{ stroke: '#242424' }} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: '#8A8A8A', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1A1A1A',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(_, p) => {
                const d = p?.[0]?.payload as Point | undefined;
                return d ? `${d.label} · ${d.text}` : '';
              }}
              formatter={(v, name) => [
                `${v}%`,
                name === 'model' ? `${teams.home.abbr} WP` : 'Kalshi',
              ]}
            />
            <Line
              type="monotone"
              dataKey="model"
              stroke={teams.home.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {hasMarket && (
              <Line
                type="stepAfter"
                dataKey="market"
                stroke="#FFFFFF"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {spikes.map((d) => (
              <ReferenceDot key={d.i} x={d.i} y={d.model!} r={4} fill="#FFFFFF" stroke="#000" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
