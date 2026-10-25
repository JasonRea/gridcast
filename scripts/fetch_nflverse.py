"""Download the nflverse files the fixture and asset builders read, into data/raw/nflverse."""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "nflverse"
BASE = "https://github.com/nflverse/nflverse-data/releases/download"

FILES = [
    "schedules/games.csv",
    "pbp/play_by_play_2024.csv.gz",
    "pbp/play_by_play_2025.csv.gz",
    "pbp/play_by_play_2026.csv.gz",
    "rosters/roster_2026.csv",
    "depth_charts/depth_charts_2026.csv",
]

# Ten seasons for the 4th-down historical twins (scripts/build_twins.py): --twins
TWINS = [f"pbp/play_by_play_{y}.csv.gz" for y in range(2016, 2026)]


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    args = set(sys.argv[1:])
    files = TWINS if "--twins" in args else FILES
    only = args - {"--twins"}
    for f in files:
        name = f.split("/")[-1]
        if only and name not in only:
            continue
        dest = RAW / name
        print(f"GET {f} -> {dest.relative_to(ROOT)}")
        urllib.request.urlretrieve(f"{BASE}/{f}", dest)


if __name__ == "__main__":
    main()
