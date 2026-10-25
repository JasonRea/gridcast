"""Historical twins for 4th downs (A4): what NFL teams did in the same spot, 2016-2025.

For every 4th down in nflverse play-by-play, buckets the situation (distance, field position,
score margin, time left) and counts how often teams went for it, converted, kicked or punted.
Writes data/assets/twins.json; the server reads it and never runs Python.

    python scripts/fetch_nflverse.py --twins   # downloads 2016-2025 into data/raw/nflverse
    python scripts/build_twins.py              # pandas, writes data/assets/twins.json

Tiger Data (TimescaleDB) path, same output, computed in the database:

    export TIGER_DATABASE_URL=postgres://...   # from the Tiger Cloud console
    python scripts/build_twins.py --tiger-load # every play 2016-2025 into a hypertable
    python scripts/build_twins.py --tiger      # twins via SQL GROUPING SETS -> twins.json

The Tiger path talks to the database through the psql CLI (no Python driver). On TimescaleDB it
also makes `nfl_plays` a hypertable and keeps a continuous aggregate of weekly 4th-down
aggressiveness (`fourth_down_weekly`); on plain Postgres those two steps are skipped.

The bucket edges live in the JSON so the server uses exactly the same buckets.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "nflverse"
OUT = ROOT / "data" / "assets" / "twins.json"
SEASONS = list(range(2016, 2026))

# Upper bounds, inclusive; values above the last edge fall in one more bucket.
DISTANCE = [1, 2, 3, 5, 10]  # 1, 2, 3, 4-5, 6-10, 11+
FIELD = [5, 10, 20, 30, 40, 50, 60, 70, 80]  # yards to the end zone
SCORE = [-9, -4, -1, 0, 3, 8]  # offense's margin: <=-9 ... 9+
TIME = ["early", "q4", "late"]  # Q1-Q3, Q4 before the last 5 min, last 5 min or OT
LEVELS = [["d", "f", "s", "t"], ["d", "f", "s"], ["d", "f"]]
MIN_N = 20

COLS = [
    "season",
    "game_id",
    "game_date",
    "posteam",
    "down",
    "ydstogo",
    "yardline_100",
    "score_differential",
    "qtr",
    "game_seconds_remaining",
    "play_type",
    "fourth_down_converted",
    "epa",
    "wp",
]


def bucket(v: float, edges: list[int]) -> int:
    for i, e in enumerate(edges):
        if v <= e:
            return i
    return len(edges)


def time_bucket(qtr: int, secs: float) -> int:
    if qtr >= 5 or (qtr == 4 and secs <= 300):
        return 2
    return 1 if qtr == 4 else 0


def load(fourth_only: bool = True) -> pd.DataFrame:
    frames = []
    for y in SEASONS:
        f = RAW / f"play_by_play_{y}.csv.gz"
        if not f.exists():
            raise SystemExit(f"missing {f}; run scripts/fetch_nflverse.py --twins")
        df = pd.read_csv(f, usecols=COLS, low_memory=False)
        if fourth_only:
            df = df[(df["down"] == 4) & df["play_type"].isin(["run", "pass", "field_goal", "punt"])]
            df = df.dropna(subset=["ydstogo", "yardline_100", "score_differential", "qtr"])
        frames.append(df)
        print(f"{y}: {len(frames[-1])} {'fourth downs' if fourth_only else 'plays'}")
    return pd.concat(frames, ignore_index=True)


def write(cells: dict[str, list[int]], plays: int, engine: str) -> None:
    out = {
        "source": f"nflverse play-by-play {SEASONS[0]}-{SEASONS[-1]} regular and postseason",
        "engine": engine,
        "seasons": [SEASONS[0], SEASONS[-1]],
        "plays": plays,
        "minN": MIN_N,
        "buckets": {"distance": DISTANCE, "field": FIELD, "score": SCORE, "time": TIME},
        "levels": LEVELS,
        "cells": dict(sorted(cells.items())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {plays} fourth downs, {len(cells)} cells ({engine})")


# ---- Tiger Data (TimescaleDB) ----

SCHEMA = """
CREATE TABLE IF NOT EXISTS nfl_plays (
  ts timestamptz NOT NULL,
  season int NOT NULL,
  game_id text NOT NULL,
  posteam text,
  down int,
  ydstogo int,
  yardline_100 int,
  score_differential int,
  qtr int,
  game_seconds_remaining int,
  play_type text,
  fourth_down_converted boolean,
  epa double precision,
  wp double precision
);
"""

TIMESCALE = """
SELECT create_hypertable('nfl_plays', by_range('ts', INTERVAL '30 days'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS nfl_plays_fourth ON nfl_plays (down, ydstogo, yardline_100) WHERE down = 4;
CREATE MATERIALIZED VIEW IF NOT EXISTS fourth_down_weekly
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '7 days', ts) AS week,
       count(*) AS fourth_downs,
       count(*) FILTER (WHERE play_type IN ('run', 'pass')) AS went_for_it,
       count(*) FILTER (WHERE fourth_down_converted) AS converted
FROM nfl_plays
WHERE down = 4 AND play_type IN ('run', 'pass', 'field_goal', 'punt')
GROUP BY week
WITH NO DATA;
"""


def bucket_sql(col: str, edges: list[int]) -> str:
    """Index of the first edge >= value, like bucket(): the number of edges below it."""
    arr = ",".join(str(e) for e in edges)
    return f"(SELECT count(*) FROM unnest(ARRAY[{arr}]) e WHERE {col} > e)"


TWINS_SQL = f"""
WITH f AS (
  SELECT {bucket_sql("ydstogo", DISTANCE)} AS d,
         {bucket_sql("yardline_100", FIELD)} AS f,
         {bucket_sql("score_differential", SCORE)} AS s,
         CASE WHEN qtr >= 5 OR (qtr = 4 AND game_seconds_remaining <= 300) THEN 2
              WHEN qtr = 4 THEN 1 ELSE 0 END AS t,
         play_type IN ('run', 'pass') AS go,
         play_type IN ('run', 'pass') AND coalesce(fourth_down_converted, false) AS conv,
         play_type = 'field_goal' AS fg,
         play_type = 'punt' AS punt
  FROM nfl_plays
  WHERE down = 4 AND play_type IN ('run', 'pass', 'field_goal', 'punt')
    AND ydstogo IS NOT NULL AND yardline_100 IS NOT NULL
    AND score_differential IS NOT NULL AND qtr IS NOT NULL
)
SELECT concat_ws(':', d, f,
         CASE WHEN grouping(s) = 0 THEN s::text END,
         CASE WHEN grouping(t) = 0 THEN t::text END) AS key,
       count(*), count(*) FILTER (WHERE go), count(*) FILTER (WHERE conv),
       count(*) FILTER (WHERE fg), count(*) FILTER (WHERE punt)
FROM f
GROUP BY GROUPING SETS ((d, f, s, t), (d, f, s), (d, f))
HAVING count(*) >= {MIN_N};
"""


def psql(url: str, sql: str | None = None, stdin: bytes | None = None, copy: str | None = None) -> str:
    args = ["psql", url, "-v", "ON_ERROR_STOP=1", "-At", "-F", ","]
    args += ["-c", copy] if copy else ["-c", sql or ""]
    r = subprocess.run(args, input=stdin, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"psql failed: {r.stderr.decode().strip()}")
    return r.stdout.decode()


def tiger_url() -> str:
    url = os.environ.get("TIGER_DATABASE_URL", "").strip()
    if not url:
        raise SystemExit("set TIGER_DATABASE_URL (Tiger Cloud console -> service -> connection string)")
    return url


def has_timescale(url: str) -> bool:
    return psql(url, "SELECT count(*) FROM pg_available_extensions WHERE name = 'timescaledb'").strip() != "0"


def tiger_load() -> None:
    url = tiger_url()
    timescale = has_timescale(url)
    if timescale:
        psql(url, "CREATE EXTENSION IF NOT EXISTS timescaledb")
    psql(url, SCHEMA)
    psql(url, "TRUNCATE nfl_plays")
    if timescale:
        psql(url, TIMESCALE)
    df = load(fourth_only=False)
    # Event time: kickoff date plus game time elapsed (overtime counts on from 60:00).
    gsr = df["game_seconds_remaining"].fillna(0)
    elapsed = (3600 - gsr).where(df["qtr"] <= 4, 3600 + (600 - gsr).clip(lower=0))
    df["ts"] = pd.to_datetime(df["game_date"], utc=True) + pd.to_timedelta(elapsed, unit="s")
    cols = [
        "ts", "season", "game_id", "posteam", "down", "ydstogo", "yardline_100",
        "score_differential", "qtr", "game_seconds_remaining", "play_type",
        "fourth_down_converted", "epa", "wp",
    ]
    out = df[cols].copy()
    for c in ["down", "ydstogo", "yardline_100", "score_differential", "qtr", "game_seconds_remaining"]:
        out[c] = out[c].astype("Int64")
    out["fourth_down_converted"] = out["fourth_down_converted"].map({1: "t", 0: "f", 1.0: "t", 0.0: "f"})
    buf = io.StringIO()
    out.to_csv(buf, index=False, header=False)
    psql(url, copy=f"\\copy nfl_plays ({','.join(cols)}) FROM STDIN WITH (FORMAT csv)", stdin=buf.getvalue().encode())
    if timescale:
        psql(url, "CALL refresh_continuous_aggregate('fourth_down_weekly', NULL, NULL)")
    n = psql(url, "SELECT count(*) FROM nfl_plays").strip()
    print(f"loaded {n} plays into nfl_plays ({'TimescaleDB hypertable' if timescale else 'plain Postgres'})")


def tiger_build() -> None:
    url = tiger_url()
    cells: dict[str, list[int]] = {}
    for line in psql(url, TWINS_SQL).splitlines():
        key, *nums = line.split(",")
        cells[key] = [int(x) for x in nums]
    plays = int(psql(url, TWINS_SQL.split("SELECT concat_ws")[0] + "SELECT count(*) FROM f").strip())
    write(cells, plays, "tiger" if has_timescale(url) else "postgres")


def main() -> None:
    if "--tiger-load" in sys.argv:
        return tiger_load()
    if "--tiger" in sys.argv:
        return tiger_build()
    df = load()
    df["d"] = df["ydstogo"].map(lambda v: bucket(v, DISTANCE))
    df["f"] = df["yardline_100"].map(lambda v: bucket(v, FIELD))
    df["s"] = df["score_differential"].map(lambda v: bucket(v, SCORE))
    df["t"] = [time_bucket(int(q), float(s)) for q, s in zip(df["qtr"], df["game_seconds_remaining"])]
    df["go"] = df["play_type"].isin(["run", "pass"])
    df["conv"] = df["go"] & (df["fourth_down_converted"] == 1)
    df["fg"] = df["play_type"] == "field_goal"
    df["punt"] = df["play_type"] == "punt"

    cells: dict[str, list[float]] = {}
    for level in LEVELS:
        g = df.groupby(level).agg(
            n=("go", "size"), go=("go", "sum"), conv=("conv", "sum"), fg=("fg", "sum"), punt=("punt", "sum")
        )
        for key, row in g.iterrows():
            key = key if isinstance(key, tuple) else (key,)
            if row["n"] < MIN_N:
                continue
            # [n, went for it, converted, field goals, punts]
            cells[":".join(str(int(k)) for k in key)] = [
                int(row["n"]),
                int(row["go"]),
                int(row["conv"]),
                int(row["fg"]),
                int(row["punt"]),
            ]

    write(cells, int(len(df)), "pandas")


if __name__ == "__main__":
    main()
