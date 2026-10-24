"""Build the expected-points table and 4th-down lookups from nflverse play-by-play.

Writes data/assets/ep_table.json and data/assets/fourth_down.json. The server loads these at
boot and never runs Python at request time.

Usage: python scripts/build_analytics.py [--seasons 2024 2025]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "nflverse"
OUT = ROOT / "data" / "assets"

# Distance buckets (upper bounds, inclusive) and yard-line buckets of 5 yards to the end zone.
DIST_BUCKETS = [1, 2, 3, 5, 7, 10, 15, 20, 99]
YL_BUCKET = 5


def dist_bucket(d: int) -> int:
    for i, hi in enumerate(DIST_BUCKETS):
        if d <= hi:
            return i
    return len(DIST_BUCKETS) - 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025])
    ap.add_argument("--raw", type=Path, default=RAW)
    args = ap.parse_args()
    cols = ["down", "ydstogo", "yardline_100", "ep", "play_type", "fourth_down_converted", "fourth_down_failed",
            "field_goal_result", "kick_distance", "punt_blocked", "touchback", "return_yards", "yards_gained",
            "season_type", "qb_kneel", "penalty"]
    df = pd.concat(
        pd.read_csv(args.raw / f"play_by_play_{s}.csv.gz", usecols=lambda c: c in cols, low_memory=False)
        for s in args.seasons
    )
    snaps = df[df.down.notna() & df.ep.notna() & df.yardline_100.notna() & df.play_type.isin(["run", "pass", "punt", "field_goal"])]

    # Expected points by down x distance bucket x yard-line bucket, smoothed across neighbors.
    snaps = snaps.assign(
        db=snaps.ydstogo.astype(int).map(dist_bucket),
        yb=(snaps.yardline_100.astype(int).clip(1, 99) - 1) // YL_BUCKET,
    )
    grid = snaps.groupby(["down", "db", "yb"]).ep.agg(["mean", "count"]).reset_index()
    nyb = 100 // YL_BUCKET
    table: list[list[list[float]]] = []
    for down in (1, 2, 3, 4):
        rows = []
        for db in range(len(DIST_BUCKETS)):
            row = []
            for yb in range(nyb):
                cell = grid[(grid.down == down) & (grid.db == db) & (grid.yb == yb)]
                if len(cell) and int(cell["count"].iloc[0]) >= 15:
                    row.append(round(float(cell["mean"].iloc[0]), 3))
                else:
                    near = snaps[(snaps.down == down) & (snaps.yb.between(yb - 1, yb + 1))]
                    row.append(round(float(near.ep.mean()) if len(near) else 0.0, 3))
            rows.append(row)
        table.append(rows)
    ep = {
        "source": f"nflverse play_by_play {args.seasons}, mean nflverse ep",
        "distBuckets": DIST_BUCKETS,
        "yardLineBucket": YL_BUCKET,
        "ep": table,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ep_table.json").write_text(json.dumps(ep) + "\n")

    # Go-for-it conversion rate by yards to go.
    go = df[(df.down == 4) & df.play_type.isin(["run", "pass"]) & (df.qb_kneel != 1)]
    conv = []
    for d in range(1, 21):
        g = go[go.ydstogo == d] if d < 20 else go[go.ydstogo >= 20]
        rate = (g.fourth_down_converted == 1).mean() if len(g) >= 10 else None
        conv.append(round(float(rate), 3) if rate is not None else None)
    for i in range(len(conv)):
        if conv[i] is None:
            conv[i] = conv[i - 1] * 0.9 if i else 0.6

    # Field goal make rate by kick distance.
    fg = df[(df.play_type == "field_goal") & df.kick_distance.notna()]
    make = {}
    for dist in range(18, 71):
        g = fg[fg.kick_distance.between(dist - 2, dist + 2)]
        make[dist] = round(float((g.field_goal_result == "made").mean()), 3) if len(g) >= 10 else (0.0 if dist > 60 else None)
    last = 0.99
    for dist in range(18, 71):
        if make[dist] is None:
            make[dist] = last
        last = make[dist]

    # Net punt result: where the receiving team takes over, by punt yard line (5-yd buckets).
    punts = df[(df.play_type == "punt") & df.yardline_100.notna() & (df.punt_blocked != 1)]
    net = []
    for yb in range(nyb):
        g = punts[((punts.yardline_100.astype(int).clip(1, 99) - 1) // YL_BUCKET) == yb]
        # Opponent's distance to their own end zone after the punt = 100 - their yard line.
        if len(g) >= 10:
            gross = g.kick_distance.fillna(0)
            ret = g.return_yards.fillna(0)
            land = (g.yardline_100 - gross + ret).where(g.touchback != 1, 20).clip(lower=1)
            net.append(round(float(land.mean()), 1))
        else:
            net.append(None)
    for i in range(len(net)):
        if net[i] is None:
            net[i] = net[i - 1] if i else 10.0

    fourth = {
        "source": f"nflverse play_by_play {args.seasons}",
        "goConversion": conv,
        "fgMake": {str(k): v for k, v in make.items()},
        "puntOppYardLine": net,
        "yardLineBucket": YL_BUCKET,
    }
    (OUT / "fourth_down.json").write_text(json.dumps(fourth) + "\n")
    print("wrote data/assets/ep_table.json and data/assets/fourth_down.json")
    print("4th & 1 conversion", conv[0], "| 45-yd FG", make[45], "| punt from own 30 -> opp", net[13])


if __name__ == "__main__":
    main()
